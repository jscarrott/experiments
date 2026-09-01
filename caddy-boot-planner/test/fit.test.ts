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

// --- Third-row rails -------------------------------------------------------

/** Two parallel fore-aft rails, as the Caddy leaves behind when the seats come out. */
function railProfile(height = 25) {
  const p = testProfile();
  p.floorObstructions = [
    { id: 'rail-l', label: 'Third-row rail (left)', x: -330, y: 700, width: 60, depth: 430, height },
    { id: 'rail-r', label: 'Third-row rail (right)', x: 330, y: 700, width: 60, depth: 430, height },
  ];
  return p;
}

test('a crate straddling both rails sits level and is not treated as rocking', () => {
  const profile = railProfile();
  // 800 wide spans from -400 to 400, so it bears on both rails at ±330.
  const lookup = makeLookup([spec('wide-crate', 800, 400, 300)]);
  const issues = checkFit([place('a', 'wide-crate', 0, 700, 25)], profile, lookup);

  const rail = issues.find((i) => i.kind === 'on-obstruction');
  assert.ok(rail, 'it should still say something — you have lost 25 mm of headroom');
  assert.match(rail.message, /level/, 'but it should say it sits level, not that it rocks');
  assert.doesNotMatch(rail.message, /rock/);
});

test('a crate caught on one rail only is reported as rocking', () => {
  const profile = railProfile();
  // 400 wide centred on the left rail: nothing under its other side.
  const lookup = makeLookup([spec('crate', 400, 400, 300)]);
  const issues = checkFit([place('a', 'crate', -330, 700, 25)], profile, lookup);

  const rail = issues.find((i) => i.kind === 'on-obstruction');
  assert.ok(rail);
  assert.match(rail.message, /rock/);
});

test('rails of different heights make a straddling crate rock', () => {
  const profile = railProfile();
  profile.floorObstructions[1]!.height = 40; // one rail sits proud of the other
  const lookup = makeLookup([spec('wide-crate', 800, 400, 300)]);
  const issues = checkFit([place('a', 'wide-crate', 0, 700, 25)], profile, lookup);

  const rail = issues.find((i) => i.kind === 'on-obstruction');
  assert.ok(rail);
  assert.match(rail.message, /different heights/);
});

test('a crate clear of the rails is left alone', () => {
  const profile = railProfile();
  const lookup = makeLookup([spec('crate', 600, 400, 300)]);
  const issues = checkFit([place('a', 'crate', 0, 200, 0)], profile, lookup);
  assert.ok(!issues.some((i) => i.kind === 'on-obstruction'));
});

test('a box stacked up high is not accused of sitting on the rails below it', () => {
  const profile = railProfile();
  const lookup = makeLookup([spec('crate', 600, 400, 300)]);
  const issues = checkFit([place('a', 'crate', 0, 700, 400)], profile, lookup);
  assert.ok(!issues.some((i) => i.kind === 'on-obstruction'));
});

test('the too-wide message blames the trim, not the arches, when arches are flush', () => {
  const flush = testProfile();
  flush.floorWidth = { value: 1120, provenance: 'measured' };
  flush.widthBetweenArches = { value: 1120, provenance: 'measured' };
  flush.widthAtRoof = { value: 1110, provenance: 'measured' };

  const lookup = makeLookup([spec('too-wide', 1200, 400, 300)]);
  const issues = checkFit([place('a', 'too-wide', 0, 600, 0)], flush, lookup);

  const wide = issues.find((i) => i.kind === 'too-wide');
  assert.ok(wide);
  assert.doesNotMatch(wide.message, /wheel arch/, 'the arches are flush — they are not the cause');
  assert.match(wide.message, /the bay is not that wide/);
  // A shade under 1120: the box is 300 tall and the sides still lean in very slightly.
  assert.match(wide.message, /111\d mm/, 'it should say how much room there actually is');
});

test('the too-wide message does still blame the arches when they genuinely intrude', () => {
  // testProfile() keeps the van-like 1552 / 1172 split on purpose.
  const lookup = makeLookup([spec('wide', 1300, 400, 200)]);
  const archY = profile.archStartY.value + 350;
  const issues = checkFit([place('a', 'wide', 0, archY, 0)], profile, lookup);

  const wide = issues.find((i) => i.kind === 'too-wide');
  assert.ok(wide);
  assert.match(wide.message, /wheel arches/);
});

test('a box taller than the roof is reported as too tall, not as too wide', () => {
  // Above the roof line the bay has no width, so a naive width check reports an
  // over-tall box as "too wide, 0 mm available" — technically true, actively
  // unhelpful, and it hides the actual problem.
  const lookup = makeLookup([spec('tower', 400, 400, 1400)]);
  const issues = checkFit([place('a', 'tower', 0, 600, 0)], profile, lookup);

  assert.ok(issues.some((i) => i.kind === 'too-tall'), 'it is too tall');
  assert.ok(
    !issues.some((i) => i.kind === 'too-wide'),
    'a 400 mm box is not too wide for a 1552 mm bay at any height it occupies',
  );
});
