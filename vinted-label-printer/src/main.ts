import './style.css';

import { CARRIER_NAMES } from './detect/carrier.js';
import { describeOrigin, jobFromPage, jobsFromFile, type Job } from './jobs.js';
import { LABEL_SIZES } from './layout/fit.js';
import { drawLabel, renderLabel, type LabelSettings } from './output/label.js';
import { labelsToPdf } from './output/pdf.js';
import { printLabels } from './output/print.js';
import { qrPage } from './qr.js';
import { loadSettings, saveSettings, type StoredSettings } from './store.js';
import { openEditor } from './ui/editor.js';

const $ = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;

const jobs: Job[] = [];
let stored: StoredSettings = loadSettings();

const settings = (): LabelSettings => ({
  size: LABEL_SIZES.find((s) => s.id === stored.sizeId) ?? LABEL_SIZES[0]!,
  marginMm: stored.marginMm,
  rotate: stored.rotate,
  monochrome: stored.monochrome,
  dpi: stored.dpi,
});

// For the end-to-end tests: read state rather than scraping the DOM for it.
(window as unknown as { __labels: unknown }).__labels = { jobs, settings };

// ---- Settings -------------------------------------------------------------------

const settingsForm = $<HTMLFormElement>('#settings');
const sizeSelect = settingsForm.elements.namedItem('sizeId') as HTMLSelectElement;
sizeSelect.append(...LABEL_SIZES.map((s) => new Option(s.name, s.id)));

function showSettings() {
  const f = settingsForm.elements;
  (f.namedItem('sizeId') as HTMLSelectElement).value = stored.sizeId;
  (f.namedItem('marginMm') as HTMLInputElement).value = String(stored.marginMm);
  (f.namedItem('dpi') as HTMLSelectElement).value = String(stored.dpi);
  (f.namedItem('rotate') as HTMLInputElement).checked = stored.rotate;
  (f.namedItem('monochrome') as HTMLInputElement).checked = stored.monochrome;
}

settingsForm.addEventListener('input', () => {
  const f = settingsForm.elements;
  const margin = Number((f.namedItem('marginMm') as HTMLInputElement).value);
  stored = {
    sizeId: (f.namedItem('sizeId') as HTMLSelectElement).value,
    marginMm: Number.isFinite(margin) ? Math.min(15, Math.max(0, margin)) : stored.marginMm,
    dpi: Number((f.namedItem('dpi') as HTMLSelectElement).value),
    rotate: (f.namedItem('rotate') as HTMLInputElement).checked,
    monochrome: (f.namedItem('monochrome') as HTMLInputElement).checked,
  };
  saveSettings(stored);
  renderJobs();
});
settingsForm.addEventListener('submit', (e) => e.preventDefault());
showSettings();

// ---- Adding labels --------------------------------------------------------------

const message = $<HTMLParagraphElement>('#message');
function say(text: string) {
  message.textContent = text;
  message.hidden = !text;
}

let busy = 0;
async function addFiles(files: Iterable<File>) {
  const list = [...files];
  if (list.length === 0) return;
  say('');
  busy++;
  updateSummary();
  const problems: string[] = [];
  let blank = 0;
  for (const file of list) {
    try {
      const result = await jobsFromFile(file);
      jobs.push(...result.jobs);
      blank += result.blankPages;
      if (result.jobs.length === 0) problems.push(`${file.name} has nothing on it to print.`);
      renderJobs();
    } catch (error) {
      console.error(error);
      problems.push(error instanceof Error && /not a PDF/.test(error.message) ? error.message : `Could not read ${file.name}.`);
    }
  }
  busy--;
  if (blank > 0 && problems.length === 0) {
    say(`Skipped ${blank} blank ${blank === 1 ? 'page' : 'pages'}.`);
    message.classList.add('note');
  } else {
    message.classList.remove('note');
    say(problems.join(' '));
  }
  renderJobs();
}

const drop = $<HTMLLabelElement>('#drop');
const fileInput = $<HTMLInputElement>('#files');
fileInput.addEventListener('change', () => {
  void addFiles(fileInput.files ?? []);
  fileInput.value = '';
});
// Accept a drop anywhere on the page: aiming at the box is fiddly with a big PDF icon.
window.addEventListener('dragover', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  e.preventDefault();
  drop.classList.add('over');
});
window.addEventListener('dragleave', (e) => {
  if (e.relatedTarget === null) drop.classList.remove('over');
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  void addFiles(e.dataTransfer?.files ?? []);
});
window.addEventListener('paste', (e) => {
  const target = e.target as HTMLElement;
  if (target.closest('input, textarea')) return;
  const files = [...(e.clipboardData?.files ?? [])];
  if (files.length) {
    e.preventDefault();
    void addFiles(files);
  }
});

