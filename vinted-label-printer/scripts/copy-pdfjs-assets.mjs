/**
 * pdf.js loads the 14 standard PDF fonts on demand for PDFs that use them without
 * embedding them. Copy them into public/ so they are served from this site rather
 * than a CDN: the app makes no third-party requests.
 */

import { cpSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, 'public/pdfjs/standard_fonts');
mkdirSync(target, { recursive: true });
cpSync(resolve(root, 'node_modules/pdfjs-dist/standard_fonts'), target, { recursive: true });
