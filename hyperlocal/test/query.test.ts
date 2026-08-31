import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  authorCounts,
  filterNotes,
  groupByPlace,
  sortByNewest,
  tagCounts,
} from '../shared/query.js';
import { cafe, makeNote, pub } from './helpers.js';

const london = { west: -0.2, south: 51.4, east: 0.0, north: 51.6 };

test('filters by bounding box', () => {
  const notes = [
    makeNote({ lat: 51.5, lng: -0.12 }),
    makeNote({ lat: 55.9, lng: -3.19 }), // Edinburgh
  ];
  const found = filterNotes(notes, { bbox: london });
  assert.equal(found.length, 1);
  assert.equal(found[0].lat, 51.5);
});

test('filters by author, and no author filter means everyone', () => {
  const notes = [
    makeNote({ author: 'did:plc:alice' }),
    makeNote({ author: 'did:plc:bob' }),
  ];
  assert.equal(filterNotes(notes, { authors: ['did:plc:bob'] }).length, 1);
  assert.equal(filterNotes(notes, { authors: [] }).length, 2);
  assert.equal(filterNotes(notes, {}).length, 2);
});

test('ratedOnly keeps reviews and drops plain notes', () => {
  const notes = [makeNote({ rating: 5 }), makeNote({}), makeNote({ rating: 1 })];
  assert.equal(filterNotes(notes, { ratedOnly: true }).length, 2);
});

test('tag filtering requires every tag, case-insensitively', () => {
  const notes = [
    makeNote({ tags: ['coffee', 'wifi'] }),
    makeNote({ tags: ['coffee'] }),
    makeNote({ tags: [] }),
  ];
  assert.equal(filterNotes(notes, { tags: ['coffee'] }).length, 2);
  assert.equal(filterNotes(notes, { tags: ['coffee', 'wifi'] }).length, 1);
  assert.equal(filterNotes(notes, { tags: ['COFFEE'] }).length, 2);
});

test('search matches note text and place name', () => {
  const notes = [
    makeNote({ text: 'Good coffee, bad food' }),
    makeNote({ text: 'Nice view', place: cafe }),
  ];
  assert.equal(filterNotes(notes, { search: 'coffee' }).length, 1);
  assert.equal(filterNotes(notes, { search: 'corner café' }).length, 1);
  assert.equal(filterNotes(notes, { search: '   ' }).length, 2, 'blank search is no filter');
});

test('filters combine', () => {
  const notes = [
    makeNote({ author: 'did:plc:alice', lat: 51.5, rating: 5, tags: ['coffee'] }),
    makeNote({ author: 'did:plc:alice', lat: 51.5, tags: ['coffee'] }),
    makeNote({ author: 'did:plc:bob', lat: 51.5, rating: 5, tags: ['coffee'] }),
    makeNote({ author: 'did:plc:alice', lat: 55.9, rating: 5, tags: ['coffee'] }),
  ];
  const found = filterNotes(notes, {
    bbox: london,
    authors: ['did:plc:alice'],
    ratedOnly: true,
    tags: ['coffee'],
  });
  assert.equal(found.length, 1);
});

test('a bbox crossing the antimeridian filters nothing out rather than everything', () => {
  // normaliseBbox refuses it; the filter must not then silently return an empty map.
  const notes = [makeNote({ lat: 51.5, lng: -0.12 })];
  assert.equal(filterNotes(notes, { bbox: { west: 170, south: -1, east: -170, north: 1 } }).length, 1);
});

test('groups notes onto the business they are about', () => {
  const notes = [
    makeNote({ place: cafe, rating: 4, author: 'did:plc:alice' }),
    makeNote({ place: cafe, rating: 2, author: 'did:plc:bob' }),
    makeNote({ place: pub, rating: 5 }),
    makeNote({}), // a bench: no place, must not appear
  ];
  const groups = groupByPlace(notes);
  assert.equal(groups.length, 2);
  const cafeGroup = groups.find((g) => g.key === 'node/1234567890')!;
  assert.equal(cafeGroup.notes.length, 2);
  assert.equal(cafeGroup.averageRating, 3);
  assert.equal(cafeGroup.ratingCount, 2);
  assert.equal(cafeGroup.place.name, 'The Corner Café');
});

test('a place with no ratings has no average, not a zero', () => {
  const groups = groupByPlace([makeNote({ place: cafe }), makeNote({ place: cafe })]);
  assert.equal(groups[0].averageRating, undefined);
  assert.equal(groups[0].ratingCount, 0);
});

test('averages only the notes that carry a rating', () => {
  const groups = groupByPlace([
    makeNote({ place: cafe, rating: 5 }),
    makeNote({ place: cafe }), // unrated: must not count as a zero
  ]);
  assert.equal(groups[0].averageRating, 5);
  assert.equal(groups[0].ratingCount, 1);
});

test('the same business tapped from slightly different spots stays one group', () => {
  const groups = groupByPlace([
    makeNote({ place: cafe, lat: 51.5074, lng: -0.1278 }),
    makeNote({ place: cafe, lat: 51.5075, lng: -0.1279 }),
  ]);
  assert.equal(groups.length, 1);
  // The group sits at the mean, so it doesn't jump about with write order.
  assert.ok(Math.abs(groups[0].lat - 51.50745) < 1e-9);
});

test('sorts newest first, breaking ties on uri so the order is stable', () => {
  const a = makeNote({ createdAt: '2026-01-01T00:00:00.000Z' });
  const b = makeNote({ createdAt: '2026-06-01T00:00:00.000Z' });
  assert.deepEqual(sortByNewest([a, b]).map((n) => n.uri), [b.uri, a.uri]);
});

test('counts tags and authors for the filter UI', () => {
  const notes = [
    makeNote({ author: 'did:plc:alice', tags: ['coffee', 'wifi'] }),
    makeNote({ author: 'did:plc:alice', tags: ['coffee'] }),
    makeNote({ author: 'did:plc:bob', tags: ['coffee'] }),
  ];
  assert.deepEqual(tagCounts(notes), [
    { tag: 'coffee', count: 3 },
    { tag: 'wifi', count: 1 },
  ]);
  assert.deepEqual(authorCounts(notes), [
    { did: 'did:plc:alice', count: 2 },
    { did: 'did:plc:bob', count: 1 },
  ]);
});
