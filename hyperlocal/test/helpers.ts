import { NOTE_COLLECTION } from '../shared/nsid.js';
import { toNote } from '../shared/note.js';
import type { Note, OsmPlace } from '../shared/types.js';

let seq = 0;

export function makeNote(input: {
  author?: string;
  lat?: number;
  lng?: number;
  text?: string;
  rating?: number;
  tags?: string[];
  place?: OsmPlace;
  createdAt?: string;
}): Note {
  const n = ++seq;
  const record: Record<string, unknown> = {
    $type: NOTE_COLLECTION,
    text: input.text ?? `note ${n}`,
    location: {
      $type: 'community.lexicon.location.geo',
      latitude: String(input.lat ?? 51.5),
      longitude: String(input.lng ?? -0.12),
    },
    createdAt: input.createdAt ?? new Date(1_700_000_000_000 + n * 1000).toISOString(),
  };
  if (input.rating !== undefined) record.rating = input.rating;
  if (input.tags) record.tags = input.tags;
  if (input.place) record.place = input.place;

  const note = toNote(
    `at://${input.author ?? 'did:plc:alice'}/${NOTE_COLLECTION}/${n}`,
    `bafy${n}`,
    input.author ?? 'did:plc:alice',
    record,
  );
  if (!note) throw new Error(`fixture did not validate: ${JSON.stringify(record)}`);
  return note;
}

export const cafe: OsmPlace = {
  osmType: 'node',
  osmId: '1234567890',
  name: 'The Corner Café',
  category: 'amenity=cafe',
};

export const pub: OsmPlace = {
  osmType: 'way',
  osmId: '987654321',
  name: 'The Crown',
  category: 'amenity=pub',
};
