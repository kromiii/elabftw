<?php

/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2022 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Make;

use Elabftw\Elabftw\FsTools;
use Elabftw\Params\Guard;
use Override;

use function file_get_contents;
use function file_put_contents;
use function in_array;
use function is_readable;

/**
 * RFC3161 timestamping with a custom TSA
 */
final class MakeCustomTimestamp extends AbstractMakeTrustedTimestamp
{
    #[Override]
    protected function getPassword(): string
    {
        $password = '';
        if (($this->configArr['ts_password'] ?? '') !== '') {
            $password = $this->configArr['ts_password'];
        }
        return $password;
    }

    #[Override]
    protected function getUrl(): string
    {
        return Guard::getNonEmptyStringValueOfRequiredParam('ts_url', $this->configArr);
    }

    #[Override]
    protected function getChain(): string
    {
        $customChain = $this->configArr['ts_cert'] ?? '';
        if ($customChain === '') {
            return '/etc/ssl/cert.pem';
        }
        // a custom CA chain is configured: combine it with the system bundle so both
        // private and public roots can be trusted, and save it in cache for openssl
        $systemBundle = is_readable('/etc/ssl/cert.pem') ? file_get_contents('/etc/ssl/cert.pem') : '';
        $chainPath = FsTools::getCacheFolder('elab') . '/custom-tsa-chain.pem';
        file_put_contents($chainPath, $systemBundle . "\n" . $customChain);
        return $chainPath;
    }

    #[Override]
    protected function getHash(): string
    {
        $hash = $this->configArr['ts_hash'];
        if (!in_array($hash, self::ALLOWED_HASH_ALGOS, true)) {
            return self::TS_HASH;
        }
        return $hash;
    }
}
