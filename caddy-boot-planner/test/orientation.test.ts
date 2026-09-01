import { test } from 'node:test';
import assert from 'node:assert/strict';

import { aabbOf, effectiveDims } from '../src/geometry/boxes.js';
import { checkStacks } from '../src/geometry/stacking.js';
import { checkFit } from '../src/geometry/fit.js';
import { CADDY_MAXI_LIFE_2K } from '../src/model/vehicle.js';
import { specById } from '../src/model/catalogue.js';
import { makeLookup, place, spec, testProfile } from './helpers.js';

/**
 * Standing things on edge.
 *
 * A folded camp table laid flat wastes most of a small boot floor on a 70 mm-thick
 * object. Stood against the side it costs its thickness and nothing else — but it is
 * then a 625 mm slab on a 70 mm base, which falls over unless something holds it.
 * Both halves are tested here: that the orientation works, and that the warning is
 * quiet when the table is packed the sensible way.
 */

// The folded camp table: wide, deep, thin.
const table = spec('table', 625, 625, 70);
const lookup = makeLookup([table]);

test('upAxis picks which of the box dimensions points up', () => {
  const flat = place('t', 'table', 0, 700);
  assert.deepEqual(effectiveDims(table, flat), { width: 625, depth: 625, height: 70 });

  // On its side: the 70 mm width becomes the thickness across the van.
  const onSide = place('t', 'table', 0, 700, 0, { upAxis: 'width' });
  assert.deepEqual(effectiveDims(table, onSide), { width: 70, depth: 625, height: 625 });

  // On its face: the 70 mm is now the thickness along the van.
  const onFace = place('t', 'table', 0, 700, 0, { upAxis: 'depth' });
  assert.deepEqual(effectiveDims(table, onFace), { width: 625, depth: 70, height: 625 });
});

test('an absent upAxis behaves exactly as before', () => {
  const legacy = place('t', 'table', 0, 700);
  delete (legacy as { upAxis?: unknown }).upAxis;
  assert.deepEqual(effectiveDims(table, legacy), { width: 625, depth: 625, height: 70 });
});

test('yaw composes with a tip rather than replacing it', () => {
  const box = spec('oblong', 300, 500, 700);
  const oblongLookup = makeLookup([box]);

  // Tipped onto its side (700 becomes the across dimension), then yawed 90°,
  // which swaps the two horizontal dimensions but leaves the height alone.
  const tipped = place('b', 'oblong', 0, 700, 0, { upAxis: 'width' });
  assert.deepEqual(effectiveDims(box, tipped), { width: 700, depth: 500, height: 300 });

  const tippedAndTurned = place('b', 'oblong', 0, 700, 0, { upAxis: 'width', rotation: 90 });
  assert.deepEqual(effectiveDims(box, tippedAndTurned), { width: 500, depth: 700, height: 300 });

  void oblongLookup;
});

test('the bounding box follows the orientation, so every check sees it', () => {
  const onSide = place('t', 'table', 0, 700, 0, { upAxis: 'width' });
  const aabb = aabbOf(table, onSide);
  assert.equal(aabb.maxX - aabb.minX, 70, 'only 70 mm across the van');
  assert.equal(aabb.maxZ - aabb.minZ, 625, 'and 625 mm tall');
});

// --- Stability -------------------------------------------------------------

const profile = testProfile(); // 1552 wide, 1200 long

test('a table stood up in open floor is flagged as a topple risk', () => {
  const onSide = place('t', 'table', 0, 600, 0, { upAxis: 'width' });
  const issues = checkStacks([onSide], lookup, profile);

  const topple = issues.find((i) => i.kind === 'topple-risk');
  assert.ok(topple, '625 mm tall on a 70 mm base with nothing near it should be flagged');
  assert.match(topple.message, /nothing holding it up/);
});

test('THE ONE THAT MATTERS: the same table against the side is not flagged', () => {
  // Packed the way you actually would: hard against the trim. If the tool nagged
  // about the correct answer you would stop reading its warnings.
  const againstWall = place('t', 'table', 1552 / 2 - 35, 600, 0, { upAxis: 'width' });
  const issues = checkStacks([againstWall], lookup, profile);
  assert.ok(!issues.some((i) => i.kind === 'topple-risk'), 'leaning on the side wall is fine');
});

test('against the second-row seat backs is also fine', () => {
  const againstSeats = place('t', 'table', 0, 40, 0, { upAxis: 'depth' });
  const issues = checkStacks([againstSeats], lookup, profile);
  assert.ok(!issues.some((i) => i.kind === 'topple-risk'));
});

test('wedged beside something of similar height is fine', () => {
  const tall = spec('tall', 400, 400, 500);
  const bothLookup = makeLookup([table, tall]);

  const upright = place('t', 'table', 0, 600, 0, { upAxis: 'width' });
  // Butted right up against it: the table spans x -35..35, so this starts at 35.
  const neighbour = place('n', 'tall', 235, 600, 0);

  const issues = checkStacks([upright, neighbour], bothLookup, profile);
  assert.ok(!issues.some((i) => i.kind === 'topple-risk' && i.boxId === 't'));
});

test('a strap over it counts as holding it up', () => {
  const upright = place('t', 'table', 0, 600, 0, { upAxis: 'width' });
  const held = new Set(['t']);
  const issues = checkStacks([upright], lookup, profile, held);
  assert.ok(!issues.some((i) => i.kind === 'topple-risk'));
});

test('a box lying flat is never a topple risk however wide it is', () => {
  const flat = place('t', 'table', 0, 600);
  assert.ok(!checkStacks([flat], lookup, profile).some((i) => i.kind === 'topple-risk'));
});

test('a normal crate standing alone is not flagged', () => {
  const crate = spec('crate', 600, 400, 300);
  const crateLookup = makeLookup([crate]);
  const box = place('c', 'crate', 0, 600);
  assert.ok(!checkStacks([box], crateLookup, profile).some((i) => i.kind === 'topple-risk'));
});

test('standing something tall against the trim has to allow for the wall leaning in', () => {
  // Real Caddy profile, not the van-like test one: 1120 mm at the floor tapering to
  // 1110 mm at the roof. Laid flat the table is only 70 mm tall and can go hard
  // against the trim. Stood on edge it is 625 mm tall, and by that height the wall
  // has come in — so it has to sit a few mm inboard. Exactly the interference you
  // would never spot by eye, and the reason width is measured over the span a box
  // actually occupies rather than at the floor.
  const real = CADDY_MAXI_LIFE_2K;
  const realTable = specById('camp-table-folded');
  const halfWidth = real.floorWidth.value / 2;

  const flatAgainstTrim = place('t', 'camp-table-folded', halfWidth - 313, 700);
  assert.ok(
    !checkFit([flatAgainstTrim], real, specById).some((i) => i.kind === 'too-wide'),
    'laid flat it can go right up to the trim',
  );

  const uprightAgainstTrim = place('t', 'camp-table-folded', halfWidth - 35, 700, 0, {
    upAxis: 'width',
  });
  assert.ok(
    checkFit([uprightAgainstTrim], real, specById).some((i) => i.kind === 'too-wide'),
    'stood on edge at the same distance out, the top corner fouls the trim',
  );

  const uprightPulledIn = place('t', 'camp-table-folded', halfWidth - 40, 700, 0, {
    upAxis: 'width',
  });
  assert.ok(
    !checkFit([uprightPulledIn], real, specById).some((i) => i.kind === 'too-wide'),
    '5 mm inboard and it clears',
  );

  void realTable;
});
