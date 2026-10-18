/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2024 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */
import { ApiC } from './api';
import { notify } from './notify';
import { collectForm, rebuildTomSelectOptions, reloadElements, resetToDefault, TomSelect, TomSelectElement } from './misc';
import i18next from './i18n';
import { on } from './handlers';

// populate selects for category/templates when importing csv
const populateSelect = async (select: TomSelectElement, endpoint?: string): Promise<void> => {
  resetToDefault(select);

  // Remove previous dynamic options, but keep the placeholder option.
  for (let i = select.options.length - 1; i >= 1; i--) {
    select.remove(i);
  }

  if (endpoint) {
    const entries = await ApiC.getJson(endpoint);

    entries.forEach(entry => {
      const newOption = document.createElement('option');
      newOption.value = entry.id;
      newOption.text = entry.title;
      select.add(newOption);
    });
  }

  rebuildTomSelectOptions(select, {
    filter: option => option.value !== '',
  });
};

if (window.location.pathname === '/profile.php') {
  ['importSelectTemplate', 'importSelectCategory', 'importSelectOwner'].forEach(id => {
    const select = document.getElementById(id) as HTMLSelectElement | null;
    if (select) {
      new TomSelect(select, {
        plugins: ['dropdown_input', 'no_active_items', 'clear_button'],
        placeholder: select.options[0]?.text,
      });
    }
  });

  // we use a normal button to trigger the actual file input
  on('show-file-input', () => document.getElementById('importFileInput').click());

  on('create-export', () => {
    const params = collectForm(document.getElementById('exportForm'));
    const urlParams = new URLSearchParams(params as URLSearchParams);
    ApiC.post('exports', {
      experiments: urlParams.get('experiments'),
      experiments_templates: urlParams.get('experiments_templates'),
      items: urlParams.get('items'),
      items_types: urlParams.get('items_types'),
      format: urlParams.get('format'),
      changelog: urlParams.get('changelog'),
      pdfa: urlParams.get('pdfa'),
      json: urlParams.get('json'),
    }).then(() => reloadElements(['exportedFilesTable']));
  });

  on('destroy-export', (el: HTMLElement) => ApiC.delete(`exports/${el.dataset.id}`)
    .then(() => reloadElements(['exportedFilesTable'])));

  on('get-compounds-history', (el: HTMLElement, event: Event) => {
    event.preventDefault();
    const form = document.getElementById('compoundsHistoryForm');
    const params = collectForm(form);
    window.location.href = `/api/v2/reports?scope=compounds_history&format=csv&start=${encodeURIComponent(params['start'])}&end=${encodeURIComponent(params['end'])}`;
  });

  document.getElementById('importFileInput')?.addEventListener('change', async function(event) {
    const importOptionsDiv = document.getElementById('importOptionsDiv') as HTMLElement;
    const attachedFile = document.getElementById('attachedFile') as HTMLElement;
    attachedFile.removeAttribute('hidden');
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (files.length === 0) {
      return;
    }
    // display the selected file name(s) on screen
    const fileName = files.length === 1 ? files[0].name : files.map(f => f.name).join(', ');
    const fileNameDiv = document.getElementById('fileName');
    if (fileNameDiv) {
      fileNameDiv.textContent = fileName;
      fileNameDiv.title = files.map(f => f.name).join('\n');
      // make sure previous error message is removed first
      fileNameDiv.classList.remove('alert-danger', 'm-2', 'p-2', 'rounded', 'border');
    }
    // when the file is selected, validate the file size before showing options or proceeding
    const maxsize = await ApiC.getJson('import').then(json => json.max_filesize);
    const oversizedFiles = files.filter(f => f.size > maxsize);
    if (oversizedFiles.length > 0) {
      notify.error('file-too-large');
      fileNameDiv?.classList.add('alert-danger', 'm-2', 'p-2', 'rounded', 'border');
      importOptionsDiv.setAttribute('hidden', 'hidden');
      return;
    }

    const isEln = files.every(f => f.name.endsWith('.eln'));
    const isCsv = files.every(f => f.name.endsWith('.csv'));
    if (!isEln && !isCsv) {
      notify.error('Please select only .eln files or only .csv files');
      fileNameDiv?.classList.add('alert-danger', 'm-2', 'p-2', 'rounded', 'border');
      importOptionsDiv.setAttribute('hidden', 'hidden');
      return;
    }

    importOptionsDiv.removeAttribute('hidden');
    // toggle the eln/csv options depending on file extension
    document.querySelectorAll('[data-showif="eln"]')
      .forEach((el: HTMLElement) => isEln ? el.removeAttribute('hidden') : el.hidden = true);
    // we want to let the .eln file decide which kind of entry it is by default
    const targetElement = 'entityTypeRadio' + (isEln ? 'None' : 'Experiments');
    const targetRadio = document.getElementById(targetElement) as HTMLInputElement;
    targetRadio.checked = true;
    targetRadio.dispatchEvent(new Event('change', {bubbles: true}));
  });

  // when selecting the target type, change the category and template listings
  document.getElementById('importRadioEntityType').addEventListener('change', async function(event) {
    const el = event.target as HTMLInputElement;
    const selectCategoryDiv = document.getElementById('selectCategoryDiv') as HTMLElement;
    const selectTemplateDiv = document.getElementById('selectTemplateDiv') as HTMLElement;
    const categorySelect = document.getElementById('importSelectCategory') as TomSelectElement;
    const templateSelect = document.getElementById('importSelectTemplate') as TomSelectElement;

    // template select
    const templateTypes: Record<string, string> = {
      experiments: 'experiments_templates',
      items: 'items_types',
    };
    const templateType = templateTypes[el.value];
    const supportsTemplate = templateType !== undefined;
    selectTemplateDiv.hidden = !supportsTemplate;
    templateSelect.disabled = !supportsTemplate;
    if (supportsTemplate) {
      templateSelect.tomselect?.enable();
    } else {
      templateSelect.tomselect?.disable();
    }
    categorySelect.tomselect?.setValue('', true);
    templateSelect.tomselect?.setValue('', true);
    await populateSelect(templateSelect, templateType);

    // categories select
    selectCategoryDiv.hidden = el.value === '';
    if (selectCategoryDiv.hidden) return;
    const categoryTypes: Record<string, string> = {
      experiments: 'experiments_categories',
      experiments_templates: 'experiments_categories',
      items: 'resources_categories',
      items_types: 'resources_categories',
    };
    const categoryType = categoryTypes[el.value] ?? el.value;
    await populateSelect(categorySelect, `teams/current/${categoryType}`);
  });

  document.getElementById('importFileForm')?.addEventListener('submit', async function(event) {
    event.preventDefault();
    // start by making sure the result div is empty
    const resultDiv = document.getElementById('importResultDiv');
    if (resultDiv) {
      resultDiv.innerHTML = '';
    }

    const input = document.getElementById('importFileInput') as HTMLInputElement;
    const files = Array.from(input?.files ?? []);
    if (files.length === 0) {
      return;
    }

    // disable the submit button and show "please wait"
    const submitBtn = document.getElementById('importFileBtn') as HTMLButtonElement;
    submitBtn.disabled = true;
    const originalBtnContent = submitBtn.textContent;
    submitBtn.textContent = i18next.t('please-wait');

    // now submit the form
    const form = event.target as HTMLFormElement;

    const buildFormDataForFile = (file: File): FormData => {
      const formData = new FormData(form);
      formData.delete('file');
      formData.set('file', file);
      // prevent the browser from redirecting us
      formData.set('extraParam', 'noRedirect');
      if (!formData.get('entity_type')) {
        formData.delete('entity_type');
      }
      if (!formData.get('category')) {
        formData.delete('category');
      }
      if (!formData.get('template')) {
        formData.delete('template');
      }
      return formData;
    };

    try {
      if (files.length === 1) {
        const response = await fetch(form.action, {
          method: 'POST',
          body: buildFormDataForFile(files[0]),
        });
        if (response.status === 201) {
          notify.success('file-imported');
        } else {
          const error = await response.json();
          notify.error(error.message);
        }
      } else {
        let successCount = 0;
        const errors: string[] = [];

        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          submitBtn.textContent = `${i18next.t('please-wait')} (${i + 1}/${files.length})`;
          try {
            const response = await fetch(form.action, {
              method: 'POST',
              body: buildFormDataForFile(file),
            });
            if (response.status === 201) {
              successCount++;
            } else {
              const error = await response.json().catch(() => ({ message: `HTTP ${response.status}` }));
              errors.push(`${file.name}: ${error.message}`);
            }
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            errors.push(`${file.name}: ${message}`);
          }
        }

        if (errors.length === 0) {
          notify.success(files.length > 1 ? `${files.length} ${i18next.t('file-imported')}` : 'file-imported');
        } else {
          for (const err of errors) {
            notify.error(err);
          }
          if (successCount > 0) {
            notify.success(`${successCount}/${files.length} ${i18next.t('file-imported')}`);
          }
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      notify.error(`Import error: ${message}`);
    } finally {
      submitBtn.removeAttribute('disabled');
      submitBtn.textContent = originalBtnContent;
    }
  });
}
