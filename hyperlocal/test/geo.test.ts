import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cacheCell,
  distanceMetres,
  formatCoord,
  inBbox,
  normaliseBbox,
  padBbox,
  parseLatitude,
  parseLongitude,
} from '../shared/geo.js';

test('parses the string coordinates the geo lexicon actually stores', () => {
  assert.equal(parseLatitude('51.5074'), 51.5074);
  assert.equal(parseLongitude('-0.1278'), -0.1278);
  assert.equal(parseLatitude('0'), 0);
  assert.equal(parseLatitude('.5'), 0.5);
  assert.equal(parseLatitude('1e1'), 10);
});

test('rejects coordinates that are out of range or not plain decimals', () => {
  // Number() would happily accept every one of these; that is the point.
  assert.equal(parseLatitude('91'), null, 'beyond the poles');
  assert.equal(parseLongitude('181'), null, 'beyond the antimeridian');
  assert.equal(parseLatitude('0x10'), null, 'hex');
  assert.equal(parseLatitude('Infinity'), null);
  assert.equal(parseLatitude(''), null);
  assert.equal(parseLatitude('  '), null);
  assert.equal(parseLatitude('51.5N'), null);
  assert.equal(parseLatitude(undefined as unknown as string), null);
});

test('round-trips a coordinate without accumulating float noise', () => {
  assert.equal(formatCoord(51.50739999999999), '51.5074');
  assert.equal(formatCoord(-0.1278), '-0.1278');
  assert.equal(parseLatitude(formatCoord(51.5074)), 51.5074);
});

test('bbox containment includes the edges', () => {
  const box = { west: -1, south: 51, east: 1, north: 52 };
  assert.ok(inBbox(51.5, 0, box));
  assert.ok(inBbox(51, -1, box), 'corner is inside');
  assert.ok(!inBbox(50.9, 0, box));
  assert.ok(!inBbox(51.5, 1.1, box));
});

test('normalising fixes inverted latitudes and clamps to the valid range', () => {
  const box = normaliseBbox({ west: -1, south: 52, east: 1, north: 51 });
  assert.deepEqual(box, { west: -1, south: 51, east: 1, north: 52 });
  assert.deepEqual(normaliseBbox({ west: -200, south: -100, east: 200, north: 100 }), {
    west: -180,
    south: -90,
    east: 180,
    north: 90,
  });
});

test('a bbox crossing the antimeridian is refused rather than silently wrong', () => {
  assert.equal(normaliseBbox({ west: 170, south: -1, east: -170, north: 1 }), null);
  assert.equal(normaliseBbox({ west: NaN, south: 0, east: 1, north: 1 }), null);
});

test('padding grows a bbox by a fraction of its own size', () => {
  const padded = padBbox({ west: 0, south: 50, east: 2, north: 52 }, 0.5);
  assert.deepEqual(padded, { west: -1, south: 49, east: 3, north: 53 });
});

test('distance is roughly right for a known pair', () => {
  // London to Paris, about 344km.
  const d = distanceMetres(51.5074, -0.1278, 48.8566, 2.3522);
  assert.ok(d > 340_000 && d < 348_000, `got ${d}`);
  assert.equal(distanceMetres(51.5, -0.1, 51.5, -0.1), 0);
});

test('the cache cell collapses points within about ten metres', () => {
  assert.equal(cacheCell(51.50741, -0.12781), cacheCell(51.507412, -0.127814));
  assert.notEqual(cacheCell(51.5074, -0.1278), cacheCell(51.5079, -0.1278));
});
