/**
 * Verify the artifact bundle the way the host will serve it: wrapped in the host's
 * own document skeleton, from a data URL with no server behind it. Fails if the page
 * errors, if nothing paints, or if it reaches for the network — the last one matters
 * because the host CSP blocks most outbound requests silently, so a stray fetch would
 * show up as a mysteriously broken page rather than an error.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const content = readFileSync(resolve(here, '../dist-artifact/artifact.html'), 'utf8');

// The host's skeleton, as documented: charset, viewport, and a small reset.
const page = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>:root{color-scheme:light dark}body{margin:0;font:14px system-ui;background:#faf9f7}
img{max-width:100%}[hidden]{display:none!important}</style>
</head><body>${content}</body></html>`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

const tab = await browser.newPage({ viewport: { width: 1400, height: 880 } });

const problems = [];
const requests = [];
tab.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
tab.on('console', (message) => {
  if (message.type() === 'error') problems.push(`console error: ${message.text()}`);
});
tab.on('request', (request) => {
  const url = request.url();
  if (!url.startsWith('data:') && !url.startsWith('blob:')) requests.push(url);
});

await tab.setContent(page, { waitUntil: 'load' });
await tab.waitForSelector('canvas', { timeout: 15_000 });
await tab.waitForTimeout(1200);

const canvasOk = await tab.evaluate(() => {
  const canvas = document.querySelector('canvas');
  if (!canvas) return false;
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  return !!gl && canvas.width > 100 && canvas.height > 100;
});

const shot = await tab.locator('canvas').screenshot();
const screenshotPath = process.argv[2];
if (screenshotPath) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(screenshotPath, shot);
}

await browser.close();

if (!canvasOk) problems.push('canvas did not initialise a WebGL context at a usable size');
if (shot.byteLength < 5000) problems.push(`canvas painted nothing (${shot.byteLength} bytes)`);
if (requests.length > 0) problems.push(`made network requests:\n  ${requests.join('\n  ')}`);

if (problems.length > 0) {
  console.error('Artifact verification FAILED:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`Artifact OK — renders standalone, ${shot.byteLength} bytes painted, 0 network requests.`);
