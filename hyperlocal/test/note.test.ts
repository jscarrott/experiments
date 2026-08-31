import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNote, countGraphemes, toNote, validateNote } from '../shared/note.js';
import { cafe } from './helpers.js';

const good = {
  $type: 'xyz.hyperlocal.note',
  text: 'Good coffee, bad food',
  location: { latitude: '51.5074', longitude: '-0.1278' },
  createdAt: '2026-08-31T10:00:00.000Z',
};

function errorsFor(value: unknown): string[] {
  const result = validateNote(value);
  return result.ok ? [] : result.errors;
}

test('accepts a minimal valid note', () => {
  const result = validateNote(good);
  assert.ok(result.ok, JSON.stringify(errorsFor(good)));
});

test('accepts a full note with a rating, tags and a place', () => {
  const result = validateNote({ ...good, rating: 4, tags: ['coffee'], place: cafe });
  assert.ok(result.ok);
});

test('rejects ratings outside 1-5, including the off-by-one ends', () => {
  assert.ok(errorsFor({ ...good, rating: 0 }).some((e) => e.includes('between')));
  assert.ok(errorsFor({ ...good, rating: 6 }).some((e) => e.includes('between')));
  assert.ok(errorsFor({ ...good, rating: 3.5 }).some((e) => e.includes('whole number')));
  assert.ok(errorsFor({ ...good, rating: '4' }).length > 0);
});

test('requires text, location and createdAt', () => {
  assert.ok(errorsFor({ ...good, text: undefined }).some((e) => e.includes('text')));
  assert.ok(errorsFor({ ...good, text: '' }).some((e) => e.includes('text')));
  assert.ok(errorsFor({ ...good, location: undefined }).some((e) => e.includes('location')));
  assert.ok(errorsFor({ ...good, createdAt: 'yesterday' }).some((e) => e.includes('createdAt')));
  assert.ok(errorsFor(null).length > 0);
  assert.ok(errorsFor([]).length > 0);
});

test('rejects a location whose coordinates are out of range', () => {
  const errors = errorsFor({ ...good, location: { latitude: '95', longitude: '0' } });
  assert.ok(errors.some((e) => e.includes('latitude')));
});

test('counts graphemes, not code units, for the text limit', () => {
  // A family emoji is one grapheme but eleven UTF-16 code units.
  const family = '\u{1F468}‍\u{1F469}‍\u{1F467}';
  assert.equal(countGraphemes(family), 1);
  assert.ok(validateNote({ ...good, text: family.repeat(300) }).ok);
  assert.ok(!validateNote({ ...good, text: family.repeat(301) }).ok);
});

test('rejects too many tags and over-long tags', () => {
  assert.ok(errorsFor({ ...good, tags: Array(9).fill('x') }).some((e) => e.includes('8 tags')));
  assert.ok(errorsFor({ ...good, tags: ['x'.repeat(41)] }).some((e) => e.includes('too long')));
  assert.ok(errorsFor({ ...good, tags: 'coffee' }).length > 0);
});

test('rejects a malformed place reference', () => {
  assert.ok(errorsFor({ ...good, place: { osmType: 'building', osmId: '1' } }).length > 0);
  assert.ok(errorsFor({ ...good, place: { osmType: 'node', osmId: 123 } }).length > 0);
  assert.ok(errorsFor({ ...good, place: { osmType: 'node' } }).length > 0);
});

test('keeps large OSM ids intact as strings', () => {
  // Beyond 2^53; a JSON number would have lost the last digits.
  const bigId = '12345678901234567';
  const result = validateNote({ ...good, place: { osmType: 'way', osmId: bigId } });
  assert.ok(result.ok);
  assert.equal(result.record.place?.osmId, bigId);
});

test('buildNote produces a record that validates', () => {
  const record = buildNote({
    text: 'Good coffee, bad food',
    lat: 51.5074,
    lng: -0.1278,
    rating: 4,
    place: cafe,
    tags: ['coffee'],
  });
  assert.ok(validateNote(record).ok);
  assert.equal(record.location.latitude, '51.5074');
  assert.equal(record.$type, 'xyz.hyperlocal.note');
});

test('buildNote omits empty optionals rather than writing nulls', () => {
  const record = buildNote({ text: 'hi', lat: 0, lng: 0, tags: [] });
  assert.ok(!('rating' in record));
  assert.ok(!('tags' in record));
  assert.ok(!('place' in record));
});

test('toNote parses coordinates once and derives the place key', () => {
  const note = toNote('at://did:plc:a/xyz.hyperlocal.note/1', 'bafy', 'did:plc:a', {
    ...good,
    place: cafe,
  });
  assert.ok(note);
  assert.equal(note.lat, 51.5074);
  assert.equal(note.placeKey, 'node/1234567890');
  assert.equal(note.author, 'did:plc:a');
});

test('toNote returns null for a record another member wrote badly', () => {
  // A space gives access control, not trust: members write to their own repos and
  // anything they put there arrives at sync.
  assert.equal(toNote('at://x', 'bafy', 'did:plc:a', { text: 'no location' }), null);
  assert.equal(toNote('at://x', 'bafy', 'did:plc:a', 'not an object'), null);
});
