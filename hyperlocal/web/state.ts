import { filterNotes, groupByPlace, sortByNewest, tagCounts, authorCounts } from '../shared/query.js';
import type { Bbox } from '../shared/geo.js';
import type { Note, PlaceGroup } from '../shared/types.js';
import type { NoteFilter } from '../shared/query.js';

export interface AppState {
  notes: Note[];
  filter: NoteFilter;
  /** The place page currently open, by `type/id`. */
  openPlace: string | null;
  loading: boolean;
  error: string | null;
  /** Technical text behind `error`, shown folded away. Useless to most people, and the
   *  only thing worth having when something needs reporting. */
  errorDetail: string | null;
}

export interface DerivedState {
  /** Notes matching every filter, newest first. */
  visible: Note[];
  /** Notes matching everything except the bbox — what the sidebar counts from, so
   * the author list does not flicker as you pan. */
  matchingAnywhere: Note[];
  groups: PlaceGroup[];
  tags: { tag: string; count: number }[];
  authors: { did: string; count: number }[];
}

type Listener = (state: AppState, derived: DerivedState) => void;

/**
 * The whole application state, recomputed wholesale on every change.
 *
 * Recomputing rather than patching means the map, the sidebar counts and the place
 * pages cannot disagree with each other. At family scale the recompute is a couple of
 * passes over an array of a few hundred objects, which is far below anything a person
 * can perceive.
 */
export class Store {
  private state: AppState = {
    notes: [],
    filter: {},
    openPlace: null,
    loading: true,
    error: null,
    errorDetail: null,
  };
  private listeners = new Set<Listener>();

  get current(): AppState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state, this.derive());
    return () => this.listeners.delete(listener);
  }

  update(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    const derived = this.derive();
    for (const listener of this.listeners) listener(this.state, derived);
  }

  setFilter(patch: Partial<NoteFilter>): void {
    this.update({ filter: { ...this.state.filter, ...patch } });
  }

  addNote(note: Note): void {
    this.update({ notes: [...this.state.notes, note] });
  }

  removeNote(uri: string): void {
    this.update({ notes: this.state.notes.filter((n) => n.uri !== uri) });
  }

  private derive(): DerivedState {
    const { notes, filter } = this.state;
    // The bbox is deliberately excluded from the sidebar's view of the world: an
    // author disappearing from the filter list because you panned away from their
    // only note makes the list unusable.
    const { bbox, ...withoutBbox } = filter;
    const matchingAnywhere = filterNotes(notes, withoutBbox);
    const visible = sortByNewest(bbox ? filterNotes(matchingAnywhere, { bbox }) : matchingAnywhere);

    return {
      visible,
      matchingAnywhere,
      groups: groupByPlace(visible),
      tags: tagCounts(notes),
      authors: authorCounts(notes),
    };
  }
}

/** Serialise the filter into the URL, so a filtered view can be sent to someone. */
export function filterToQuery(filter: NoteFilter): string {
  const params = new URLSearchParams();
  if (filter.authors?.length) params.set('authors', filter.authors.join(','));
  if (filter.tags?.length) params.set('tags', filter.tags.join(','));
  if (filter.ratedOnly) params.set('rated', '1');
  if (filter.search) params.set('q', filter.search);
  return params.toString();
}

export function filterFromQuery(query: string): NoteFilter {
  const params = new URLSearchParams(query);
  const filter: NoteFilter = {};
  const authors = params.get('authors');
  if (authors) filter.authors = authors.split(',').filter(Boolean);
  const tags = params.get('tags');
  if (tags) filter.tags = tags.split(',').filter(Boolean);
  if (params.get('rated') === '1') filter.ratedOnly = true;
  const search = params.get('q');
  if (search) filter.search = search;
  return filter;
}

/** Convenience for map code, which thinks in MapLibre bounds. */
export function boundsToBbox(b: {
  getWest(): number;
  getSouth(): number;
  getEast(): number;
  getNorth(): number;
}): Bbox {
  return { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
}
