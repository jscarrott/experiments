import { readFile } from 'node:fs/promises';

import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

import { vintedStylePdf } from './fixtures';

async function downloadPdf(page: Page) {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  return PDFDocument.load(await readFile((await (await downloadPromise).path())!));
}

async function downloadPageCount(page: Page) {
  return (await downloadPdf(page)).getPageCount();
}

async function state(page: Page) {
  return page.evaluate(() => {
    const app = (window as any).__labels;
    return app.jobs.map((j: any) => ({
      carrier: j.carrier,
      origin: j.origin,
      crop: j.crop,
      pageNumber: j.page.pageNumber,
    }));
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.clear();
    } catch {
      /* storage blocked; the app copes */
    }
  });
});

test('an A4 Evri sheet is cropped and printed on A4, four to a sheet, by default', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));

  await page.goto('/');
  await page.locator('#files').setInputFiles({
    name: 'evri-label.pdf',
    mimeType: 'application/pdf',
    buffer: await vintedStylePdf('Evri'),
  });

  await expect(page.locator('.job')).toHaveCount(1);
  await expect(page.locator('#message')).toHaveText('Skipped 1 blank page.');
  await expect(page.locator('.job .carrier')).toHaveText('Evri');

  const [job] = await state(page);
  expect(job.pageNumber).toBe(1);
  // The label is 100 × 150 mm at (10, 10) on 210 × 297 mm: the crop should hug it.
  const mm = { x: job.crop.x * 210, y: job.crop.y * 297, w: job.crop.w * 210, h: job.crop.h * 297 };
  expect(mm.x).toBeGreaterThan(5);
  expect(mm.x).toBeLessThan(10.5);
  expect(mm.y).toBeGreaterThan(5);
  expect(mm.y).toBeLessThan(10.5);
  expect(mm.x + mm.w).toBeGreaterThan(109.5);
  expect(mm.x + mm.w).toBeLessThan(114);
  expect(mm.y + mm.h).toBeGreaterThan(159.5);
  expect(mm.y + mm.h).toBeLessThan(165);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^labels-\d{8}-\d{4}\.pdf$/);
  const pdf = await PDFDocument.load(await readFile((await download.path())!));
  expect(pdf.getPageCount()).toBe(1);
  const { width, height } = pdf.getPage(0).getSize();
  expect(width).toBeCloseTo(595.3, 0); // A4
  expect(height).toBeCloseTo(841.9, 0);

  expect(errors).toEqual([]);
  const offsite = requests.filter((u) => !u.startsWith('http://localhost:4174') && !u.startsWith('blob:') && !u.startsWith('data:'));
  expect(offsite).toEqual([]);
});

test('carriers are told apart, and a batch downloads as one PDF', async ({ page }) => {
  await page.goto('/');
  await page.locator('#files').setInputFiles([
    { name: 'a.pdf', mimeType: 'application/pdf', buffer: await vintedStylePdf('InPost') },
    { name: 'b.pdf', mimeType: 'application/pdf', buffer: await vintedStylePdf('Royal Mail') },
    { name: 'c.pdf', mimeType: 'application/pdf', buffer: await vintedStylePdf('Evri', { blankSecondPage: false }) },
  ]);
  await expect(page.locator('.job')).toHaveCount(3);
  expect((await state(page)).map((j: any) => j.carrier)).toEqual(['inpost', 'royal-mail', 'evri']);
  await expect(page.locator('#print')).toHaveText('Print 3');

  // Leave one out.
  await page.locator('.job').nth(1).getByLabel('Print').uncheck();
  await expect(page.locator('#summary')).toHaveText('2 labels to print');

  // Two labels fit on one A4 sheet, four up.
  expect(await downloadPageCount(page)).toBe(1);
});

test('a half-used sticker sheet is finished before a new one is started', async ({ page }) => {
  await page.goto('/');
  const files = await Promise.all(
    ['a', 'b', 'c'].map(async (name) => ({
      name: `${name}.pdf`,
      mimeType: 'application/pdf',
      buffer: await vintedStylePdf('Evri'),
    })),
  );
  await page.locator('#files').setInputFiles(files);
  await expect(page.locator('.job')).toHaveCount(3);

  expect(await downloadPageCount(page)).toBe(1);
  // Two stickers used: start at the bottom left, so the third label spills onto sheet two.
  await page.getByLabel('Start at').selectOption('Bottom left');
  expect(await downloadPageCount(page)).toBe(2);

  // Two per sheet: three labels need two sheets from the top.
  await page.getByLabel('Print on').selectOption('a4-2');
  await expect(page.getByLabel('Start at')).toHaveValue('0');
  expect(await downloadPageCount(page)).toBe(2);
});

