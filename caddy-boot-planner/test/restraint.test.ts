import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkRestraint, routeStrap } from '../src/geometry/straps.js';
import { drapeNet } from '../src/geometry/net.js';
import { findStacks } from '../src/geometry/stacking.js';
import { checkAccess } from '../src/geometry/access.js';
import { checkMass, computeMass } from '../src/geometry/mass.js';
import type { Anchor, CargoNet, Strap } from '../src/model/types.js';
import { makeLookup, place, spec } from './helpers.js';

const tall = spec('tall', 400, 400, 600);
const short = spec('short', 400, 400, 200);
const latch = spec('latch', 554, 371, 300, { stackMode: 'latching', stackGroup: 'ts2' });
const lookup = makeLookup([tall, short, latch]);

const anchorAt = (id: string, x: number, y: number): Anchor => ({
  id,
  label: id,
  x,
  y,
  z: 0,
  kind: 'factory-eye',
});

// --- Straps ----------------------------------------------------------------

test('strap length over a box matches the hand calculation', () => {
  // Anchors 800 mm apart on the floor, a 600 mm tall box centred between them.
  // The taut path is: up and over to the near top corner, across the 400 mm top,
  // then down to the far anchor. Each sloped leg spans 200 mm along the floor
  // and 600 mm up, so hypot(200, 600) each.
  const box = place('b', 'tall', 0, 500, 0);
  const strap: Strap = {
    id: 's1',
    label: 'strap',
    fromAnchorId: 'a1',
    toAnchorId: 'a2',
    overBoxIds: ['b'],
    kind: 'ratchet',
  };
  const anchors = [anchorAt('a1', 0, 100), anchorAt('a2', 0, 900)];
  const result = routeStrap(strap, anchors, [box], lookup);

  const expected = 2 * Math.hypot(200, 600) + 400;
  assert.ok(result, 'strap should route');
  assert.ok(
    Math.abs(result.spanLength - expected) < 15,
    `expected about ${expected.toFixed(0)} mm, got ${result.spanLength.toFixed(0)} mm`,
  );

  // Recommended length adds slack for the ratchet and tails, rounded up.
  assert.ok(result.recommendedLength >= result.spanLength + 500);
  assert.equal(result.recommendedLength % 100, 0);
});

test('a strap meant to hold a box it never touches reports the miss', () => {
  const front = place('front', 'tall', 0, 300, 0);
  const middle = place('middle', 'short', 0, 700, 0);
  const back = place('back', 'tall', 0, 1100, 0);

  const strap: Strap = {
    id: 's1',
    label: 'strap',
    fromAnchorId: 'a1',
    toAnchorId: 'a2',
    overBoxIds: ['front', 'middle', 'back'],
    kind: 'ratchet',
  };
  const anchors = [anchorAt('a1', 0, 0), anchorAt('a2', 0, 1400)];
  const result = routeStrap(strap, anchors, [front, middle, back], lookup);

  assert.deepEqual(result?.missedBoxIds, ['middle']);
});

// --- Restraint summary -----------------------------------------------------

test('a heavy box under a bridging net is called out specifically', () => {
  const boxes = [
    place('front', 'tall', 0, 300, 0, { contentsKg: 10 }),
    place('middle', 'short', 0, 700, 0, { contentsKg: 20 }),
    place('back', 'tall', 0, 1100, 0, { contentsKg: 10 }),
  ];
  const anchors = [
    anchorAt('fl', -500, 100),
    anchorAt('fr', 500, 100),
    anchorAt('rl', -500, 1300),
    anchorAt('rr', 500, 1300),
  ];
  const net: CargoNet = {
    id: 'n1',
    label: 'net',
    anchorIds: anchors.map((a) => a.id),
    relaxedWidth: 700,
    relaxedLength: 700,
    maxStretchRatio: 2,
  };

  const draped = drapeNet(net, anchors, boxes, lookup);
  const issues = checkRestraint(
    boxes,
    lookup,
    [],
    draped.heldBoxIds,
    draped.bridgedBoxIds,
    findStacks(boxes, lookup),
    5,
  );

  const middleIssue = issues.find((i) => i.boxId === 'middle');
  assert.ok(middleIssue, 'the bridged box should be flagged');
  assert.match(middleIssue.message, /bridges/, 'and the message should say why');
  assert.ok(!issues.some((i) => i.boxId === 'front'), 'the held boxes should be fine');
});

