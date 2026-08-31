import { NOTE_COLLECTION } from './nsid.js';
import { formatCoord, parseLatitude, parseLongitude } from './geo.js';
import type { GeoLocation, Note, NoteRecord, OsmPlace } from './types.js';

/**
 * The constraints from `lexicons/xyz/hyperlocal/note.json`, restated so validation
 * runs with no dependencies at all — `shared/` is imported by the browser, the proxy
 * and the tests, and pinning an alpha-tagged schema package into that path would mean
 * core validation breaking every time the Spaces alpha moves.
 *
 * `test/lexicon-drift.test.ts` reads the lexicon JSON and asserts these match it, so
 * the duplication cannot silently rot.
 */
export const LIMITS = {
  textMaxLength: 3000,
  textMaxGraphemes: 300,
  ratingMin: 1,
  ratingMax: 5,
  tagsMaxLength: 8,
  tagMaxLength: 40,
  tagMaxGraphemes: 20,
  placeNameMaxLength: 200,
  placeCategoryMaxLength: 100,
} as const;

export const OSM_TYPES = ['node', 'way', 'relation'] as const;

// Intl.Segmenter is the only correct way to count what a person calls a character:
// an emoji with a skin-tone modifier is one grapheme and several code points.
const graphemeSegmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

export function countGraphemes(text: string): number {
  if (!graphemeSegmenter) return [...text].length;
  let n = 0;
  for (const _ of graphemeSegmenter.segment(text)) n++;
  return n;
}

export type ValidationResult =
  | { ok: true; record: NoteRecord }
  | { ok: false; errors: string[] };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Validate an untrusted note record.
 *
 * Used in two places, and it matters that it is the same function in both: the compose
 * form calls it before writing, and sync calls it on everything a member wrote. A
 * space gives access control, not trust — another member's client could write anything
 * into their own repo, and it arrives here.
 */
export function validateNote(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObject(value)) return { ok: false, errors: ['record must be an object'] };

  if (value.$type !== undefined && value.$type !== NOTE_COLLECTION) {
    errors.push(`$type must be ${NOTE_COLLECTION}`);
  }

  const { text } = value;
  if (typeof text !== 'string' || text.length === 0) {
    errors.push('text is required');
  } else {
    if (text.length > LIMITS.textMaxLength) {
      errors.push(`text must be at most ${LIMITS.textMaxLength} bytes`);
    }
    if (countGraphemes(text) > LIMITS.textMaxGraphemes) {
      errors.push(`text must be at most ${LIMITS.textMaxGraphemes} characters`);
    }
  }

  const location = validateLocation(value.location, errors);

  if (value.rating !== undefined) {
    const r = value.rating;
    if (typeof r !== 'number' || !Number.isInteger(r)) {
      errors.push('rating must be a whole number');
    } else if (r < LIMITS.ratingMin || r > LIMITS.ratingMax) {
      errors.push(`rating must be between ${LIMITS.ratingMin} and ${LIMITS.ratingMax}`);
    }
  }

  if (value.tags !== undefined) {
    if (!Array.isArray(value.tags)) {
      errors.push('tags must be an array');
    } else {
      if (value.tags.length > LIMITS.tagsMaxLength) {
        errors.push(`at most ${LIMITS.tagsMaxLength} tags`);
      }
      for (const tag of value.tags) {
        if (typeof tag !== 'string' || tag.length === 0) {
          errors.push('each tag must be a non-empty string');
        } else if (
          tag.length > LIMITS.tagMaxLength ||
          countGraphemes(tag) > LIMITS.tagMaxGraphemes
        ) {
          errors.push(`tag "${tag}" is too long`);
        }
      }
    }
  }

  if (value.place !== undefined) validatePlace(value.place, errors);

  if (typeof value.createdAt !== 'string' || Number.isNaN(Date.parse(value.createdAt))) {
    errors.push('createdAt must be an ISO datetime');
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, record: { ...(value as unknown as NoteRecord), location: location! } };
}

function validateLocation(value: unknown, errors: string[]): GeoLocation | null {
  if (!isObject(value)) {
    errors.push('location is required');
    return null;
  }
  const { latitude, longitude } = value;
  if (typeof latitude !== 'string' || parseLatitude(latitude) === null) {
    errors.push('location.latitude must be a decimal string within ±90');
  }
  if (typeof longitude !== 'string' || parseLongitude(longitude) === null) {
    errors.push('location.longitude must be a decimal string within ±180');
  }
  return errors.length === 0 ? (value as unknown as GeoLocation) : null;
}

function validatePlace(value: unknown, errors: string[]): void {
  if (!isObject(value)) {
    errors.push('place must be an object');
    return;
  }
  if (!OSM_TYPES.includes(value.osmType as (typeof OSM_TYPES)[number])) {
    errors.push(`place.osmType must be one of ${OSM_TYPES.join(', ')}`);
  }
  // Kept as a string on purpose: OSM ids are already past 2^32 and a JSON number
  // would eventually lose precision at 2^53.
  if (typeof value.osmId !== 'string' || !/^\d+$/.test(value.osmId)) {
    errors.push('place.osmId must be a digit string');
  }
  if (value.name !== undefined) {
    if (typeof value.name !== 'string' || value.name.length > LIMITS.placeNameMaxLength) {
      errors.push('place.name is too long');
    }
  }
  if (value.category !== undefined) {
    if (
      typeof value.category !== 'string' ||
      value.category.length > LIMITS.placeCategoryMaxLength
    ) {
      errors.push('place.category is too long');
    }
  }
}

/** Stable key for grouping notes about the same OSM feature. */
export function placeKey(place: Pick<OsmPlace, 'osmType' | 'osmId'>): string {
  return `${place.osmType}/${place.osmId}`;
}

export interface BuildNoteInput {
  text: string;
  lat: number;
  lng: number;
  place?: OsmPlace;
  rating?: number;
  tags?: string[];
  locationName?: string;
  createdAt?: Date;
}

/** Construct a note record ready to write. Does not validate — call validateNote. */
export function buildNote(input: BuildNoteInput): NoteRecord {
  const location: GeoLocation = {
    $type: 'community.lexicon.location.geo',
    latitude: formatCoord(input.lat),
    longitude: formatCoord(input.lng),
  };
  if (input.locationName) location.name = input.locationName;

  const record: NoteRecord = {
    $type: NOTE_COLLECTION,
    text: input.text,
    location,
    createdAt: (input.createdAt ?? new Date()).toISOString(),
  };
  if (input.place) record.place = input.place;
  if (input.rating !== undefined) record.rating = input.rating;
  if (input.tags && input.tags.length > 0) record.tags = input.tags;
  return record;
}

/**
 * Turn a validated record plus its repo coordinates into the shape the map uses.
 * Returns null if the record is invalid, so a bad record from any member is skipped
 * rather than breaking the whole sync.
 */
export function toNote(
  uri: string,
  cid: string,
  author: string,
  value: unknown,
): Note | null {
  const result = validateNote(value);
  if (!result.ok) return null;
  const record = result.record;
  const lat = parseLatitude(record.location.latitude);
  const lng = parseLongitude(record.location.longitude);
  if (lat === null || lng === null) return null;

  const note: Note = {
    uri,
    cid,
    author,
    record,
    lat,
    lng,
    createdAtMs: Date.parse(record.createdAt),
  };
  if (record.place) note.placeKey = placeKey(record.place);
  return note;
}
