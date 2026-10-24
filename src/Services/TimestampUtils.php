<?php

/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2021 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Services;

use Elabftw\Elabftw\BuildInfo;
use Elabftw\Elabftw\FsTools;
use Elabftw\Elabftw\TimestampResponse;
use Elabftw\Enums\Storage;
use Elabftw\Exceptions\ImproperActionException;
use Elabftw\Models\Config;
use Elabftw\Traits\ProcessTrait;
use GuzzleHttp\ClientInterface;
use GuzzleHttp\Exception\RequestException;
use League\Flysystem\FilesystemOperator;
use Symfony\Component\Process\Exception\ProcessFailedException;

use function hash_algos;
use function hash_equals;
use function hash_file;
use function in_array;
use function is_readable;
use function basename;
use function file_get_contents;
use function preg_match;
use function sprintf;
use function str_contains;
use function strtolower;

/**
 * Trusted Timestamping (RFC3161) utility class
 */
class TimestampUtils
{
    use ProcessTrait;

    private const TIMEOUT_SECONDS = 30;

    private array $trash = array();

    private FilesystemOperator $cacheFs;

    public function __construct(
        private ClientInterface $client,
        string $data,
        protected array $tsConfig,
        private TimestampResponse $tsResponse,
    ) {
        // save the data inside a temporary file so openssl can act on it
        $this->cacheFs = Storage::CACHE->getStorage()->getFs();
        $this->tsResponse = new TimestampResponse();
        $this->cacheFs->write(basename($this->tsResponse->dataPath), $data);
        $this->trash[] = basename($this->tsResponse->dataPath);
    }

    /**
     * Delete all temporary files once the process is completed
     */
    public function __destruct()
    {
        foreach ($this->trash as $file) {
            $this->cacheFs->delete($file);
        }
    }

    /**
     * Do the timestamp, verify it and return path to saved token on disk along with extracted timestamp
     */
    public function timestamp(): TimestampResponse
    {
        $requestFilePath = $this->createRequestfile();
        $response = $this->postData($requestFilePath);
        // save token to (temporary) file
        $this->cacheFs->write(basename($this->tsResponse->tokenPath), $response->getBody()->getContents());
        $this->verify();
        return $this->tsResponse;
    }

    protected function addAuthToRequest(array $options): array
    {
        if ($this->tsConfig['ts_login'] && $this->tsConfig['ts_password']) {
            $options['auth'] = array(
                $this->tsConfig['ts_login'],
                $this->tsConfig['ts_password'],
            );
        }
        return $options;
    }

    /**
     * Create a temporary Timestamp Requestfile from a file
     */
    private function createRequestfile(): string
    {
        $requestFilePath = FsTools::getCacheFile();

        $this->runProcess(array(
            'openssl',
            'ts',
            '-query',
            '-data',
            $this->tsResponse->dataPath,
            '-cert',
            '-' . $this->tsConfig['ts_hash'],
            '-no_nonce',
            '-out',
            $requestFilePath,
        ));
        // remove this file once we are done
        $this->trash[] = basename($requestFilePath);
        return $requestFilePath;
    }

    /**
     * Contact the TSA and receive a token after successful timestamp
     */
    private function postData(string $requestFilePath): \Psr\Http\Message\ResponseInterface
    {
        $options = array(
            // add user agent
            // http://developer.github.com/v3/#user-agent-required
            'headers' => array(
                'User-Agent' => 'Elabftw/' . BuildInfo::VERSION,
                'Content-Type' => 'application/timestamp-query',
                'Content-Transfer-Encoding' => 'base64',
            ),
            // add proxy if there is one
            'proxy' => Config::getConfig()->configArr['proxy'] ?? '',
            // add a timeout, because if you need proxy, but don't have it, it will mess up things
            'timeout' => self::TIMEOUT_SECONDS,
            'body' => file_get_contents($requestFilePath),
        );

        $options = $this->addAuthToRequest($options);

        try {
            return $this->client->request('POST', $this->tsConfig['ts_url'], $options);
        } catch (RequestException $e) {
            throw new ImproperActionException($e->getMessage(), $e->getCode(), $e);
        }
    }

