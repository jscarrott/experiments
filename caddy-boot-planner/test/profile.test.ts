import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CADDY_MAXI_LIFE_2K, VEHICLE_PRESETS } from '../src/model/vehicle.js';
import { archBoxes, halfWidthAt, obstructionBoxes } from '../src/geometry/shell.js';
import { checkFit } from '../src/geometry/fit.js';
import { CATALOGUE } from '../src/model/catalogue.js';
import type { VehicleProfile } from '../src/model/types.js';

/**
 * The shipped profile has to hang together, because anchors and rails are positioned
 * relative to a floor length that has already moved once (1100 → 1540) and will move
 * again the first time somebody puts a tape on their own van. A rail sitting outside
 * the boot or an aperture wider than the bay would not throw — it would just quietly
 * disable a check.
 */

const profile = CADDY_MAXI_LIFE_2K;

function everyDim(p: VehicleProfile) {
  return Object.entries(p).filter(
    (entry): entry is [string, { value: number; provenance: string }] =>
      typeof entry[1] === 'object' && entry[1] !== null && 'value' in entry[1],
  );
}

test('every dimension is a positive, finite number', () => {
  for (const [name, d] of everyDim(profile)) {
    assert.ok(Number.isFinite(d.value), `${name} should be finite`);
    // Arch intrusion is legitimately zero on a trimmed Life; nothing else may be.
    if (name === 'archIntrusion') assert.ok(d.value >= 0, `${name} should not be negative`);
    else assert.ok(d.value > 0, `${name} should be above zero, got ${d.value}`);
  }
});

test('the tailgate opening is no wider or taller than the bay behind it', () => {
  assert.ok(
    profile.apertureWidth.value <= profile.floorWidth.value,
    'an opening wider than the bay would make the aperture width check unreachable',
  );
  assert.ok(profile.apertureHeight.value <= profile.loadHeight.value);
});

test('the bay never reports more width than the floor width at any height', () => {
  for (let z = 0; z <= profile.loadHeight.value; z += 50) {
    const half = halfWidthAt(profile, z, profile.floorLength.value / 2);
    assert.ok(half > 0, `bay should have width at ${z} mm`);
    assert.ok(
      half <= profile.floorWidth.value / 2 + 0.001,
      `bay is wider than the floor at ${z} mm`,
    );
  }
});

test('every lashing eye sits inside the load floor', () => {
  const halfWidth = profile.floorWidth.value / 2;
  for (const anchor of profile.anchors) {
    assert.ok(
      Math.abs(anchor.x) <= halfWidth,
      `${anchor.label} is ${Math.abs(anchor.x)} mm out, past the ${halfWidth} mm half-width`,
    );
    assert.ok(
      anchor.y >= 0 && anchor.y <= profile.floorLength.value,
      `${anchor.label} at y=${anchor.y} is outside the 0–${profile.floorLength.value} floor`,
    );
  }
});

test('every floor obstruction sits inside the load floor', () => {
  for (const o of obstructionBoxes(profile)) {
    assert.ok(o.minX >= -profile.floorWidth.value / 2, `${o.label} pokes out of the left side`);
    assert.ok(o.maxX <= profile.floorWidth.value / 2, `${o.label} pokes out of the right side`);
    assert.ok(o.minY >= 0, `${o.label} starts ahead of the seat backs`);
    assert.ok(o.maxY <= profile.floorLength.value, `${o.label} runs past the load lip`);
  }
});

test('the third-row rails are where the third row would have been', () => {
  const rails = obstructionBoxes(profile);
  assert.equal(rails.length, 2, 'two rails');

  // The third row leaves 620 mm of boot behind it, so its mountings belong in the
  // rear half of the bay — not under where the second row sits.
  for (const rail of rails) {
    assert.ok(rail.minY > profile.floorLength.value / 3, `${rail.label} is too far forward`);
    assert.ok(rail.maxY < profile.floorLength.value, `${rail.label} runs past the load lip`);
  }

  // Symmetric about the centreline.
  const [left, right] = rails;
  assert.equal(Math.round(left!.minX), -Math.round(right!.maxX));
});

test('arch solids are suppressed when the arches are flush with the trim', () => {
  assert.equal(
    profile.widthBetweenArches.value,
    profile.floorWidth.value,
    'the shipped Life profile is parallel-sided',
  );
  assert.deepEqual(archBoxes(profile), [], 'no zero-width solids should be produced');
});

test('every catalogue item can actually be loaded into the shipped bay', () => {
  // Run each one through the app's own checks rather than restating the maths here,
  // so this cannot drift from what the tool tells you on screen. If something is added
  // to the catalogue that physically will not go in, this fails immediately instead of
  // looking fine right up until you are stood at the tailgate with it.
  const blocking = new Set([
    'too-wide',
    'too-tall',
    'past-seats',
    'past-tailgate',
    'wont-fit-aperture',
  ]);

  for (const spec of CATALOGUE) {
    const lookup = () => spec;
    const box = {
      id: 'x',
      specId: spec.id,
      label: spec.name,
      x: 0,
      // Centred fore-aft, so nothing fails merely for being badly placed.
      y: profile.floorLength.value / 2,
      z: 0,
      rotation: 0 as const,
      contentsKg: 0,
      needOften: false,
    };

    const problems = checkFit([box], profile, lookup).filter((i) => blocking.has(i.kind));
    assert.deepEqual(
      problems.map((p) => `${p.kind}: ${p.message}`),
      [],
      `${spec.name} (${spec.width.value}×${spec.depth.value}×${spec.height.value}) should load`,
    );
  }
});

test('the two camping items are the shapes they are supposed to be', () => {
  const cooler = CATALOGUE.find((s) => s.id === 'coleman-pro-25qt');
  const table = CATALOGUE.find((s) => s.id === 'camp-table-folded');
  assert.ok(cooler && table);

  // The cool box being the tallest thing in the catalogue is load-bearing information:
  // it is what limits stacking. If something taller is added, this should be revisited.
  const tallest = Math.max(...CATALOGUE.map((s) => s.height.value));
  assert.equal(cooler.height.value, tallest, 'the cool box should be the tallest item');

  // The table is a flat slab, not a box — if that stops being true the "good stacking
  // base" assumption in the catalogue comment stops being true with it.
  assert.ok(table.height.value < 100, 'a folded table should be a slab');
  assert.ok(table.width.value > table.height.value * 5);
});

test('every preset passes the same checks', () => {
  for (const preset of VEHICLE_PRESETS) {
    assert.ok(preset.id.length > 0);
    assert.ok(preset.anchors.length > 0, `${preset.name} should have lashing eyes`);
    assert.ok(preset.floorLength.value > preset.apertureHeight.value / 2);
  }
});
