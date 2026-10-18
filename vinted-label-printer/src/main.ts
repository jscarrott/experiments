import './style.css';

import { CARRIER_NAMES } from './detect/carrier.js';
import { describeOrigin, jobFromPage, jobsFromFile, type Job } from './jobs.js';
import { LABEL_SIZES } from './layout/fit.js';
import { drawLabel, renderLabel, type LabelSettings } from './output/label.js';
import { SHEET_LAYOUTS } from './layout/sheet.js';
import { pagesToPdf } from './output/pdf.js';
import { printPages } from './output/print.js';
import { composeSheets } from './output/sheet.js';
import * as app from './native.js';
import { canShareFiles, registerServiceWorker, takeSharedFiles } from './pwa.js';
import { qrPage } from './qr.js';
import { loadSettings, saveSettings, type StoredSettings } from './store.js';
import { openEditor } from './ui/editor.js';

const $ = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;

const jobs: Job[] = [];
let stored: StoredSettings = loadSettings();

const sheetLayout = () => SHEET_LAYOUTS.find((l) => l.id === stored.output);

/** Where the first label goes on the first A4 sheet; 0-based. Not remembered between visits. */
let startAt = 0;

/** On A4, each label is drawn at its cell's size; on a label printer, at the stock size. */
function labelSize() {
  const layout = sheetLayout();
  if (!layout) return LABEL_SIZES.find((s) => s.id === stored.sizeId) ?? LABEL_SIZES[0]!;
  const cell = layout.cells[0]!;
  return { id: layout.id, name: layout.name, widthMm: cell.widthMm, heightMm: cell.heightMm };
}