    private function verify(): bool
    {
        if (!is_readable($this->tsConfig['ts_chain'])) {
            // no readable certificate chain means we don't do the verification
            return false;
        }

        $args = array(
            'openssl',
            'ts',
            '-verify',
            // skip cert validity check
            '-no_check_time',
            '-data',
            $this->tsResponse->dataPath,
            '-in',
            $this->tsResponse->tokenPath,
            '-CAfile',
            $this->tsConfig['ts_chain'],
        );
        // only add the untrusted certs argument if we have one (custom TSA doesn't provide it)
        // otherwise openssl fails with "Could not open file or uri for loading certificates of extra untrusted certs"
        if ($this->tsConfig['ts_cert'] !== '') {
            $args[] = '-untrusted';
            $args[] = $this->tsConfig['ts_cert'];
        }
        try {
            $this->runProcess($args);
        } catch (ProcessFailedException $e) {
            // Some TSAs emit tokens with an ESS signingCertificate attribute that does not
            // match the certificates of their chain, making the strict ESS cross-check of
            // openssl fail. Fall back to a manual verification (chain, signature, imprint)
            // which skips this ESS cross-check only.
            if (!str_contains($e->getMessage(), 'ess cert id')) {
                throw $e;
            }
            $this->verifyTokenManually();
        }
        return true;
    }

    /**
     * Verify the timestamp token without the ESS signingCertificate cross-check:
     * verify the CMS signature and signer certificate chain, and that the
     * message imprint in the token matches the timestamped data
     */
    private function verifyTokenManually(): void
    {
        // extract the CMS token from the timestamp response
        $cmsPath = FsTools::getCacheFile();
        $this->trash[] = basename($cmsPath);
        $this->runProcess(array('openssl', 'ts', '-reply', '-in', $this->tsResponse->tokenPath, '-token_out', '-out', $cmsPath));
        // verify the signature and the certificate chain of the signer
        // note: openssl cms has no -untrusted option, intermediate certs must be in the CAfile
        $tstInfoPath = FsTools::getCacheFile();
        $this->trash[] = basename($tstInfoPath);
        $this->runProcess(array(
            'openssl',
            'cms',
            '-verify',
            '-inform',
            'DER',
            '-in',
            $cmsPath,
            // TSA signing certs have an EKU limited to timeStamping
            '-purpose',
            'timestampsign',
            // skip cert validity check, as for the main verification
            '-no_check_time',
            '-CAfile',
            $this->tsConfig['ts_chain'],
            '-out',
            $tstInfoPath,
        ));
        $this->verifyImprint($tstInfoPath);
    }

    /**
     * Check that the message imprint found in the TSTInfo matches the hash of the data
     */
    private function verifyImprint(string $tstInfoPath): void
    {
        $tstInfo = $this->runProcess(array('openssl', 'asn1parse', '-inform', 'DER', '-in', $tstInfoPath));
        // the TSTInfo structure holds the message imprint as first OCTET STRING,
        // and its hash algorithm in the SEQUENCE just before it
        if (!preg_match('/OBJECT\s+:([a-zA-Z0-9-]+)\s*\n\s*\d+:d=\d+\s+hl=\d+\s+l=\s*\d+\s+prim:\s+NULL\s*\n\s*\d+:d=\d+\s+hl=\d+\s+l=\s*\d+\s+prim:\s+OCTET STRING\s+\[HEX DUMP\]:([0-9A-F]+)/', $tstInfo, $matches)) {
            throw new ImproperActionException('Could not extract message imprint from timestamp token.');
        }
        $algo = strtolower($matches[1]);
        if (!in_array($algo, hash_algos(), true)) {
            throw new ImproperActionException(sprintf('Unsupported hash algorithm in timestamp token: %s', $algo));
        }
        if (!hash_equals(strtolower($matches[2]), hash_file($algo, $this->tsResponse->dataPath))) {
            throw new ImproperActionException('The message imprint of the timestamp token does not match the data.');
        }
    }
}
