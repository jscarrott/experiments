/**
 * Draw the app icons as PNGs. Android only installs a web app whose manifest has
 * 192 and 512 px PNG icons. They are drawn here rather than kept as hand-made files
 * so they can be regenerated at any size, and the output is committed under public/.
 *
 * The design: a white shipping label with a barcode on a teal square. The maskable
 * icon keeps everything inside the middle 80%, the circle Android may crop it to.
 *
 * The same drawing makes the Android app's launcher icons and splash screen, written
 * straight into android/app/src/main/res.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'public/icons');
mkdirSync(out, { recursive: true });

const TEAL = [11, 110, 105, 255];
const WHITE = [255, 255, 255, 255];
const INK = [29, 29, 27, 255];

/**
 * background: 'rounded' (a plain icon), 'square' (maskable: the launcher crops it),
 * 'circle' (Android's legacy round icon) or 'none' (an adaptive icon's foreground).
 * scale shrinks the label about the centre, for the adaptive foreground's safe zone.
 */
function icon(size, { background, scale = 1 }) {
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
  if (background === 'rounded') rect(0, 0, size, size, TEAL, 22 * (size / 100));
  if (background === 'square') rect(0, 0, size, size, TEAL);
  if (background === 'circle') rect(0, 0, size, size, TEAL, size / 2);
  const u = (size / 100) * scale;
  // A 2:3 label, 44 × 62 units, centred: inside the maskable safe zone at full scale.
  const lx = size / 2 - 22 * u;
  const ly = size / 2 - 31 * u;
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

writeFileSync(resolve(out, 'icon-192.png'), icon(192, { background: 'rounded' }));
writeFileSync(resolve(out, 'icon-512.png'), icon(512, { background: 'rounded' }));
writeFileSync(resolve(out, 'maskable-512.png'), icon(512, { background: 'square' }));
writeFileSync(resolve(out, 'apple-touch-icon.png'), icon(180, { background: 'square' }));
console.log(`Wrote icons to ${out}`);

// Android: launcher icons per density (48 dp), adaptive foregrounds (108 dp, with the
// label inside the 66 dp circle every launcher mask keeps), and the splash mark.
const res = resolve(root, 'android/app/src/main/res');
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [density, k] of Object.entries(densities)) {
  const dir = resolve(res, `mipmap-${density}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'ic_launcher.png'), icon(48 * k, { background: 'rounded' }));
  writeFileSync(resolve(dir, 'ic_launcher_round.png'), icon(48 * k, { background: 'circle' }));
  writeFileSync(resolve(dir, 'ic_launcher_foreground.png'), icon(108 * k, { background: 'none', scale: 0.75 }));
}
mkdirSync(resolve(res, 'drawable-nodpi'), { recursive: true });
writeFileSync(resolve(res, 'drawable-nodpi/splash_mark.png'), icon(480, { background: 'none' }));
console.log(`Wrote Android icons to ${res}`);
