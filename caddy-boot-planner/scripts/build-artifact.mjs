/**
 * Reshape the single-file Vite build into the form the Artifact host wants.
 *
 * The host wraps whatever it is given in its own `<!doctype html><head>…</head><body>`
 * skeleton, so a complete document would end up nested inside another one. This
 * strips the skeleton and emits page content: the title, the stylesheet, the app
 * root, and the bundled script — in that order.
 *
 * Run after `vite build --mode artifact`.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '../dist-artifact/index.html');
const target = resolve(here, '../dist-artifact/artifact.html');

const html = readFileSync(source, 'utf8');

const pick = (pattern, label) => {
  const match = html.match(pattern);
  if (!match) throw new Error(`Could not find ${label} in the build output.`);
  return match;
};

const title = pick(/<title>([\s\S]*?)<\/title>/, '<title>')[1].trim();
const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

if (styles.length === 0) throw new Error('No inlined <style> found — did viteSingleFile run?');
if (scripts.length === 0) throw new Error('No inlined <script> found — did viteSingleFile run?');

// Anything left referencing the network would fail silently behind the host CSP.
const external = html.match(/(?:src|href)="https?:\/\/[^"]*"/g) ?? [];
const remoteOnly = external.filter((ref) => !ref.includes('data:'));
if (remoteOnly.length > 0) {
  throw new Error(`Build still references external resources:\n  ${remoteOnly.join('\n  ')}`);
}

const out = `<title>${title}</title>
<style>
${styles.join('\n')}
</style>
<div id="app"></div>
<script type="module">
${scripts.join('\n')}
</script>
`;

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, out, 'utf8');

const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
console.log(`Wrote ${target} (${kb} kB, title: "${title}")`);
