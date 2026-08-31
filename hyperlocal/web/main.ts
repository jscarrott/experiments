import { NOTE_COLLECTION, SPACE_KEY, SPACE_TYPE, spaceRef } from '../shared/nsid.js';
import { buildNote, validateNote } from '../shared/note.js';
import type { Note, PlaceCandidate } from '../shared/types.js';
import { initAuth, signIn } from './auth.js';
import { DemoSource, DEMO_HANDLES } from './demo.js';
import { fill, h, mustFind } from './dom.js';
import { NoteMap } from './map.js';
import { mountMembers } from './members.js';
import { nearbyPlaces } from './places-api.js';
import type { NoteSource } from './source.js';
import {
  createSpace,
  mintSpaceCredential,
  resolveHandle,
  resolvePds,
  SpaceSource,
  type UserSession,
} from './space.js';
import { boundsToBbox, filterFromQuery, filterToQuery, Store } from './state.js';
import {
  renderCompose,
  renderFilters,
  renderList,
  type ComposeDraft,
  type ViewerInfo,
} from './ui.js';

const DEFAULT_CENTRE: [number, number] = [-2.5975, 51.4529];
const DEFAULT_ZOOM = 15;

const store = new Store();
let source: NoteSource = new DemoSource();
let draft: ComposeDraft | null = null;
let noteMap: NoteMap;
let inviteLink: string | null = null;

/** DID → handle, filled in as we learn them. A DID in a sidebar is unreadable. */
const handles = new Map<string, string>(Object.entries(DEMO_HANDLES));

const viewer: ViewerInfo = {
  get did() {
    return source.viewer;
  },
  handleFor(did) {
    return handles.get(did) ?? shortDid(did);
  },
};

