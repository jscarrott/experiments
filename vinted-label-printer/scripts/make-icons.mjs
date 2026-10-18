/**
 * Draw the app icons as PNGs. Android only installs a web app whose manifest has
 * 192 and 512 px PNG icons. They are drawn here rather than kept as hand-made files
 * so they can be regenerated at any size, and the output is committed under public/.
 *
 * The design: a white shipping label with a barcode on a teal square. The maskable
 * icon keeps everything inside the middle 80%, the circle Android may crop it to.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../public/icons');
mkdirSync(out, { recursive: true });

const TEAL = [11, 110, 105, 255];
const WHITE = [255, 255, 255, 255];
const INK = [29, 29, 27, 255];

function icon(size, { maskable }) {
  const px = new Uint8Array(size * size * 4);
  const rect = (x, y, w, h, colour, radius = 0) => {
    for (let yy = Math.max(0, Math.floor(y)); yy < Math.min(size, Math.ceil(y + h)); yy++) {
      for (let xx = Math.max(0, Math.floor(x)); xx < Math.min(size, Math.ceil(x + w)); xx++) {
        if (radius) {
          const cx = Math.min(Math.max(xx + 0.5, x + radius), x + w - radius);
          const cy = Math.min(Math.max(yy + 0.5, y + radius), y + h - radius);
          if ((xx + 0.5 - cx) ** 2 + (yy + 0.5 - cy) ** 2 > radius ** 2) continue;
        }
        px.set(colour, (yy * size + xx) * 4);
      }
    }
  };
  const u = size / 100;
  // Maskable icons are cropped by the launcher, so they fill the square; the plain
  // icon gets its own rounded corners.
  rect(0, 0, size, size, TEAL, maskable ? 0 : 22 * u);
  // Inside the safe zone either way: a 2:3 label, 44 × 62 units, centred.
  const lx = 28 * u;
  const ly = 19 * u;
  rect(lx, ly, 44 * u, 62 * u, WHITE, 3 * u);
  rect(lx + 6 * u, ly + 7 * u, 12 * u, 8 * u, INK);
  rect(lx + 21 * u, ly + 8 * u, 17 * u, 2.5 * u, INK);
  rect(lx + 21 * u, ly + 12.5 * u, 11 * u, 2 * u, INK);
  const bars = [2, 1, 1, 3, 1, 2, 1, 1, 2, 3, 1, 1, 2, 1, 3, 1, 1, 2];
  let x = lx + 6 * u;
  bars.forEach((w, i) => {
    if (i % 2 === 0) rect(x, ly + 22 * u, w * u, 16 * u, INK);
    x += w * u;
  });
  rect(lx + 6 * u, ly + 44 * u, 20 * u, 2.5 * u, INK);
  rect(lx + 6 * u, ly + 49 * u, 28 * u, 2.5 * u, INK);
  rect(lx + 6 * u, ly + 54 * u, 16 * u, 2.5 * u, INK);
  return png(size, size, px);
}

function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

writeFileSync(resolve(out, 'icon-192.png'), icon(192, { maskable: false }));
writeFileSync(resolve(out, 'icon-512.png'), icon(512, { maskable: false }));
writeFileSync(resolve(out, 'maskable-512.png'), icon(512, { maskable: true }));
writeFileSync(resolve(out, 'apple-touch-icon.png'), icon(180, { maskable: true }));
console.log(`Wrote icons to ${out}`);
