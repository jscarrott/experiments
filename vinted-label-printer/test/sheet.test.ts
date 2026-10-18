import { test } from 'node:test';
import assert from 'node:assert/strict';

import { paginate, SHEET_LAYOUTS } from '../src/layout/sheet.js';

const fourUp = SHEET_LAYOUTS.find((l) => l.id === 'a4-4')!;

test('every layout tiles its paper exactly, with no overlap', () => {
  for (const layout of SHEET_LAYOUTS) {
    const area = layout.cells.reduce((sum, c) => sum + c.widthMm * c.heightMm, 0);
    assert.ok(Math.abs(area - layout.paper.widthMm * layout.paper.heightMm) < 1e-6, layout.id);
    for (const c of layout.cells) {
      assert.ok(c.xMm + c.widthMm <= layout.paper.widthMm + 1e-9, layout.id);
      assert.ok(c.yMm + c.heightMm <= layout.paper.heightMm + 1e-9, layout.id);
    }
    assert.equal(layout.positions.length, layout.cells.length, layout.id);
  }
});

test('labels fill sheets in order, four to a sheet', () => {
  assert.deepEqual(paginate(0, fourUp), []);
  assert.deepEqual(paginate(3, fourUp), [[0, 1, 2]]);
  assert.deepEqual(paginate(4, fourUp), [[0, 1, 2, 3]]);
  assert.deepEqual(paginate(6, fourUp), [[0, 1, 2, 3], [0, 1]]);
});

test('a part-used sheet is finished first, then fresh sheets start at the top', () => {
  assert.deepEqual(paginate(2, fourUp, 2), [[2, 3]]);
  assert.deepEqual(paginate(3, fourUp, 2), [[2, 3], [0]]);
  assert.deepEqual(paginate(5, fourUp, 3), [[3], [0, 1, 2, 3]]);
});

test('an out-of-range start position is clamped onto the sheet', () => {
  assert.deepEqual(paginate(1, fourUp, 9), [[3]]);
  assert.deepEqual(paginate(1, fourUp, -2), [[0]]);
});
