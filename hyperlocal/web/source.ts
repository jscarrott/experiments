import type { Note, NoteRecord } from '../shared/types.js';

/**
 * Everything the UI needs from the data layer, so the map, filters and compose form
 * do not know or care whether they are talking to a real space.
 *
 * Two implementations: `SpaceSource` against a PDS, and `DemoSource` against browser
 * storage. The demo one is not a toy — it is what makes the app explorable without an
 * account on a spaces-capable PDS, and what makes the end-to-end tests deterministic
 * and offline.
 */
export interface NoteSource {
  /** Short label shown in the header, e.g. a handle or "demo". */
  readonly label: string;
  /** The signed-in user's DID, or null in demo mode. */
  readonly viewer: string | null;
  /** True when writes go to a real repo. */
  readonly live: boolean;

  load(): Promise<Note[]>;
  create(record: NoteRecord): Promise<Note>;
  remove(note: Note): Promise<void>;
}

/** Resolved display names for DIDs, best effort — a DID is unreadable in a sidebar. */
export interface HandleResolver {
  handleFor(did: string): string;
}