function shortDid(did: string): string {
  return did.length > 22 ? `${did.slice(0, 12)}…${did.slice(-6)}` : did;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const handlers = {
  toggleAuthor(did: string) {
    const current = new Set(store.current.filter.authors ?? []);
    current.has(did) ? current.delete(did) : current.add(did);
    store.setFilter({ authors: [...current] });
    syncUrl();
  },
  toggleTag(tag: string) {
    const current = new Set(store.current.filter.tags ?? []);
    current.has(tag) ? current.delete(tag) : current.add(tag);
    store.setFilter({ tags: [...current] });
    syncUrl();
  },
  setRatedOnly(value: boolean) {
    store.setFilter({ ratedOnly: value });
    syncUrl();
  },
  setSearch(value: string) {
    store.setFilter({ search: value });
    syncUrl();
  },
  openPlace(key: string | null) {
    store.update({ openPlace: key });
  },
  focusNote(note: Note) {
    noteMap.flyTo(note.lat, note.lng);
  },
  async deleteNote(note: Note) {
    if (!confirm('Delete this note?')) return;
    try {
      await source.remove(note);
      store.removeNote(note.uri);
    } catch (error) {
      store.update({ error: `Could not delete: ${(error as Error).message}` });
    }
  },
  startCompose() {
    const centre = noteMap.centre;
    void openCompose(centre.lat, centre.lng, null);
  },
};

function syncUrl(): void {
  const query = filterToQuery(store.current.filter);
  const url = new URL(window.location.href);
  url.search = query;
  history.replaceState(null, '', url.toString());
}

store.subscribe((state, derived) => {
  renderFilters(mustFind('#filters'), state, derived, viewer, handlers);
  renderList(mustFind('#list'), state, derived, viewer, handlers);
  if (noteMap) noteMap.render(derived.visible, derived.groups);

  const banner = mustFind('#error');
  banner.hidden = state.error === null;
  banner.textContent = state.error ?? '';
});

// ---------------------------------------------------------------------------
// Compose
// ---------------------------------------------------------------------------

function drawCompose(): void {
  renderCompose(mustFind('#compose'), draft, {
    choosePlace(candidate) {
      if (draft) {
        draft.place = candidate;
        drawCompose();
      }
    },
    change(patch) {
      if (draft) {
        Object.assign(draft, patch);
        // Re-rendering on every keystroke would fight the textarea's cursor; only the
        // controls that change appearance need a redraw.
        if ('text' in patch || 'tags' in patch) return;
        drawCompose();
      }
    },
    submit: () => void saveDraft(),
    cancel() {
      draft = null;
      drawCompose();
    },
  });
}

async function openCompose(lat: number, lng: number, picked: PlaceCandidate | null): Promise<void> {
  draft = {
    lat,
    lng,
    text: '',
    tags: '',
    place: picked,
    candidates: picked ? [picked] : [],
    degraded: false,
    loadingPlaces: true,
    error: null,
    saving: false,
  };
  drawCompose();

  // The one and only Overpass call: when someone has actually chosen a spot. Never on
  // pan or zoom, which would burn the public instance's daily budget in a minute.
  const lookup = await nearbyPlaces(lat, lng);
  if (!draft || draft.lat !== lat || draft.lng !== lng) return; // moved on already

  draft.loadingPlaces = false;
  draft.degraded = lookup.degraded;
  draft.candidates = lookup.candidates;

  // A tile pick gives a name but no id; the matching Overpass candidate gives the id.
  if (picked?.name) {
    const matched = lookup.candidates.find((c) => c.name === picked.name);
    draft.place = matched ?? (lookup.candidates[0] ?? null);
  } else {
    draft.place = lookup.candidates[0] ?? null;
  }
  drawCompose();
}

async function saveDraft(): Promise<void> {
  if (!draft || draft.saving) return;

  const record = buildNote({
    text: draft.text.trim(),
    lat: draft.place?.lat ?? draft.lat,
    lng: draft.place?.lng ?? draft.lng,
    rating: draft.rating,
    tags: draft.tags.split(',').map((t) => t.trim()).filter(Boolean),
    place:
      draft.place?.osmType && draft.place.osmId
        ? {
            osmType: draft.place.osmType,
            osmId: draft.place.osmId,
            name: draft.place.name,
            category: draft.place.category,
          }
        : undefined,
  });

  // The same validator the sync path runs, so a note that would be rejected on the way
  // back in is rejected before it is written.
  const check = validateNote(record);
  if (!check.ok) {
    draft.error = check.errors[0];
    drawCompose();
    return;
  }

  draft.saving = true;
  draft.error = null;
  drawCompose();

  try {
    const note = await source.create(record);
    store.addNote(note);
    draft = null;
    drawCompose();
  } catch (error) {
    if (draft) {
      draft.saving = false;
      draft.error = (error as Error).message;
      drawCompose();
    }
  }
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

function renderAccount(label: string, live: boolean, onSignIn: (handle: string) => void, spaceLink: string | null): void {
  const el = mustFind('#account');
  if (live) {
    fill(el,
      h('span', { class: 'account__handle', 'data-testid': 'account', text: label }),
      spaceLink &&
        h('button', {
          type: 'button',
          class: 'link',
          title: 'Copy an invite link for this space',
          onclick: () => void navigator.clipboard?.writeText(spaceLink),
          text: 'Copy invite link',
        }),
    );
    return;
  }

  const input = h('input', {
    class: 'input input--inline',
    placeholder: 'you.bsky.social',
    'data-testid': 'handle',
  });
  fill(el,
    h('span', { class: 'badge', 'data-testid': 'demo-badge', text: 'demo data' }),
    input,
    h('button', {
      type: 'button',
      class: 'button button--small',
      'data-testid': 'sign-in',
      onclick: () => onSignIn(input.value),
      text: 'Sign in',
    }),
  );
}

async function start(): Promise<void> {
  noteMap = new NoteMap(
    mustFind('#map'),
    {
      onMoveEnd() {
        store.setFilter({ bbox: boundsToBbox(noteMap.map.getBounds()) });
      },
      onPick(point, candidate) {
        void openCompose(point.lat, point.lng, candidate);
      },
      onNoteClick(uri) {
        const note = store.current.notes.find((n) => n.uri === uri);
        if (note) handlers.focusNote(note);
      },
      onPlaceClick(key) {
        handlers.openPlace(key);
      },
    },
    DEFAULT_CENTRE,
    DEFAULT_ZOOM,
  );

  store.update({ filter: filterFromQuery(window.location.search) });
  mustFind('#add-note').addEventListener('click', () => handlers.startCompose());

  let auth: Awaited<ReturnType<typeof initAuth>> | null = null;
  try {
    auth = await initAuth();
  } catch (error) {
    // A broken OAuth setup should not cost you the map; demo mode still works.
    console.warn('[auth] unavailable', error);
  }

  const onSignIn = (handle: string) => {
    if (!auth || !handle.trim()) return;
    void signIn(auth.client, handle).catch((error) =>
      store.update({ error: `Sign in failed: ${(error as Error).message}` }),
    );
  };

  if (auth?.session) {
    const session = auth.session as unknown as UserSession;
    try {
      const context = await connectSpace(session);
      source = context.source;
      // The invite link has to name the owner explicitly: a space is anchored on its
      // owner's DID, so without this a guest would open their own empty space instead.
      inviteLink = `${window.location.origin}/?owner=${encodeURIComponent(context.ownerDid)}`;
      mountMembers(mustFind('#members'), {
        session,
        authorityPds: context.ownerPds,
        space: context.space,
        isOwner: context.ownerDid === session.did,
        onChange(dids) {
          // Members who have never written do not appear in the notes, so the member
          // list is the only place their DID is known at all.
          for (const did of dids) if (!handles.has(did)) handles.set(did, shortDid(did));
        },
      });
    } catch (error) {
      store.update({ error: `Could not open the space: ${(error as Error).message}` });
      source = new DemoSource();
    }
  }

  renderAccount(source.label, source.live, onSignIn, inviteLink);

  try {
    const notes = await source.load();
    store.update({ notes, loading: false });
  } catch (error) {
    store.update({ loading: false, error: `Could not load notes: ${(error as Error).message}` });
  }
}

/**
 * Open the space to show.
 *
 * `?owner=` names whose space it is — that is what an invite link carries, because a
 * space is anchored on its owner's DID and a member is reading someone else's. With no
 * owner given, it is your own.
 */
interface SpaceContext {
  source: NoteSource;
  space: string;
  ownerDid: string;
  ownerPds: string;
}

async function connectSpace(session: UserSession): Promise<SpaceContext> {
  const params = new URLSearchParams(window.location.search);
  const ownerParam = params.get('owner');
  const userPds = await resolvePds(session.did);

  const ownerDid = ownerParam
    ? ownerParam.startsWith('did:')
      ? ownerParam
      : await resolveHandle(ownerParam, userPds)
    : session.did;

  handles.set(session.did, ownerParam && ownerDid !== session.did ? shortDid(session.did) : session.did);

  const space = spaceRef(ownerDid);
  const ownerPds = ownerDid === session.did ? userPds : await resolvePds(ownerDid);

  const connect = async (): Promise<SpaceContext> => ({
    source: new SpaceSource(
      session.did,
      session.did,
      session,
      await mintSpaceCredential(session, space, resolvePds),
      ownerPds,
      space,
      userPds,
    ),
    space,
    ownerDid,
    ownerPds,
  });

  try {
    return await connect();
  } catch (error) {
    // The most likely first-run failure is simply that you have never made your space.
    if (ownerDid !== session.did) throw error;
    console.info('[space] no space yet, creating one', error);
    await createSpace(session, userPds, SPACE_TYPE, SPACE_KEY);
    return connect();
  }
}

void start();

// Referenced so the collection name is not tree-shaken out of the bundle's constants
// during a `vite build --minify`, and to make the value obvious in devtools.
Object.assign(window as unknown as Record<string, unknown>, { HYPERLOCAL_COLLECTION: NOTE_COLLECTION });