test('a latched stack shares restraint across its boxes', () => {
  const boxes = [
    place('lower', 'latch', 0, 500, 0, { contentsKg: 15 }),
    place('upper', 'latch', 0, 500, 300, { contentsKg: 15 }),
  ];
  const stacks = findStacks(boxes, lookup);
  assert.equal(stacks[0]?.rigid, true);

  // Only the top box is touched by the strap, but the stack is latched.
  const issues = checkRestraint(boxes, lookup, [], new Set(['upper']), new Set(), stacks, 5);
  assert.equal(issues.length, 0, 'the bottom box is held by being latched to the top one');
});

test('light boxes below the threshold are not nagged about', () => {
  const boxes = [place('light', 'short', 0, 500, 0, { contentsKg: 0.5 })];
  const issues = checkRestraint(boxes, lookup, [], new Set(), new Set(), [], 5);
  assert.equal(issues.length, 0);
});

// --- Access ----------------------------------------------------------------

test('a box marked need-often but buried behind others is flagged', () => {
  const buried = place('kit', 'tall', 0, 300, 0, { needOften: true, label: 'First aid kit' });
  const blocker = place('blocker', 'tall', 0, 800, 0, { label: 'Tent' });

  const { issues, reachable } = checkAccess([buried, blocker], lookup);
  assert.ok(issues.some((i) => i.boxId === 'kit' && i.kind === 'buried'));
  assert.ok(reachable.has('blocker'), 'the box nearest the tailgate is reachable');
  assert.ok(!reachable.has('kit'));
});

test('a box under a stack is flagged separately from one buried behind', () => {
  const under = place('under', 'tall', 0, 500, 0, { needOften: true });
  const onTop = place('ontop', 'short', 0, 500, 600);
  const { issues } = checkAccess([under, onTop], lookup);
  assert.ok(issues.some((i) => i.boxId === 'under' && i.kind === 'under-stack'));
});

test('a box not marked need-often is not nagged about', () => {
  const buried = place('kit', 'tall', 0, 300, 0);
  const blocker = place('blocker', 'tall', 0, 800, 0);
  assert.equal(checkAccess([buried, blocker], lookup).issues.length, 0);
});

// --- Mass ------------------------------------------------------------------

test('centre of gravity sits between two equal boxes and leans towards a heavy one', () => {
  const even = [
    place('a', 'tall', -300, 500, 0, { contentsKg: 10 }),
    place('b', 'tall', 300, 500, 0, { contentsKg: 10 }),
  ];
  assert.ok(Math.abs(computeMass(even, lookup, 600).centreOfGravity.x) < 1);

  const lopsided = [
    place('a', 'tall', -300, 500, 0, { contentsKg: 1 }),
    place('b', 'tall', 300, 500, 0, { contentsKg: 50 }),
  ];
  assert.ok(computeMass(lopsided, lookup, 600).centreOfGravity.x > 200);
});

test('mass checks flag an overloaded, rear-heavy and top-heavy load', () => {
  const boxes = [place('a', 'tall', 0, 1000, 700, { contentsKg: 700 })];
  const mass = computeMass(boxes, lookup, 600);
  const issues = checkMass(mass, 1200, 1200);

  assert.ok(issues.some((i) => i.kind === 'over-payload'));
  assert.ok(issues.some((i) => i.kind === 'rear-heavy'));
  assert.ok(issues.some((i) => i.kind === 'top-heavy'));
});

test('a sensible load raises nothing', () => {
  const boxes = [place('a', 'tall', 0, 300, 0, { contentsKg: 20 })];
  const mass = computeMass(boxes, lookup, 600);
  assert.equal(checkMass(mass, 1200, 1200).length, 0);
});