const settings = (): LabelSettings => ({
  size: labelSize(),
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
const outputSelect = settingsForm.elements.namedItem('output') as HTMLSelectElement;
outputSelect.append(...SHEET_LAYOUTS.map((l) => new Option(l.name, l.id)), new Option('Label printer', 'label'));
const startSelect = settingsForm.elements.namedItem('startAt') as HTMLSelectElement;

/** Show the controls that apply to the chosen output, and list its start positions. */
function showOutputControls() {
  const layout = sheetLayout();
  for (const el of settingsForm.querySelectorAll<HTMLElement>('[data-for]')) {
    el.hidden = el.dataset.for !== (layout ? 'sheet' : 'label');
  }
  if (!layout) return;
  startAt = Math.min(startAt, layout.cells.length - 1);
  startSelect.replaceChildren(...layout.positions.map((name, i) => new Option(name, String(i))));
  startSelect.value = String(startAt);
  (startSelect.closest('label') as HTMLElement).hidden = layout.cells.length === 1;
}

function showSettings() {
  const f = settingsForm.elements;
  outputSelect.value = sheetLayout() ? stored.output : 'label';
  (f.namedItem('cutGuides') as HTMLInputElement).checked = stored.cutGuides;
  (f.namedItem('sizeId') as HTMLSelectElement).value = stored.sizeId;
  (f.namedItem('marginMm') as HTMLInputElement).value = String(stored.marginMm);
  (f.namedItem('dpi') as HTMLSelectElement).value = String(stored.dpi);
  (f.namedItem('rotate') as HTMLInputElement).checked = stored.rotate;
  (f.namedItem('monochrome') as HTMLInputElement).checked = stored.monochrome;
}

settingsForm.addEventListener('input', () => {
  const f = settingsForm.elements;
  const margin = Number((f.namedItem('marginMm') as HTMLInputElement).value);
  // A position on one layout means nothing on another: start a new layout at the top.
  startAt = outputSelect.value === stored.output ? Number(startSelect.value) || 0 : 0;
  stored = {
    output: outputSelect.value,
    cutGuides: (f.namedItem('cutGuides') as HTMLInputElement).checked,
    sizeId: (f.namedItem('sizeId') as HTMLSelectElement).value,
    marginMm: Number.isFinite(margin) ? Math.min(15, Math.max(0, margin)) : stored.marginMm,
    dpi: Number((f.namedItem('dpi') as HTMLSelectElement).value),
    rotate: (f.namedItem('rotate') as HTMLInputElement).checked,
    monochrome: (f.namedItem('monochrome') as HTMLInputElement).checked,
  };
  saveSettings(stored);
  showOutputControls();
  renderJobs();
});
settingsForm.addEventListener('submit', (e) => e.preventDefault());
showSettings();
showOutputControls();
// On a phone the open settings push the labels a screen down; they are set once and
// rarely touched, so start them folded away.
if (matchMedia('(max-width: 760px)').matches) $<HTMLDetailsElement>('#settings-panel').open = false;

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
      if (result.blankBrowserPrint) {
        problems.push(
          `${file.name} is a blank page. It was saved with a browser's “Save as PDF”, which ` +
            'often captures an online PDF viewer without the label in it. Use the download ' +
            'button in the viewer to get the original label PDF, and add that instead.',
        );
      } else if (result.jobs.length === 0) {
        problems.push(`${file.name} has nothing on it to print.`);
      }
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
const shareButton = $<HTMLButtonElement>('#share');
shareButton.hidden = !app.isApp() && !canShareFiles();
if (app.isApp()) downloadButton.textContent = 'Save PDF';
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
  printButton.disabled = downloadButton.disabled = shareButton.disabled = count === 0 || working || busy > 0;
  clearButton.disabled = jobs.length === 0 || working;
  printButton.textContent = count > 1 ? `Print ${count}` : 'Print';
}

/** The printed pages, each with its paper size: labels, or A4 sheets of them. */
async function renderPages() {
  const s = settings();
  const labels: HTMLCanvasElement[] = [];
  for (const job of jobs.filter((j) => j.include)) labels.push(await renderLabel(job.page, job.crop, s));
  const layout = sheetLayout();
  if (!layout) return { pages: labels, paper: s.size };
  return { pages: composeSheets(labels, layout, startAt, s.dpi, stored.cutGuides), paper: layout.paper };
}

async function withPages(action: (pages: HTMLCanvasElement[], paper: { widthMm: number; heightMm: number }) => Promise<void>) {
  working = true;
  updateSummary();
  try {
    const { pages, paper } = await renderPages();
    await action(pages, paper);
    say('');
  } catch (error) {
    console.error(error);
    say('Something went wrong preparing the labels.');
  } finally {
    working = false;
    updateSummary();
  }
}


async function labelsPdf(pages: HTMLCanvasElement[], paper: { widthMm: number; heightMm: number }) {
  const bytes = await pagesToPdf(pages, paper);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  return new File([bytes as Uint8Array<ArrayBuffer>], `labels-${stamp}.pdf`, { type: 'application/pdf' });
}

printButton.addEventListener('click', () =>
  withPages(async (pages, paper) => {
    if (app.isApp()) await app.printPdf(await labelsPdf(pages, paper), paper);
    else await printPages(pages, paper);
  }),
);

downloadButton.addEventListener('click', () =>
  withPages(async (pages, paper) => {
    const file = await labelsPdf(pages, paper);
    if (app.isApp()) {
      await app.savePdf(file);
      return;
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }),
);

// On a phone, the way to a printer is often another app: a printer maker's app, or
// a thermal printer's own. Share hands it the finished PDF.
shareButton.addEventListener('click', () =>
  withPages(async (pages, paper) => {
    const file = await labelsPdf(pages, paper);
    if (app.isApp()) {
      await app.sharePdf(file);
      return;
    }
    try {
      await navigator.share({ files: [file], title: file.name });
    } catch (error) {
      // Closing the share sheet is not an error worth reporting.
      if (!(error instanceof DOMException && error.name === 'AbortError')) throw error;
    }
  }),
);

clearButton.addEventListener('click', () => {
  jobs.length = 0;
  say('');
  renderJobs();
});

renderJobs();

if (app.isApp()) {
  // The app serves itself from inside the APK; it has no need of a service worker.
  app.onSharedFiles((files, skipped) => {
    void addFiles(files);
    if (skipped.length) say(`Could not open ${skipped.join(', ')}.`);
  });
} else {
  if (import.meta.env.PROD) registerServiceWorker();
  void takeSharedFiles().then(addFiles);
}
