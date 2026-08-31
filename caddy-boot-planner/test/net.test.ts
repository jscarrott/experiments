import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cordBetween, drapeNet, upperHull } from '../src/geometry/net.js';
import { aabbOf } from '../src/geometry/boxes.js';
import type { Anchor, CargoNet } from '../src/model/types.js';
import { makeLookup, place, spec } from './helpers.js';

const tall = spec('tall', 400, 400, 600);
const short = spec('short', 400, 400, 200);
const lookup = makeLookup([tall, short]);

const anchorAt = (id: string, x: number, y: number): Anchor => ({
  id,
  label: id,
  x,
  y,
  z: 0,
  kind: 'factory-eye',
});

test('upperHull keeps peaks and discards anything that sags below the line', () => {
  const hull = upperHull([
    { t: 0, z: 0 },
    { t: 0.25, z: 100 },
    { t: 0.5, z: 10 }, // a dip — a taut line bridges straight over it
    { t: 0.75, z: 100 },
    { t: 1, z: 0 },
  ]);
  const ts = hull.map((p) => p.t);
  assert.deepEqual(ts, [0, 0.25, 0.75, 1], 'the dip at t=0.5 should not be on the taut line');
});

test('a cord rests on a single box in its path', () => {
  const box = place('b', 'tall', 0, 500, 0);
  const boxes = [{ id: 'b', aabb: aabbOf(tall, box) }];
  const cord = cordBetween(anchorAt('a1', 0, 100), anchorAt('a2', 0, 900), boxes);
  assert.deepEqual(cord.touchingBoxIds, ['b']);
});

test('THE CASE THAT MATTERS: a short box between two tall ones is bridged, not held', () => {
  // Three boxes in a row down the van. The middle one is 400 mm shorter than its
  // neighbours, so a net pulled over the lot never lands on it — which is exactly
  // the situation that looks perfectly well restrained when you shut the tailgate.
  const front = place('front', 'tall', 0, 300, 0);
  const middle = place('middle', 'short', 0, 700, 0);
  const back = place('back', 'tall', 0, 1100, 0);

  const boxes = [
    { id: 'front', aabb: aabbOf(tall, front) },
    { id: 'middle', aabb: aabbOf(short, middle) },
    { id: 'back', aabb: aabbOf(tall, back) },
  ];

  const cord = cordBetween(anchorAt('a1', 0, 0), anchorAt('a2', 0, 1400), boxes);

  assert.ok(cord.touchingBoxIds.includes('front'), 'the tall boxes take the tension');
  assert.ok(cord.touchingBoxIds.includes('back'));
  assert.ok(
    !cord.touchingBoxIds.includes('middle'),
    'the short box in the middle is bridged over and held by nothing',
  );
});

test('raising the short box to its neighbours brings it into contact', () => {
  const front = place('front', 'tall', 0, 300, 0);
  // Packed out so its top is level with the tall boxes.
  const middle = place('middle', 'short', 0, 700, 400);
  const back = place('back', 'tall', 0, 1100, 0);

  const boxes = [
    { id: 'front', aabb: aabbOf(tall, front) },
    { id: 'middle', aabb: aabbOf(short, middle) },
    { id: 'back', aabb: aabbOf(tall, back) },
  ];

  const cord = cordBetween(anchorAt('a1', 0, 0), anchorAt('a2', 0, 1400), boxes);
  assert.ok(cord.touchingBoxIds.includes('middle'), 'now the net lands on it');
});

test('drapeNet reports the bridged box and holds the rest', () => {
  const boxes = [
    place('front', 'tall', 0, 300, 0),
    place('middle', 'short', 0, 700, 0),
    place('back', 'tall', 0, 1100, 0),
  ];

  const anchors = [
    anchorAt('fl', -500, 100),
    anchorAt('fr', 500, 100),
    anchorAt('rl', -500, 1300),
    anchorAt('rr', 500, 1300),
  ];

  const net: CargoNet = {
    id: 'net-1',
    label: 'net',
    anchorIds: anchors.map((a) => a.id),
    relaxedWidth: 700,
    relaxedLength: 700,
    maxStretchRatio: 2.0,
  };

  const result = drapeNet(net, anchors, boxes, lookup);

  assert.ok(result.heldBoxIds.has('front'));
  assert.ok(result.heldBoxIds.has('back'));
  assert.ok(result.bridgedBoxIds.has('middle'), 'the middle box is under the net but untouched');
  assert.ok(!result.heldBoxIds.has('middle'));
  assert.ok(result.cords.length === 6, 'four anchors give six cords including the diagonals');
});

test('a net pulled well past its relaxed size is reported as over-stretched', () => {
  const anchors = [
    anchorAt('fl', -600, 0),
    anchorAt('fr', 600, 0),
    anchorAt('rl', -600, 1400),
    anchorAt('rr', 600, 1400),
  ];

  const small: CargoNet = {
    id: 'net-small',
    label: 'small net',
    anchorIds: anchors.map((a) => a.id),
    relaxedWidth: 300,
    relaxedLength: 300,
    maxStretchRatio: 2.0,
  };

  const result = drapeNet(small, anchors, [], lookup);
  assert.ok(result.overStretched, 'a 300 mm net across a 1.2 m x 1.4 m bay is past its limit');

  const big: CargoNet = { ...small, id: 'net-big', relaxedWidth: 1200, relaxedLength: 1400 };
  assert.ok(!drapeNet(big, anchors, [], lookup).overStretched);
});
