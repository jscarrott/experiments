import { inBbox, normaliseBbox, type Bbox } from './geo.js';
import type { Note, PlaceGroup } from './types.js';

/**
 * The whole "index". At family scale — tens of members, hundreds to low thousands of
 * notes — a filter over an array is the right data structure, and it is why this app
 * needs no AppView, no SQLite and no spatial index: the browser holds the lot.
 *
 * If a space ever grew past the point where this is fast enough, the fix is a real
 * index behind the same functions, not a different UI.
 */
export interface NoteFilter {
  bbox?: Bbox;
  /** DIDs to include. Undefined or empty means everyone. */
  authors?: string[];
  /** Only notes carrying a rating — i.e. reviews. */
  ratedOnly?: boolean;
  /** Notes must carry every tag listed. */
  tags?: string[];
  /** Case-insensitive substring of the note text or the place name. */
  search?: string;
}

export function filterNotes(notes: readonly Note[], filter: NoteFilter = {}): Note[] {
  const box = filter.bbox ? normaliseBbox(filter.bbox) : null;
  const authors = filter.authors?.length ? new Set(filter.authors) : null;
  const tags = filter.tags?.length ? filter.tags.map((t) => t.toLowerCase()) : null;
  const search = filter.search?.trim().toLowerCase() || null;

  return notes.filter((note) => {
    if (box && !inBbox(note.lat, note.lng, box)) return false;
    if (authors && !authors.has(note.author)) return false;
    if (filter.ratedOnly && note.record.rating === undefined) return false;
    if (tags) {
      const noteTags = (note.record.tags ?? []).map((t) => t.toLowerCase());
      if (!tags.every((t) => noteTags.includes(t))) return false;
    }
    if (search) {
      const haystack = `${note.record.text} ${note.record.place?.name ?? ''}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

/** Newest first. */
export function sortByNewest(notes: readonly Note[]): Note[] {
  return [...notes].sort((a, b) => b.createdAtMs - a.createdAtMs || a.uri.localeCompare(b.uri));
}

/**
 * Gather notes onto the businesses they are about.
 *
 * This is the point of storing a stable OSM id rather than just a coordinate: two
 * people writing about the same café, having tapped it on different days from
 * slightly different spots, end up on one place page.
 *
 * The group's coordinate is the mean of its notes' coordinates rather than any one
 * note's, so a group doesn't jump around depending on which note was written first.
 */
export function groupByPlace(notes: readonly Note[]): PlaceGroup[] {
  const groups = new Map<string, PlaceGroup>();

  for (const note of notes) {
    if (!note.placeKey || !note.record.place) continue;
    let group = groups.get(note.placeKey);
    if (!group) {
      group = {
        key: note.placeKey,
        place: note.record.place,
        notes: [],
        lat: 0,
        lng: 0,
        ratingCount: 0,
      };
      groups.set(note.placeKey, group);
    }
    group.notes.push(note);
    // Prefer a name over none: an older note may predate the name being known.
    if (!group.place.name && note.record.place.name) group.place = note.record.place;
  }

  for (const group of groups.values()) {
    group.lat = mean(group.notes.map((n) => n.lat));
    group.lng = mean(group.notes.map((n) => n.lng));
    const ratings = group.notes
      .map((n) => n.record.rating)
      .filter((r): r is number => typeof r === 'number');
    group.ratingCount = ratings.length;
    if (ratings.length > 0) group.averageRating = mean(ratings);
    group.notes = sortByNewest(group.notes);
  }

  return [...groups.values()].sort((a, b) => b.notes.length - a.notes.length);
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Every tag in use, most used first — for the filter UI. */
export function tagCounts(notes: readonly Note[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const note of notes) {
    for (const tag of note.record.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Every author who has written a note, with their count — for the filter sidebar. */
export function authorCounts(notes: readonly Note[]): { did: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const note of notes) counts.set(note.author, (counts.get(note.author) ?? 0) + 1);
  return [...counts.entries()]
    .map(([did, count]) => ({ did, count }))
    .sort((a, b) => b.count - a.count || a.did.localeCompare(b.did));
}
