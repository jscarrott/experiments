/**
 * Find the shipping label on a page.
 *
 * Vinted's label PDFs are A4 with the label taking up part of the page and the rest
 * given to drop-off instructions, a packing slip, dashed fold lines and logos. The
 * job is to find the label and leave the rest.
 *
 * It works on ink, not on knowledge of each carrier's template, so a layout change at
 * Vinted's end degrades it rather than breaking it:
 *
 *  1. Rub out fold and cut lines. They run between the blocks on the page and would
 *     otherwise glue them all together.
 *  2. Smear the ink a few millimetres so that the letters, bars and boxes of one block
 *     run together, and split the page into the blobs that come out.
 *  3. Score each blob. A label is big, framed, and has barcodes or a QR code in it —
 *     dense patches of ink that body text never has. Instructions are big too, but
 *     sparse and unframed.
 *  4. Grow the winner over close neighbours, so an unframed label whose barcode sits a
 *     little apart from its address block comes back whole.
 *
 * All of it is pure functions over a byte-per-pixel ink map, so it is tested in Node
 * against synthetic pages.
 */

import type { Rect } from './rect.js';

export interface InkMap {
  width: number;
  height: number;
  /** 1 where the pixel is ink, 0 where it is paper. Row-major. */
  ink: Uint8Array;
  pxPerMm: number;
}

export interface Detection {
  /** True when there is nothing on the page worth printing. */
  blank: boolean;
  /** The label, in page fractions, padded slightly. The whole page if blank. */
  rect: Rect;
  /** How label-like the winning block is. Only meaningful relative to other blocks. */
  score: number;
}

/** Below this luminance (0–255) a pixel counts as ink. */
export const INK_THRESHOLD = 200;

export function inkMapFromRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  pxPerMm: number,
  threshold = INK_THRESHOLD,
): InkMap {
  const ink = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < ink.length; i++, p += 4) {
    // Transparent pixels are paper: an image with an alpha channel has no page colour.
    if (rgba[p + 3]! < 128) continue;
    const luma = (rgba[p]! * 299 + rgba[p + 1]! * 587 + rgba[p + 2]! * 114) / 1000;
    if (luma < threshold) ink[i] = 1;
  }
  return { width, height, ink, pxPerMm };
}

/** Tunables, all in millimetres so they mean the same thing at any render resolution. */
const SMEAR_MM = 3;
const RULE_MAX_THICKNESS_MM = 1.2;
const RULE_MIN_SPAN = 0.85;
const RULE_ISOLATION_MM = 2;
const RULE_MAX_NEIGHBOUR_INK = 0.5;
const DASH_MAX_PIECE_MM = 6;
const DASH_MIN_PIECES = 6;
const DASH_MIN_LENGTH_MM = 40;
const DASH_MIN_COVERAGE = 0.25;
const MIN_BLOCK_INK_MM2 = 6;
const DENSE_CELL_MM = 2;
const DENSE_CELL_FILL = 0.4;
const MERGE_GAP_MM = 6;
const MERGE_MAX_ASPECT = 1.8;
const MERGE_MAX_PAGE_SHARE = 0.6;
const PAD_MM = 2;

