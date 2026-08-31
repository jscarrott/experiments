import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkFit } from '../src/geometry/fit.js';
import { checkStacks, findStacks, restingHeight, supportOf } from '../src/geometry/stacking.js';
import { makeLookup, place, spec, testProfile } from './helpers.js';

const profile = testProfile();

const crate = spec('crate', 600, 400, 300, { stackMode: 'friction', stackGroup: 'alc' });
const latch = spec('latch', 554, 371, 300, { stackMode: 'latching', stackGroup: 'ts2' });
const lookup = makeLookup([crate, latch]);

test('a box resting on another is recognised as supported by it', () => {
  const lower = place('lower', 'crate', 0, 400, 0);
  const upper = place('upper', 'crate', 0, 400, 300);
  assert.equal(supportOf(upper, [lower, upper], lookup)?.id, 'lower');
  assert.equal(supportOf(lower, [lower, upper], lookup), undefined, 'the bottom box is on the floor');
});

test('latching boxes form a rigid stack, crates do not', () => {
  const latched = [place('a', 'latch', 0, 400, 0), place('b', 'latch', 0, 400, 300)];
  const [latchedStack] = findStacks(latched, lookup);
  assert.equal(latchedStack?.boxIds.length, 2);
  assert.equal(latchedStack?.rigid, true);

  const crates = [place('a', 'crate', 0, 400, 0), place('b', 'crate', 0, 400, 300)];
  const [crateStack] = findStacks(crates, lookup);
  assert.equal(crateStack?.boxIds.length, 2);
  assert.equal(crateStack?.rigid, false, 'crates only sit on each other');
});

test('an overhanging crate is flagged but a square-stacked one is not', () => {
  const square = [place('a', 'crate', 0, 400, 0), place('b', 'crate', 0, 400, 300)];
  assert.ok(!checkStacks(square, lookup).some((i) => i.kind === 'overhang'));

  // Shifted 300 mm across a 600 mm box: only half supported.
  const shifted = [place('a', 'crate', 0, 400, 0), place('b', 'crate', 300, 400, 300)];
  const issues = checkStacks(shifted, lookup);
  assert.ok(issues.some((i) => i.kind === 'overhang' && i.boxId === 'b'));
});

test('a tall stack of crates is a topple risk, the same height latched is not', () => {
  // Four crates: 1200 mm tall on a 400 mm base, ratio 3.0.
  const crates = [0, 300, 600, 900].map((z, i) => place(`c${i}`, 'crate', 0, 400, z));
  assert.ok(
    checkStacks(crates, lookup).some((i) => i.kind === 'topple-risk'),
    'unlatched crates stacked that high should be flagged',
  );

  const latched = [0, 300, 600, 900].map((z, i) => place(`l${i}`, 'latch', 0, 400, z));
  assert.ok(
    !checkStacks(latched, lookup).some((i) => i.kind === 'topple-risk'),
    'a latched stack travels as one unit',
  );
});

test('a latching box stacked on a crate lid is flagged', () => {
  const mixed = [place('a', 'crate', 0, 400, 0), place('b', 'latch', 0, 400, 300)];
  const issues = checkStacks(mixed, lookup);
  assert.ok(issues.some((i) => i.kind === 'unstable-mix' && i.boxId === 'b'));
});

test('a rigid stack too tall for the tailgate is flagged as a unit', () => {
  // Three latched boxes: 554 x 371 x 900. Each box alone goes in easily; as one
  // latched unit the smallest two dimensions are 554 and 371, so it still fits.
  const fits = [0, 300, 600].map((z, i) => place(`l${i}`, 'latch', 0, 400, z));
  assert.ok(!checkFit(fits, profile, lookup).some((i) => i.kind === 'wont-fit-aperture'));

  // A wide latching box: 1150 x 1150 footprint, two high, is 1150 x 1150 x 600.
  // No orientation clears 1220 x 1100.
  const wide = spec('wide-latch', 1150, 1150, 600, { stackMode: 'latching', stackGroup: 'ts2' });
  const wideLookup = makeLookup([wide]);
  const tooBig = [place('a', 'wide-latch', 0, 600, 0), place('b', 'wide-latch', 0, 600, 600)];
  const issues = checkFit(tooBig, profile, wideLookup);
  assert.ok(issues.some((i) => i.kind === 'wont-fit-aperture' && /stack/i.test(i.message)));
});

test('unlatched crates are checked individually, not as a stack', () => {
  // Two crates that individually fit but whose combined height would not.
  const tall = spec('tall-crate', 600, 400, 700, { stackMode: 'friction', stackGroup: 'alc' });
  const tallLookup = makeLookup([tall]);
  const stacked = [place('a', 'tall-crate', 0, 400, 0), place('b', 'tall-crate', 0, 400, 700)];
  const issues = checkFit(stacked, profile, tallLookup);
  assert.ok(
    !issues.some((i) => i.kind === 'wont-fit-aperture'),
    'you carry crates in one at a time, so the stack height is not an aperture problem',
  );
});

test('restingHeight puts a dragged box on top of what is already there', () => {
  const existing = place('a', 'crate', 0, 400, 0);
  const dragged = place('b', 'crate', 0, 400, 0);
  assert.equal(restingHeight(dragged, [existing], lookup), 300);

  const clear = place('c', 'crate', 0, 900, 0);
  assert.equal(restingHeight(clear, [existing], lookup), 0);
});
