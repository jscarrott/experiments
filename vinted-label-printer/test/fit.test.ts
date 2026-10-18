import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fitCrop, isLabelSized, LABEL_SIZES } from '../src/layout/fit.js';

const fourBySix = LABEL_SIZES.find((s) => s.id === '4x6')!;
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test('a portrait crop fills portrait stock upright, centred', () => {
  const p = fitCrop(100, 150, fourBySix, 0, true);
  assert.equal(p.rotate, false);
  close(p.scale, 1.016);
  close(p.widthMm, 101.6);
  close(p.heightMm, 152.4);
  close(p.xMm, 0);
  close(p.yMm, 0);
});

test('a landscape crop is turned to fill portrait stock', () => {
  const p = fitCrop(150, 100, fourBySix, 0, true);
  assert.equal(p.rotate, true);
  close(p.widthMm, 101.6);
  close(p.heightMm, 152.4);
});

test('with rotation off, a landscape crop is letterboxed instead', () => {
  const p = fitCrop(150, 100, fourBySix, 0, false);
  assert.equal(p.rotate, false);
  close(p.widthMm, 101.6);
  assert.ok(p.heightMm < 70);
  close(p.yMm, (152.4 - p.heightMm) / 2);
});

test('margins are kept on the tight side and the content stays centred', () => {
  const p = fitCrop(100, 150, fourBySix, 3, true);
  assert.ok(p.xMm >= 3 - 1e-9 && p.yMm >= 3 - 1e-9);
  close(p.xMm * 2 + p.widthMm, 101.6);
  close(p.yMm * 2 + p.heightMm, 152.4);
});

test('a small crop is scaled up, not left small', () => {
  const p = fitCrop(40, 40, fourBySix, 0, true);
  close(p.widthMm, 101.6);
  assert.ok(p.scale > 2.5);
});

test('a near-square crop is not turned for a marginal gain', () => {
  const p = fitCrop(100, 99, fourBySix, 0, true);
  assert.equal(p.rotate, false);
});

test('4×6 and A6 pages count as label-sized; A4 and A5 do not', () => {
  assert.equal(isLabelSized(101.6, 152.4), true);
  assert.equal(isLabelSized(152.4, 101.6), true);
  assert.equal(isLabelSized(105, 148), true);
  assert.equal(isLabelSized(210, 297), false);
  assert.equal(isLabelSized(148, 210), false);
});