export function findLabel(map: InkMap): Detection {
  const { width, height, pxPerMm } = map;
  const ink = removeRules(map);
  const smeared = dilate(ink, width, height, Math.max(1, Math.round(SMEAR_MM * pxPerMm)));
  const blocks = blocksOf(smeared, ink, width, height).filter(
    (b) => b.inkCount >= MIN_BLOCK_INK_MM2 * pxPerMm * pxPerMm,
  );

  if (blocks.length === 0) return { blank: true, rect: { x: 0, y: 0, w: 1, h: 1 }, score: 0 };

  for (const block of blocks) block.score = scoreBlock(block, ink, width, pxPerMm);
  blocks.sort((a, b) => b.score - a.score);

  const best = blocks[0]!;
  let box: Box = { x0: best.x0, y0: best.y0, x1: best.x1, y1: best.y1 };
  const pageArea = width * height;
  const maxGap = MERGE_GAP_MM * pxPerMm;
  let grew = true;
  const merged = new Set([best]);
  while (grew) {
    grew = false;
    for (const block of blocks) {
      if (merged.has(block) || gap(box, block) > maxGap) continue;
      const union = unionBox(box, block);
      const w = union.x1 - union.x0 + 1;
      const h = union.y1 - union.y0 + 1;
      if (Math.max(w, h) / Math.min(w, h) > MERGE_MAX_ASPECT) continue;
      if (w * h > pageArea * MERGE_MAX_PAGE_SHARE) continue;
      box = union;
      merged.add(block);
      grew = true;
    }
  }

  const pad = PAD_MM * pxPerMm;
  const x0 = Math.max(0, box.x0 - pad);
  const y0 = Math.max(0, box.y0 - pad);
  const x1 = Math.min(width, box.x1 + 1 + pad);
  const y1 = Math.min(height, box.y1 + 1 + pad);
  return {
    blank: false,
    rect: { x: x0 / width, y: y0 / height, w: (x1 - x0) / width, h: (y1 - y0) / height },
    score: best.score,
  };
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Block extends Box {
  inkCount: number;
  score: number;
}

/**
 * Erase fold lines and cut-here lines: thin bands that are either a solid rule across
 * nearly the whole page, or a dashed line of any useful length. Solid lines shorter
 * than the page are kept, because that is what a label's own frame looks like, and
 * the frame is one of the best clues there is.
 *
 * Text is the hazard. A row through a line of text looks like a dashed line, and so
 * does a column through a paragraph: the same stroke, once per line. Two tests keep
 * text safe. A rule is thin — no thicker than {@link RULE_MAX_THICKNESS_MM} — where a
 * line of text is taller. And a rule has paper either side of it along its length,
 * where a stroke in a paragraph has the next letter a millimetre away.
 */
export function removeRules(map: InkMap): Uint8Array {
  const { width, height, pxPerMm } = map;
  const source = map.ink;
  const ink = source.slice();
  const maxThickness = Math.max(1, Math.round(RULE_MAX_THICKNESS_MM * pxPerMm));
  const isolation = Math.max(1, Math.round(RULE_ISOLATION_MM * pxPerMm));

  // Rows are lines along x; columns are lines along y. Both read the untouched source,
  // so rubbing out a vertical rule cannot break up a horizontal one and save it.
  const sweep = (lines: number, along: number, at: (line: number, i: number) => number, erase: (line: number, i: number) => void) => {
    const segments: Segment[][] = [];
    for (let line = 0; line < lines; line++) segments.push(ruleSegments(along, (i) => at(line, i), pxPerMm));

    const overlaps = (line: number, seg: Segment) =>
      segments[line]!.some(([a, b]) => Math.min(b, seg[1]) - Math.max(a, seg[0]) >= (seg[1] - seg[0]) / 2);
    const inkOver = (from: number, to: number, seg: Segment) => {
      let sum = 0;
      for (let line = Math.max(0, from); line < Math.min(lines, to); line++) {
        for (let i = seg[0]; i < seg[1]; i++) sum += at(line, i);
      }
      return sum;
    };

    const erasures: [number, number, Segment][] = [];
    for (let line = 0; line < lines; line++) {
      for (const seg of segments[line]!) {
        // Only start from the first line of a band, so each band is judged once.
        if (line > 0 && overlaps(line - 1, seg)) continue;
        let end = line + 1;
        while (end < lines && overlaps(end, seg)) end++;
        if (end - line > maxThickness) continue;
        const inside = inkOver(line, end, seg);
        const around = inkOver(line - isolation, line, seg) + inkOver(end, end + isolation, seg);
        if (around <= inside * RULE_MAX_NEIGHBOUR_INK) erasures.push([line, end, seg]);
      }
    }
    for (const [from, to, [a, b]] of erasures) {
      for (let line = from; line < to; line++) for (let i = a; i < b; i++) erase(line, i);
    }
  };

  sweep(height, width, (y, x) => source[y * width + x]!, (y, x) => (ink[y * width + x] = 0));
  sweep(width, height, (x, y) => source[y * width + x]!, (x, y) => (ink[y * width + x] = 0));
  return ink;
}

/** [start, end) along a line. */
type Segment = [number, number];

/** The stretches of one row or column of pixels that look like part of a rule. */
function ruleSegments(length: number, at: (i: number) => number, pxPerMm: number): Segment[] {
  const runs: Segment[] = [];
  for (let i = 0; i < length; i++) {
    if (!at(i)) continue;
    const start = i;
    while (i < length && at(i)) i++;
    runs.push([start, i]);
  }
  if (runs.length === 0) return [];

  const inkIn = (a: number, b: number) => {
    let sum = 0;
    for (let k = a; k < b; k++) sum += runs[k]![1] - runs[k]![0];
    return sum;
  };
  const span = (a: number, b: number) => runs[b - 1]![1] - runs[a]![0];

  // Solid: one unbroken run across nearly the whole page.
  const out: Segment[] = runs.filter(([a, b]) => b - a >= length * RULE_MIN_SPAN);

  // Dashed: a stretch of many short pieces with short gaps between them.
  const maxPiece = DASH_MAX_PIECE_MM * pxPerMm;
  const keepIfDashed = (a: number, b: number) => {
    if (
      b - a >= DASH_MIN_PIECES &&
      span(a, b) >= DASH_MIN_LENGTH_MM * pxPerMm &&
      inkIn(a, b) >= span(a, b) * DASH_MIN_COVERAGE
    ) {
      out.push([runs[a]![0], runs[b - 1]![1]]);
    }
  };
  let from = 0;
  for (let k = 0; k < runs.length; k++) {
    const long = runs[k]![1] - runs[k]![0] > maxPiece;
    const farFromLast = k > from && runs[k]![0] - runs[k - 1]![1] > maxPiece;
    if (!long && !farFromLast) continue;
    keepIfDashed(from, k);
    from = long ? k + 1 : k;
  }
  keepIfDashed(from, runs.length);
  return out;
}

/** Square dilation by `radius`, as two separable passes with a running count. */
export function dilate(ink: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const across = new Uint8Array(ink.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let count = 0;
    for (let x = 0; x < Math.min(radius, width); x++) count += ink[row + x]!;
    for (let x = 0; x < width; x++) {
      if (x + radius < width) count += ink[row + x + radius]!;
      if (x - radius - 1 >= 0) count -= ink[row + x - radius - 1]!;
      if (count > 0) across[row + x] = 1;
    }
  }
  const out = new Uint8Array(ink.length);
  for (let x = 0; x < width; x++) {
    let count = 0;
    for (let y = 0; y < Math.min(radius, height); y++) count += across[y * width + x]!;
    for (let y = 0; y < height; y++) {
      if (y + radius < height) count += across[(y + radius) * width + x]!;
      if (y - radius - 1 >= 0) count -= across[(y - radius - 1) * width + x]!;
      if (count > 0) out[y * width + x] = 1;
    }
  }
  return out;
}

/**
 * Connected regions of the smeared map. Each region's box is taken from the real ink
 * inside it rather than the smear, so the smear radius does not pad the result.
 */
function blocksOf(smeared: Uint8Array, ink: Uint8Array, width: number, height: number): Block[] {
  const label = new Int32Array(smeared.length).fill(-1);
  const stack = new Int32Array(smeared.length);
  const blocks: Block[] = [];

  for (let start = 0; start < smeared.length; start++) {
    if (!smeared[start] || label[start]! >= 0) continue;
    const id = blocks.length;
    const block: Block = { x0: width, y0: height, x1: -1, y1: -1, inkCount: 0, score: 0 };
    let top = 0;
    stack[top++] = start;
    label[start] = id;
    while (top > 0) {
      const i = stack[--top]!;
      const x = i % width;
      const y = (i - x) / width;
      if (ink[i]) {
        block.inkCount++;
        if (x < block.x0) block.x0 = x;
        if (x > block.x1) block.x1 = x;
        if (y < block.y0) block.y0 = y;
        if (y > block.y1) block.y1 = y;
      }
      if (x > 0 && smeared[i - 1] && label[i - 1]! < 0) (label[i - 1] = id), (stack[top++] = i - 1);
      if (x < width - 1 && smeared[i + 1] && label[i + 1]! < 0) (label[i + 1] = id), (stack[top++] = i + 1);
      if (y > 0 && smeared[i - width] && label[i - width]! < 0) (label[i - width] = id), (stack[top++] = i - width);
      if (y < height - 1 && smeared[i + width] && label[i + width]! < 0)
        (label[i + width] = id), (stack[top++] = i + width);
    }
    // The smear can reach paper-only regions only from ink, so every block has ink.
    blocks.push(block);
  }
  return blocks;
}

/**
 * How much a block looks like a shipping label: area, multiplied up for a frame round
 * it and for patches of solid ink (barcodes, QR codes, the black service-code boxes
 * carriers print). The weights are judgement, not fitted; the manual crop editor is
 * the backstop when they are wrong.
 */
function scoreBlock(block: Block, ink: Uint8Array, width: number, pxPerMm: number): number {
  const w = block.x1 - block.x0 + 1;
  const h = block.y1 - block.y0 + 1;
  const areaMm2 = (w * h) / (pxPerMm * pxPerMm);
  const frame = framedEdges(block, ink, width, pxPerMm);
  const dense = denseShare(block, ink, width, pxPerMm);
  return areaMm2 * (1 + 0.5 * frame) * (1 + 10 * dense);
}

/** How many of the block's four sides carry a straight line along most of their length. */
export function framedEdges(box: Box, ink: Uint8Array, width: number, pxPerMm: number): number {
  const band = Math.max(1, Math.round(1.5 * pxPerMm));
  const w = box.x1 - box.x0 + 1;
  const h = box.y1 - box.y0 + 1;
  const longestRow = (y: number) => longestRun(box.x0, box.x1, (x) => ink[y * width + x]!);
  const longestCol = (x: number) => longestRun(box.y0, box.y1, (y) => ink[y * width + x]!);

  const lineNear = (from: number, step: number, count: number, longest: (i: number) => number, need: number) => {
    for (let k = 0; k < count; k++) if (longest(from + k * step) >= need) return true;
    return false;
  };
  let edges = 0;
  if (lineNear(box.y0, 1, Math.min(band, h), longestRow, w * 0.8)) edges++;
  if (lineNear(box.y1, -1, Math.min(band, h), longestRow, w * 0.8)) edges++;
  if (lineNear(box.x0, 1, Math.min(band, w), longestCol, h * 0.8)) edges++;
  if (lineNear(box.x1, -1, Math.min(band, w), longestCol, h * 0.8)) edges++;
  return edges;
}

function longestRun(from: number, to: number, at: (i: number) => number): number {
  let best = 0;
  let run = 0;
  for (let i = from; i <= to; i++) {
    run = at(i) ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

/** Share of the block's 2 mm cells that are mostly ink. Body text almost never is. */
export function denseShare(box: Box, ink: Uint8Array, width: number, pxPerMm: number): number {
  const cell = Math.max(2, Math.round(DENSE_CELL_MM * pxPerMm));
  let cells = 0;
  let dense = 0;
  for (let cy = box.y0; cy + cell - 1 <= box.y1; cy += cell) {
    for (let cx = box.x0; cx + cell - 1 <= box.x1; cx += cell) {
      let count = 0;
      for (let y = cy; y < cy + cell; y++) {
        for (let x = cx, i = y * width + cx; x < cx + cell; x++, i++) count += ink[i]!;
      }
      cells++;
      if (count >= cell * cell * DENSE_CELL_FILL) dense++;
    }
  }
  return cells === 0 ? 0 : dense / cells;
}

function gap(a: Box, b: Box): number {
  const dx = Math.max(0, b.x0 - a.x1, a.x0 - b.x1);
  const dy = Math.max(0, b.y0 - a.y1, a.y0 - b.y1);
  return Math.max(dx, dy);
}

function unionBox(a: Box, b: Box): Box {
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}
