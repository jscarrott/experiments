import { expect, test } from '@playwright/test';

import { vintedStylePdf } from './fixtures';

/**
 * The installable-app side. A real Android share cannot be driven from Playwright,
 * so the share is reproduced by POSTing the same multipart form Android sends, from
 * inside the page so that it goes through the service worker.
 */

test('the manifest makes the app installable and a share target for PDFs', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifest = await (await request.get(new URL(href!, page.url()).href)).json();

  expect(manifest.display).toBe('standalone');
  const sizes = manifest.icons.map((i: any) => `${i.sizes} ${i.purpose}`);
  expect(sizes).toEqual(expect.arrayContaining(['192x192 any', '512x512 any', '512x512 maskable']));
  for (const icon of manifest.icons) {
    const res = await request.get(new URL(icon.src, page.url()).href);
    expect(res.status(), icon.src).toBe(200);
    expect(res.headers()['content-type']).toBe('image/png');
  }
  expect(manifest.share_target).toMatchObject({ method: 'POST', enctype: 'multipart/form-data' });
  expect(manifest.share_target.params.files[0].accept).toContain('application/pdf');
});

async function serviceWorkerReady(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    // The first load is not controlled until the worker claims it.
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    }
  });
}

test('a PDF shared to the app opens as a label', async ({ page }) => {
  await serviceWorkerReady(page);
  const pdf = (await vintedStylePdf('InPost')).toString('base64');

  const landed = await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const form = new FormData();
    form.append('labels', new File([bytes], 'inpost-label.pdf', { type: 'application/pdf' }));
    const response = await fetch('./share-target', { method: 'POST', body: form });
    return response.url;
  }, pdf);
  expect(new URL(landed).search).toBe('?shared');

  await page.goto(landed);
  await expect(page.locator('.job')).toHaveCount(1);
  await expect(page.locator('.job .carrier')).toHaveText('InPost');
  await expect(page.locator('.job-name')).toHaveText('inpost-label.pdf · page 1');
  // The query is dropped, and the file handed over only once.
  expect(new URL(page.url()).search).toBe('');
  await page.reload();
  await expect(page.locator('#summary')).toHaveText('No labels yet.');
});

test('the app opens offline once it has been opened online', async ({ page, context }) => {
  await serviceWorkerReady(page);
  await page.reload(); // load every asset through the worker, so it is cached
  await expect(page.locator('h1')).toHaveText('Label Printer');

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('h1')).toHaveText('Label Printer');
  await page.locator('#files').setInputFiles({
    name: 'offline.pdf',
    mimeType: 'application/pdf',
    buffer: await vintedStylePdf('Evri'),
  });
  await expect(page.locator('.job .carrier')).toHaveText('Evri');
  await context.setOffline(false);
});
