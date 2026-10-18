import { test } from 'node:test';
import assert from 'node:assert/strict';

import { findLabel, inkMapFromRgba, removeRules } from '../src/detect/crop.js';
import { drawLabel, Page } from './page.js';

/** Assert a detected rect hugs the expected one: inside the padding, and not short of it. */
function assertAround(
  actual: { x: number; y: number; w: number; h: number },
  expected: { x: number; y: number; w: number; h: number },
  slackMm = 3,
) {
  const near = (a: number, b: number, what: string) =>
    assert.ok(Math.abs(a - b) <= slackMm, `${what}: got ${a.toFixed(1)} mm, expected ${b.toFixed(1)} mm`);
  near(actual.x, expected.x, 'left');
  near(actual.y, expected.y, 'top');
  near(actual.x + actual.w, expected.x + expected.w, 'right');
  near(actual.y + actual.h, expected.y + expected.h, 'bottom');
}

test('an empty page is blank', () => {
  const page = new Page();
  assert.equal(findLabel(page.map).blank, true);
});

test('a page with only a fold line is blank', () => {
  const page = new Page().fill(0, 148, 210, 0.3).dashed(0, 200, 210);
  assert.equal(findLabel(page.map).blank, true);
});

test('a lone label is found and padded by about 2 mm', () => {
  const page = drawLabel(new Page(), 10, 10);
  const found = page.mm(findLabel(page.map).rect);
  assertAround(found, { x: 8, y: 8, w: 104, h: 154 }, 1);
});

test('the label wins over a bigger block of instructions beside and below it', () => {
  const page = drawLabel(new Page(), 10, 10);
  page.text(120, 10, 80, 150); // instructions column, as tall as the label
  page.text(10, 180, 190, 100); // and a bigger block underneath
  assertAround(page.mm(findLabel(page.map).rect), { x: 8, y: 8, w: 104, h: 154 });
});

test('a dashed cut line between label and instructions does not glue them together', () => {
  const page = drawLabel(new Page(), 10, 10);
  page.text(120, 10, 80, 150);
  page.dashed(115, 0, 170, true); // between the two, 5 mm from the label
  page.dashed(0, 170, 210); // and under both, edge to edge
  page.text(10, 180, 190, 100);
  assertAround(page.mm(findLabel(page.map).rect), { x: 8, y: 8, w: 104, h: 154 });
});

test('a solid fold line across the page is ignored', () => {
  const page = drawLabel(new Page(), 55, 10);
  page.fill(0, 165, 210, 0.4); // 5 mm under the label, 5 mm over the text
  page.text(10, 170, 190, 110);
  assertAround(page.mm(findLabel(page.map).rect), { x: 53, y: 8, w: 104, h: 154 });
});

test('a landscape label in the top half of the page is found', () => {
  const page = drawLabel(new Page(), 10, 10, 150, 100);
  page.text(10, 160, 190, 120);
  assertAround(page.mm(findLabel(page.map).rect), { x: 8, y: 8, w: 154, h: 104 });
});

test('an unframed label whose parts are a few millimetres apart comes back whole', () => {
  const page = new Page();
  page.fill(15, 15, 20, 12).text(40, 15, 60, 12);
  page.barcode(15, 32, 85, 25); // 5 mm below the header
  page.text(15, 62, 85, 40);
  page.fill(15, 104, 30, 30); // 4.5 mm below the last line of text
  page.text(15, 200, 180, 80); // instructions well away
  assertAround(page.mm(findLabel(page.map).rect), { x: 13, y: 13, w: 89, h: 123 });
});

test('a label on its own is not merged into instructions far away', () => {
  const page = drawLabel(new Page(), 10, 10);
  page.text(10, 200, 190, 80);
  const found = page.mm(findLabel(page.map).rect);
  assert.ok(found.y + found.h < 170, `bottom at ${(found.y + found.h).toFixed(1)} mm`);
});

test('the result does not depend on render resolution', () => {
  for (const pxPerMm of [2, 4, 6]) {
    const page = drawLabel(new Page(210, 297, pxPerMm), 10, 10);
    page.text(120, 10, 80, 150).text(10, 180, 190, 100);
    assertAround(page.mm(findLabel(page.map).rect), { x: 8, y: 8, w: 104, h: 154 });
  }
});

test('text is not mistaken for a rule even when a line spans the page', () => {
  const page = new Page().text(0, 100, 210, 3);
  const before = page.map.ink.reduce((a, b) => a + b, 0);
  const after = removeRules(page.map).reduce((a, b) => a + b, 0);
  assert.equal(after, before);
});

test('a label frame survives rule removal', () => {
  const page = new Page().frame(10, 10, 100, 150);
  const before = page.map.ink.reduce((a, b) => a + b, 0);
  const after = removeRules(page.map).reduce((a, b) => a + b, 0);
  assert.equal(after, before);
});

test('ink maps treat dark pixels as ink and transparent ones as paper', () => {
  const rgba = new Uint8ClampedArray([
    0, 0, 0, 255, // black
    255, 255, 255, 255, // white
    120, 120, 120, 255, // grey, darker than the threshold
    0, 0, 0, 0, // transparent black
  ]);
  const map = inkMapFromRgba(rgba, 4, 1, 1);
  assert.deepEqual([...map.ink], [1, 0, 1, 0]);
});

test('a paragraph is not mistaken for a column of dashed lines', () => {
  // Down one column of a paragraph, the same stroke every line is a dashed line.
  const page = new Page().text(10, 10, 100, 100);
  const before = page.map.ink.reduce((a, b) => a + b, 0);
  const after = removeRules(page.map).reduce((a, b) => a + b, 0);
  assert.equal(after, before);
});

test('a dashed cut line on its own is erased', () => {
  const page = new Page().dashed(20, 100, 120).dashed(150, 20, 120, true);
  assert.equal(removeRules(page.map).reduce((a, b) => a + b, 0), 0);
});