test('a label printer gets one 4×6 page per label', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Print on').selectOption('label');
  await expect(page.getByLabel('Start at')).toBeHidden();
  await page.locator('#files').setInputFiles([
    { name: 'a.pdf', mimeType: 'application/pdf', buffer: await vintedStylePdf('Evri') },
    { name: 'b.pdf', mimeType: 'application/pdf', buffer: await vintedStylePdf('InPost') },
  ]);
  await expect(page.locator('.job')).toHaveCount(2);
  const pdf = await downloadPdf(page);
  expect(pdf.getPageCount()).toBe(2);
  const { width, height } = pdf.getPage(0).getSize();
  expect(width).toBeCloseTo(288, 0); // 4 in
  expect(height).toBeCloseTo(432, 0); // 6 in
});

test('a hand-adjusted crop can be saved and is reused for the next label from that carrier', async ({ page }) => {
  await page.goto('/');
  await page.locator('#files').setInputFiles({
    name: 'first.pdf',
    mimeType: 'application/pdf',
    buffer: await vintedStylePdf('Evri'),
  });
  await page.getByRole('button', { name: 'Adjust' }).click();
  const dialog = page.locator('#editor');
  await expect(dialog).toBeVisible();

  // Nudge the box with the keyboard, then save it for Evri.
  await page.locator('.crop-box').press('Shift+ArrowRight');
  await page.locator('.crop-box').press('Shift+ArrowRight');
  const [adjusted] = await state(page);
  expect(adjusted.origin).toBe('manual');
  await dialog.getByRole('button', { name: 'Use this crop for all Evri labels' }).click();
  await expect(dialog.locator('.editor-saved')).toHaveText('Saved as the crop for Evri labels.');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();

  await page.locator('#files').setInputFiles([
    { name: 'second.pdf', mimeType: 'application/pdf', buffer: await vintedStylePdf('Evri') },
    { name: 'third.pdf', mimeType: 'application/pdf', buffer: await vintedStylePdf('InPost') },
  ]);
  await expect(page.locator('.job')).toHaveCount(3);
  const [, second, third] = await state(page);
  expect(second.origin).toBe('saved');
  expect(second.crop.x).toBeCloseTo(adjusted.crop.x, 5);
  expect(third.origin).toBe('auto');
  await expect(page.locator('.job').nth(1).locator('.origin')).toHaveText('Your saved Evri crop');
});

test('a QR label is made from a link and fills the label', async ({ page }) => {
  await page.goto('/');
  await page.getByText('QR code label').click();
  await page.getByLabel('Code or link').fill('https://example.com/parcel/ABC123');
  await page.getByLabel('Caption (optional)').fill('Order 42');
  await page.getByRole('button', { name: 'Add QR label' }).click();
  await expect(page.locator('.job')).toHaveCount(1);
  const [job] = await state(page);
  expect(job.origin).toBe('whole');
  expect(job.crop).toEqual({ x: 0, y: 0, w: 1, h: 1 });
});

test('printing opens the print dialog on A4 at actual size', async ({ page }) => {
  // Stub print so the test does not block on a dialog, and report what it would print.
  await page.addInitScript(() => {
    window.print = () => {
      (window as any).__printed = {
        images: document.querySelectorAll('#print-pages img').length,
        css: [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n'),
      };
    };
  });
  await page.goto('/');
  await page.locator('#files').setInputFiles({
    name: 'evri.pdf',
    mimeType: 'application/pdf',
    buffer: await vintedStylePdf('Evri'),
  });
  await expect(page.locator('.job')).toHaveCount(1);

  await page.getByRole('button', { name: 'Print' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__printed?.images)).toBe(1);
  const css = await page.evaluate(() => (window as any).__printed.css);
  expect(css).toContain('size: 210mm 297mm');
});

test('a blank page printed from a browser viewer explains how to get the real label', async ({ page }) => {
  // What Firefox's "Save as PDF" of Adobe's online viewer produces: one empty page.
  const doc = await PDFDocument.create();
  doc.setCreator('Firefox');
  doc.setProducer('Skia/PDF m149');
  doc.addPage([612, 792]);
  const blankPrint = Buffer.from(await doc.save());

  await page.goto('/');
  await page.locator('#files').setInputFiles({
    name: 'Vinted-Label - Adobe cloud storage.pdf',
    mimeType: 'application/pdf',
    buffer: blankPrint,
  });
  await expect(page.locator('#message')).toContainText('is a blank page');
  await expect(page.locator('#message')).toContainText('download button');
  await expect(page.locator('.job')).toHaveCount(0);
});
