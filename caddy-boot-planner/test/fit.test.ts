import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkFit } from '../src/geometry/fit.js';
import { halfWidthAt, minHalfWidthOver } from '../src/geometry/shell.js';
import { makeLookup, place, spec, testProfile } from './helpers.js';

const profile = testProfile();

test('the bay narrows to the between-arches width below arch height', () => {
  const insideArch = profile.archStartY.value + 100;

  // Below the arch, within its fore-aft extent: 1172 mm.
  assert.equal(halfWidthAt(profile, 100, insideArch), profile.widthBetweenArches.value / 2);

  // Above the arch at the same place, the wall is back — wider than between the arches.
  assert.ok(halfWidthAt(profile, 500, insideArch) > profile.widthBetweenArches.value / 2);

  // Ahead of the arch, even at floor level, the full floor width is available.
  assert.ok(halfWidthAt(profile, 100, 50) > profile.widthBetweenArches.value / 2);
});

test('the walls lean in, so the bay is narrower at roof height than at the floor', () => {
  const atFloor = halfWidthAt(profile, 0, 50);
  const atRoof = halfWidthAt(profile, profile.loadHeight.value, 50);
  assert.ok(atRoof < atFloor, 'roof should be narrower than floor');
  assert.equal(atFloor, profile.floorWidth.value / 2);
  assert.equal(atRoof, profile.widthAtRoof.value / 2);
});

test('a box wider than the arch gap fails only when it is down at arch level', () => {
  const lookup = makeLookup([spec('wide', 1300, 400, 200)]);
  const archY = profile.archStartY.value + 350;

  // On the floor between the arches — 1300 mm will not go.
  const low = checkFit([place('a', 'wide', 0, archY, 0)], profile, lookup);
  assert.ok(
    low.some((i) => i.kind === 'too-wide'),
    'a 1300 mm box on the floor between the arches should be flagged',
  );

  // Lifted above the arches, the same box clears — this is the case a naive
  // bounding-box check gets wrong in one direction or the other.
  const high = checkFit([place('a', 'wide', 0, archY, 400)], profile, lookup);
  assert.ok(
    !high.some((i) => i.kind === 'too-wide'),
    'the same box above arch height should be fine',
  );
});

test('minHalfWidthOver takes the narrowest point across the whole span', () => {
  // A box spanning from ahead of the arch to inside it must respect the arch.
  const narrowest = minHalfWidthOver(profile, 0, 200, 100, profile.archStartY.value + 300);
  assert.equal(narrowest, profile.widthBetweenArches.value / 2);
});

test('a long thin box goes in end-first and is not flagged', () => {
  // 1150 wide x 300 deep x 1150 tall. Presenting the 1150 x 300 face to a
  // 1220 x 1100 opening clears it, and the long dimension goes through the hole.
  const lookup = makeLookup([spec('long', 1150, 300, 1150)]);
  const issues = checkFit([place('a', 'long', 0, 600, 0)], profile, lookup);
  assert.ok(!issues.some((i) => i.kind === 'wont-fit-aperture'));
});

test('a box that fits the bay but not the tailgate opening is flagged', () => {
  // The two smallest dimensions are what has to clear the opening. At 1150 on
  // every side, no orientation presents a face inside 1220 x 1100.
  const lookup = makeLookup([spec('awkward', 1150, 1150, 1150)]);
  const issues = checkFit([place('a', 'awkward', 0, 600, 0)], profile, lookup);

  assert.ok(
    !issues.some((i) => i.kind === 'too-wide'),
    'should fit the bay itself',
  );
  assert.ok(
    issues.some((i) => i.kind === 'wont-fit-aperture'),
    'should not go through the tailgate opening',
  );
});

test('a box that fits the opening when turned is not flagged', () => {
  // 1150 x 1050: too tall one way up, fine the other.
  const lookup = makeLookup([spec('turnable', 1050, 300, 1150)]);
  const issues = checkFit([place('a', 'turnable', 0, 600, 0)], profile, lookup);
  assert.ok(!issues.some((i) => i.kind === 'wont-fit-aperture'));
});

test('overlapping boxes clash, touching boxes do not', () => {
  const lookup = makeLookup([spec('crate', 600, 400, 300)]);

  const clashing = checkFit(
    [place('a', 'crate', 0, 400), place('b', 'crate', 100, 400)],
    profile,
    lookup,
  );
  assert.ok(clashing.some((i) => i.kind === 'clash'));

  // Sitting exactly side by side, sharing a face.
  const touching = checkFit(
    [place('a', 'crate', -300, 400), place('b', 'crate', 300, 400)],
    profile,
    lookup,
  );
  assert.ok(!touching.some((i) => i.kind === 'clash'), 'boxes may touch');
});

test('a box past the load lip stops the tailgate shutting', () => {
  const lookup = makeLookup([spec('crate', 600, 400, 300)]);
  const issues = checkFit(
    [place('a', 'crate', 0, profile.floorLength.value - 100)],
    profile,
    lookup,
  );
  assert.ok(issues.some((i) => i.kind === 'past-tailgate'));
});

test('a box on a third-row bracket is flagged as rocking', () => {
  const withBrackets = testProfile();
  withBrackets.floorObstructions = [
    { id: 'b1', label: 'Third-row bracket (left)', x: -400, y: 700, width: 120, depth: 90, height: 25 },
  ];
  const lookup = makeLookup([spec('crate', 600, 400, 300)]);

  const onIt = checkFit([place('a', 'crate', -400, 700)], withBrackets, lookup);
  assert.ok(onIt.some((i) => i.kind === 'on-obstruction'));

  // Clear of the bracket, and off the floor, are both fine.
  const clear = checkFit([place('a', 'crate', 300, 300)], withBrackets, lookup);
  assert.ok(!clear.some((i) => i.kind === 'on-obstruction'));
});
