import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LIMITS, OSM_TYPES } from '../shared/note.js';
import { NAMESPACE, NOTE_COLLECTION, SPACE_TYPE, spaceAuthority, spaceRef } from '../shared/nsid.js';

// Resolved against this file, not the working directory, so the test passes wherever
// it is run from.
const lexiconDir = fileURLToPath(
  new URL(`../lexicons/${NAMESPACE.split('.').join('/')}/`, import.meta.url),
);
const read = (name: string) =>
  JSON.parse(readFileSync(`${lexiconDir}${name}.json`, 'utf8'));

const note = read('note');
const space = read('space');

const props = note.defs.main.record.properties;
const osmProps = note.defs.osmPlace.properties;

// shared/note.ts restates the lexicon's constraints so validation has no dependencies.
// These assertions are what stops the two drifting apart.
test('validator limits match the note lexicon', () => {
  assert.equal(props.text.maxLength, LIMITS.textMaxLength);
  assert.equal(props.text.maxGraphemes, LIMITS.textMaxGraphemes);
  assert.equal(props.rating.minimum, LIMITS.ratingMin);
  assert.equal(props.rating.maximum, LIMITS.ratingMax);
  assert.equal(props.tags.maxLength, LIMITS.tagsMaxLength);
  assert.equal(props.tags.items.maxLength, LIMITS.tagMaxLength);
  assert.equal(props.tags.items.maxGraphemes, LIMITS.tagMaxGraphemes);
  assert.equal(osmProps.name.maxLength, LIMITS.placeNameMaxLength);
  assert.equal(osmProps.category.maxLength, LIMITS.placeCategoryMaxLength);
  assert.deepEqual(osmProps.osmType.knownValues, [...OSM_TYPES]);
});

test('lexicon ids match the namespace constants', () => {
  assert.equal(note.id, NOTE_COLLECTION);
  assert.equal(space.id, SPACE_TYPE);
});

test('the note lexicon requires exactly what the validator requires', () => {
  assert.deepEqual(note.defs.main.record.required, ['text', 'location', 'createdAt']);
  assert.equal(note.defs.main.key, 'tid');
});

test('the space lexicon declares the note collection and a single space per owner', () => {
  assert.equal(space.defs.main.type, 'space');
  assert.equal(space.defs.main.key, 'literal:self');
  assert.deepEqual(space.defs.main.collections, [NOTE_COLLECTION]);
});

test('space refs round-trip through their authority', () => {
  const ref = spaceRef('did:plc:owner');
  assert.equal(ref, `at://did:plc:owner/space/${SPACE_TYPE}/self`);
  assert.equal(spaceAuthority(ref), 'did:plc:owner');
  assert.equal(spaceAuthority(`at://did:plc:x/${NOTE_COLLECTION}/abc`), null);
});
