import { buildNote, toNote } from '../shared/note.js';
import { NOTE_COLLECTION } from '../shared/nsid.js';
import type { Note, NoteRecord } from '../shared/types.js';
import type { NoteSource } from './source.js';

const STORAGE_KEY = 'hyperlocal.demo.notes';

/**
 * Fixture notes, so the map has something on it before anyone signs in.
 *
 * The businesses are invented rather than real ones. Seeding a demo with fabricated
 * opinions about actual named premises would be putting made-up reviews of real
 * traders into the world, which is not a thing to do casually even in a fixture.
 * The coordinates are real streets in central Bristol so the map looks like a place.
 */
const DEMO_AUTHORS = {
  alice: 'did:plc:demo-alice',
  bob: 'did:plc:demo-bob',
  chris: 'did:plc:demo-chris',
} as const;

export const DEMO_HANDLES: Record<string, string> = {
  [DEMO_AUTHORS.alice]: 'alice.demo',
  [DEMO_AUTHORS.bob]: 'bob.demo',
  [DEMO_AUTHORS.chris]: 'chris.demo',
};

interface Seed {
  author: string;
  text: string;
  lat: number;
  lng: number;
  rating?: number;
  tags?: string[];
  place?: { osmType: 'node' | 'way'; osmId: string; name: string; category: string };
  daysAgo: number;
}

const granary = { osmType: 'node' as const, osmId: '900000001', name: 'The Granary Rooms', category: 'amenity=cafe' };
const anchor = { osmType: 'way' as const, osmId: '900000002', name: 'The Old Anchor', category: 'amenity=pub' };
const bakery = { osmType: 'node' as const, osmId: '900000003', name: 'Bridge Street Bakehouse', category: 'shop=bakery' };

const SEEDS: Seed[] = [
  { author: DEMO_AUTHORS.alice, text: 'Good coffee, bad food. Get a pastry from the bakehouse first and just have the flat white here.', lat: 51.4529, lng: -2.5975, rating: 4, tags: ['coffee'], place: granary, daysAgo: 3 },
  { author: DEMO_AUTHORS.bob, text: 'Agree on the coffee. Wifi is unusable after about 4pm though, too many people.', lat: 51.4529, lng: -2.5976, rating: 3, tags: ['coffee', 'wifi'], place: granary, daysAgo: 1 },
  { author: DEMO_AUTHORS.chris, text: 'Sunday roast is genuinely excellent, but book — we got turned away twice.', lat: 51.4541, lng: -2.5951, rating: 5, tags: ['dinner'], place: anchor, daysAgo: 12 },
  { author: DEMO_AUTHORS.alice, text: 'Went back. Still excellent. The pie is better than the roast.', lat: 51.4541, lng: -2.5952, rating: 5, tags: ['dinner'], place: anchor, daysAgo: 5 },
  { author: DEMO_AUTHORS.bob, text: 'Sourdough sells out by 10am on a Saturday. Weekdays are fine.', lat: 51.4515, lng: -2.5993, rating: 4, tags: ['bread'], place: bakery, daysAgo: 20 },
  { author: DEMO_AUTHORS.chris, text: 'Bench here gets the sun until about six. Good spot to wait for the ferry.', lat: 51.4496, lng: -2.6008, tags: ['outdoors'], daysAgo: 8 },
  { author: DEMO_AUTHORS.alice, text: 'Car park machine only takes coins and there is no signal to use the app. Bring change.', lat: 51.4552, lng: -2.6021, rating: 1, tags: ['parking'], daysAgo: 30 },
];

function seedNotes(): Note[] {
  const now = Date.now();
  const notes: Note[] = [];
  SEEDS.forEach((seed, i) => {
    const record = buildNote({
      text: seed.text,
      lat: seed.lat,
      lng: seed.lng,
      rating: seed.rating,
      tags: seed.tags,
      place: seed.place,
      createdAt: new Date(now - seed.daysAgo * 86_400_000),
    });
    const note = toNote(`at://${seed.author}/${NOTE_COLLECTION}/demo${i}`, `demo${i}`, seed.author, record);
    if (note) notes.push(note);
  });
  return notes;
}

interface StoredNote {
  uri: string;
  cid: string;
  author: string;
  record: NoteRecord;
}

/**
 * The app running against browser storage instead of a space.
 *
 * This is what you get before signing in. It is also what the end-to-end tests run
 * against, which is why it is a real implementation of the same interface rather than
 * a mock: the tests then exercise the actual filtering, grouping and compose code.
 */
export class DemoSource implements NoteSource {
  readonly label = 'demo';
  readonly viewer = DEMO_AUTHORS.alice;
  readonly live = false;

  async load(): Promise<Note[]> {
    const stored = this.read();
    if (stored === null) {
      const seeded = seedNotes();
      this.write(seeded);
      return seeded;
    }
    return stored;
  }

  async create(record: NoteRecord): Promise<Note> {
    const rkey = `local${Date.now().toString(36)}`;
    const note = toNote(`at://${this.viewer}/${NOTE_COLLECTION}/${rkey}`, rkey, this.viewer, record);
    if (!note) throw new Error('note did not validate');
    this.write([...((await this.load()) ?? []), note]);
    return note;
  }

  async remove(note: Note): Promise<void> {
    this.write((await this.load()).filter((n) => n.uri !== note.uri));
  }

  /** Throw the demo data away and start again. */
  reset(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Private browsing, or storage disabled. Nothing to clear.
    }
  }

  private read(): Note[] | null {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {
      return null; // Storage unavailable: fall back to a fresh seed each load.
    }
    if (!raw) return null;
    try {
      const stored = JSON.parse(raw) as StoredNote[];
      return stored
        .map((s) => toNote(s.uri, s.cid, s.author, s.record))
        .filter((n): n is Note => n !== null);
    } catch {
      return null;
    }
  }

  private write(notes: Note[]): void {
    const stored: StoredNote[] = notes.map(({ uri, cid, author, record }) => ({
      uri,
      cid,
      author,
      record,
    }));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // Over quota or blocked; the notes stay in memory for this session.
    }
  }
}
