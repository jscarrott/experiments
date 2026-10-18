import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

import { vintedStylePdf } from './fixtures';

/**
 * The page as it runs inside the Android app. The emulator cannot run here, so the
 * native side is stood in for at the Capacitor bridge: the same plugin headers,
 * nativePromise and nativeCallback the Android bridge provides. Every call the page
 * makes to LabelPrinterPlugin.java is recorded for the test to inspect.
 */
async function asApp(page: Page, shared: { name: string; type: string; data: string }[] = []) {
  await page.addInitScript((initial) => {
    const w = window as any;
    const pending = [...initial];
    const listeners: Record<string, (data: unknown) => void> = {};
    w.__native = { calls: [] as { method: string; options: any }[], pending, listeners };
    w.androidBridge = { postMessage() {} };
    w.Capacitor = {
      PluginHeaders: [
        {
          name: 'LabelPrinter',
          methods: [
            { name: 'takeSharedFiles', rtype: 'promise' },
            { name: 'printPdf', rtype: 'promise' },
            { name: 'savePdf', rtype: 'promise' },
            { name: 'sharePdf', rtype: 'promise' },
            { name: 'addListener', rtype: 'callback' },
            { name: 'removeListener', rtype: 'promise' },
          ],
        },
      ],
      nativePromise(_plugin: string, method: string, options: any) {
        w.__native.calls.push({ method, options });
        if (method === 'takeSharedFiles') return Promise.resolve({ files: pending.splice(0), skipped: [] });
        if (method === 'savePdf') return Promise.resolve({ saved: true });
        return Promise.resolve();
      },
      nativeCallback(_plugin: string, method: string, options: any, callback: (data: unknown) => void) {
        if (method === 'addListener') listeners[options.eventName] = callback;
        return String(Object.keys(listeners).length);
      },
    };
  }, shared);
}

const calls = (page: Page) => page.evaluate(() => (window as any).__native.calls.map((c: any) => c.method));

async function pdfArg(page: Page, method: string) {
  const b64 = await page.evaluate(
    (m) => (window as any).__native.calls.find((c: any) => c.method === m).options.data,
    method,
  );
  return PDFDocument.load(Buffer.from(b64, 'base64'));
}

test('a label shared to the app on launch is cropped, and prints through Android', async ({ page }) => {
  const data = (await vintedStylePdf('Evri')).toString('base64');
  await asApp(page, [{ name: 'evri-label.pdf', type: 'application/pdf', data }]);
  await page.goto('/');

  await expect(page.locator('.job')).toHaveCount(1);
  await expect(page.locator('.job .carrier')).toHaveText('Evri');
  await expect(page.locator('#download')).toHaveText('Save PDF');
  await expect(page.locator('#share')).toBeVisible();

  await page.getByRole('button', { name: 'Print' }).click();
  await expect.poll(() => calls(page)).toContain('printPdf');
  const options = await page.evaluate(
    () => (window as any).__native.calls.find((c: any) => c.method === 'printPdf').options,
  );
  expect(options).toMatchObject({ widthMm: 210, heightMm: 297 });
  expect(options.name).toMatch(/^labels-.*\.pdf$/);
  const pdf = await pdfArg(page, 'printPdf');
  expect(pdf.getPageCount()).toBe(1);
  expect(pdf.getPage(0).getSize().width).toBeCloseTo(595.3, 0);
});

test('a label shared while the app is open is picked up', async ({ page }) => {
  await asApp(page);
  await page.goto('/');
  await expect.poll(() => calls(page)).toContain('takeSharedFiles');
  await expect(page.locator('.job')).toHaveCount(0);

  const data = (await vintedStylePdf('InPost')).toString('base64');
  await page.evaluate((d) => {
    const n = (window as any).__native;
    n.pending.push({ name: 'inpost.pdf', type: 'application/pdf', data: d });
    n.listeners.shared({});
  }, data);
  await expect(page.locator('.job .carrier')).toHaveText('InPost');
});

test('Save and Share hand the PDF to Android rather than the browser', async ({ page }) => {
  const data = (await vintedStylePdf('Royal Mail')).toString('base64');
  await asApp(page, [{ name: 'rm.pdf', type: 'application/pdf', data }]);
  await page.goto('/');
  await expect(page.locator('.job')).toHaveCount(1);

  let downloaded = false;
  page.on('download', () => (downloaded = true));
  await page.getByRole('button', { name: 'Save PDF' }).click();
  await expect.poll(() => calls(page)).toContain('savePdf');
  expect((await pdfArg(page, 'savePdf')).getPageCount()).toBe(1);

  await page.getByRole('button', { name: 'Share' }).click();
  await expect.poll(() => calls(page)).toContain('sharePdf');
  expect(downloaded).toBe(false);

  // No service worker inside the app: it serves itself from the APK.
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
});
