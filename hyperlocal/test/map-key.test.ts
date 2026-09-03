import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAP_KEY, paintedColours } from '../web/map-style.js';

// A five-way colour code with no key is unreadable, and a key that has drifted from the
// map is worse than none. Both are built from the same constants; this is what keeps a
// new colour from being added to one and not the other.
test('the key explains every colour the map can paint', () => {
  const keyed = new Set(MAP_KEY.map((entry) => entry.colour));
  for (const colour of paintedColours()) {
    assert.ok(keyed.has(colour), `${colour} is painted on the map but absent from the key`);
  }
});

test('the key has no entries the map never paints', () => {
  const painted = new Set(paintedColours());
  for (const entry of MAP_KEY) {
    assert.ok(painted.has(entry.colour), `${entry.label} names ${entry.colour}, which is never painted`);
  }
});

test('every entry is labelled', () => {
  for (const entry of MAP_KEY) assert.ok(entry.label.trim().length > 0);
});