$<HTMLFormElement>('#qr-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget as HTMLFormElement;
  const data = new FormData(form);
  const content = String(data.get('content') ?? '').trim();
  if (!content) return;
  const { size } = settings();
  try {
    const page = await qrPage(content, String(data.get('caption') ?? '').trim(), size.widthMm, size.heightMm);
    const job = await jobFromPage(page, true);
    if (job) jobs.push(job);
    form.reset();
    say('');
  } catch (error) {
    console.error(error);
    say('That is too long to fit in a QR code.');
  }
  renderJobs();
});

// ---- The queue ------------------------------------------------------------------

const list = $<HTMLOListElement>('#jobs');
const THUMB_DPI = 72;

function renderJobs() {
  const s = settings();
  list.replaceChildren(
    ...jobs.map((job) => {
      const item = document.createElement('li');
      item.className = `job${job.include ? '' : ' excluded'}`;
      item.dataset.jobId = String(job.id);

      const thumb = drawLabel(job.page, job.preview, job.crop, s, THUMB_DPI, false);
      thumb.className = 'job-thumb';
      thumb.title = 'Adjust the crop';
      thumb.setAttribute('role', 'img');
      thumb.setAttribute('aria-label', `Label preview for ${job.page.fileName}`);
      thumb.addEventListener('click', () => edit(job));

      const name = document.createElement('p');
      name.className = 'job-name';
      name.textContent =
        job.page.pageCount > 1 ? `${job.page.fileName} · page ${job.page.pageNumber}` : job.page.fileName;

      const meta = document.createElement('p');
      meta.className = 'job-meta';
      const pill = document.createElement('span');
      pill.className = 'pill carrier';
      pill.textContent = CARRIER_NAMES[job.carrier];
      if (job.carrier === 'unknown') pill.hidden = true;
      const origin = document.createElement('span');
      origin.className = 'origin';
      origin.textContent = describeOrigin(job);
      meta.append(pill, origin);

      const actions = document.createElement('div');
      actions.className = 'job-actions';
      const include = document.createElement('label');
      include.className = 'check';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = job.include;
      box.addEventListener('change', () => {
        job.include = box.checked;
        renderJobs();
      });
      include.append(box, 'Print');
      const adjust = document.createElement('button');
      adjust.type = 'button';
      adjust.textContent = 'Adjust';
      adjust.addEventListener('click', () => edit(job));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'quiet';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove ${job.page.fileName}`);
      remove.addEventListener('click', () => {
        jobs.splice(jobs.indexOf(job), 1);
        renderJobs();
      });
      actions.append(include, adjust, remove);

      item.append(thumb, name, meta, actions);
      return item;
    }),
  );
  updateSummary();
}

function edit(job: Job) {
  openEditor(job, settings, renderJobs);
}

const summary = $<HTMLParagraphElement>('#summary');
const printButton = $<HTMLButtonElement>('#print');
const downloadButton = $<HTMLButtonElement>('#download');
const clearButton = $<HTMLButtonElement>('#clear');
let working = false;

function updateSummary() {
  const count = jobs.filter((j) => j.include).length;
  summary.textContent = busy
    ? 'Reading…'
    : working
      ? 'Preparing labels…'
      : jobs.length === 0
        ? 'No labels yet.'
        : `${count} ${count === 1 ? 'label' : 'labels'} to print`;
  printButton.disabled = downloadButton.disabled = count === 0 || working || busy > 0;
  clearButton.disabled = jobs.length === 0 || working;
  printButton.textContent = count > 1 ? `Print ${count}` : 'Print';
}

async function renderIncluded(): Promise<HTMLCanvasElement[]> {
  const s = settings();
  const out: HTMLCanvasElement[] = [];
  for (const job of jobs.filter((j) => j.include)) out.push(await renderLabel(job.page, job.crop, s));
  return out;
}

async function withLabels(action: (labels: HTMLCanvasElement[]) => Promise<void>) {
  working = true;
  updateSummary();
  try {
    await action(await renderIncluded());
    say('');
  } catch (error) {
    console.error(error);
    say('Something went wrong preparing the labels.');
  } finally {
    working = false;
    updateSummary();
  }
}

printButton.addEventListener('click', () => withLabels((labels) => printLabels(labels, settings().size)));

downloadButton.addEventListener('click', () =>
  withLabels(async (labels) => {
    const bytes = await labelsToPdf(labels, settings().size);
    const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }));
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
    a.href = url;
    a.download = `labels-${stamp}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }),
);

clearButton.addEventListener('click', () => {
  jobs.length = 0;
  say('');
  renderJobs();
});

renderJobs();
