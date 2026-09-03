import { NOTE_COLLECTION, SPACE_KEY, SPACE_TYPE, spaceRef } from '../shared/nsid.js';
import { buildNote, validateNote } from '../shared/note.js';
import type { Note, PlaceCandidate } from '../shared/types.js';
import { initAuth, signIn } from './auth.js';
import { DemoSource, DEMO_HANDLES } from './demo.js';
import { fill, h, mustFind } from './dom.js';
import { explainSignInFailure, explainSpaceFailure, type Explained } from './errors.js';
import { NoteMap } from './map.js';
import { mountMembers } from './members.js';
import { nearbyPlaces } from './places-api.js';
import type { NoteSource } from './source.js';
import {
  createSpace,
  mintSpaceCredential,
  resolveDidHandle,
  resolveHandle,
  resolvePds,
  SpaceSource,
  type UserSession,
} from './space.js';
import { boundsToBbox, filterFromQuery, filterToQuery, Store, type AppState } from './state.js';
import {
  renderCompose,
  renderFilters,
  renderList,
  renderMapKey,
  type ComposeDraft,
  type ViewerInfo,
} from './ui.js';
import { XrpcError } from './xrpc.js';

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

/**
 * Fill in handles for DIDs we have not named yet, then repaint.
 *
 * Deliberately fire-and-forget: every one of these is a DID document fetch plus a
 * verifying handle lookup, and none of it should hold up drawing the notes. Names
 * appearing a moment after the map is the right trade — waiting on them means a blank
 * sidebar while `plc.directory` thinks about it.
 */
function learnHandles(dids: Iterable<string>, service: string): void {
  const wanted = [...new Set(dids)].filter((did) => !handles.has(did));
  if (wanted.length === 0) return;
  void Promise.all(
    wanted.map(async (did) => {
      const handle = await resolveDidHandle(did, service);
      handles.set(did, handle ?? shortDid(did));
    }),
  ).then(() => store.update({}));
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
      report({ headline: 'Could not delete that note.', detail: (error as Error).message });
    }
  },
  startCompose() {
    const centre = noteMap.centre;
    void openCompose(centre.lat, centre.lng, null);
  },
};

/**
 * The two floating panels a phone gets instead of side-by-side sidebars.
 *
 * State lives in data attributes on the workspace so the CSS owns every transition and
 * this only has to flip a string. On a desktop the media query never matches, the
 * controls are `display: none`, and none of it does anything.
 */
function setPanel(name: 'filters' | 'sheet', open: boolean): void {
  const workspace = mustFind('#workspace');
  const toggle = mustFind(name === 'filters' ? '#toggle-filters' : '#sheet-handle');
  workspace.dataset[name] = open ? 'open' : 'closed';
  toggle.setAttribute('aria-expanded', String(open));
}

function isPanelOpen(name: 'filters' | 'sheet'): boolean {
  return mustFind('#workspace').dataset[name] === 'open';
}

function wirePhoneLayout(): void {
  setPanel('filters', false);
  setPanel('sheet', false);

  mustFind('#toggle-filters').addEventListener('click', () =>
    setPanel('filters', !isPanelOpen('filters')),
  );
  mustFind('#sheet-handle').addEventListener('click', () =>
    setPanel('sheet', !isPanelOpen('sheet')),
  );
  mustFind('#scrim').addEventListener('click', () => setPanel('filters', false));

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (isPanelOpen('filters')) setPanel('filters', false);
    else if (isPanelOpen('sheet')) setPanel('sheet', false);
  });
}

function report(explained: Explained, extra: Partial<AppState> = {}): void {
  store.update({ error: explained.headline, errorDetail: explained.detail ?? null, ...extra });
}

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
  if (state.error !== null) {
    fill(banner,
      h('span', { class: 'error__text', text: state.error }),
      // Folded away rather than omitted: nobody wants to read `BadJwt: Invalid delegation
      // token` on their way to writing a note, and it is the only thing worth pasting
      // into a bug report.
      state.errorDetail &&
        h('details', { class: 'error__detail' },
          h('summary', { text: 'Details' }),
          h('code', { text: state.errorDetail }),
        ),
    );
  }

  // Closed, the sheet is only its handle, so the handle has to carry the information the
  // list would have shown — otherwise a phone gives no hint that there is anything there.
  const count = derived.visible.length;
  mustFind('#sheet-label').textContent = state.loading
    ? 'Loading…'
    : count === 0
      ? 'No notes in view'
      : `${count} note${count === 1 ? '' : 's'} in view`;
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
  // Compose lives inside the sheet, so on a phone it would otherwise open below the fold
  // — you would tap the map and appear to get nothing. Also close the filter panel,
  // which covers the map you just picked a point on.
  setPanel('sheet', true);
  setPanel('filters', false);

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

/**
 * The three states this can be in, which used to be two.
 *
 * Signed in with a broken space used to render as signed out: you had authorised the app,
 * the error banner said something about DPoP, and the toolbar offered to sign you in
 * again — which does nothing, because you already are. It now says who you are, and
 * offers the way out.
 */
function renderAccount(
  label: string,
  live: boolean,
  onSignIn: (handle: string) => void,
  spaceLink: string | null,
  broken: { handle: string; onSignOut: () => void } | null = null,
): void {
  const el = mustFind('#account');

  if (!live && broken) {
    fill(el,
      h('span', { class: 'badge badge--warn', 'data-testid': 'demo-badge', text: 'showing demo data' }),
      h('span', { class: 'account__handle', 'data-testid': 'account', text: broken.handle }),
      h('button', {
        type: 'button',
        class: 'link',
        'data-testid': 'retry',
        onclick: () => window.location.reload(),
        text: 'Try again',
      }),
      h('button', {
        type: 'button',
        class: 'link',
        'data-testid': 'sign-out',
        onclick: broken.onSignOut,
        text: 'Sign out',
      }),
    );
    return;
  }

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

  // Not `you.bsky.social`: bsky.social has no spaces support, so the one hint the app
  // gave was for an account that cannot possibly work here.
  const input = h('input', {
    class: 'input input--inline',
    placeholder: 'you.example.com',
    title: 'Your handle on a PDS running the atproto spaces alpha',
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
  wirePhoneLayout();
  renderMapKey(mustFind('#map-key'));

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
      report(explainSignInFailure(error)),
    );
  };

  // Any PDS can answer resolveHandle, so the space's own host is as good as anywhere and
  // is already known to be reachable. Null in demo mode, where handles are fixtures.
  let handleService: string | null = null;
  // Set only in the awkward middle state: authorised, but the space would not open.
  let broken: { handle: string; onSignOut: () => void } | null = null;

  if (auth?.session) {
    // Adapt OAuthSession to UserSession explicitly rather than casting. `fetchHandler`
    // is a prototype method that reads `this.getTokenSet()`, so handing over a bare
    // reference to it loses `this` and every space call dies on "can't access property
    // getTokenSet". The structural interface cannot catch that — a method satisfies the
    // shape whether or not it is bound — so the binding has to be deliberate here.
    // pdsUrl is left out because OAuthSession has none; space.ts resolves it from the DID.
    const oauth = auth.session;
    const session: UserSession = {
      did: oauth.did,
      serverMetadata: oauth.serverMetadata,
      fetchHandler: (input, init) => oauth.fetchHandler(input.toString(), init),
    };
    try {
      const context = await connectSpace(session);
      source = context.source;
      handleService = context.ownerPds;
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
          learnHandles(dids, context.ownerPds);
        },
      });
    } catch (error) {
      report(explainSpaceFailure(error));
      // Falling back to the fixtures keeps the map and the filters usable, but it must
      // not read as your own data — hence `broken` below, which says whose account this
      // is and that what you are looking at is not theirs.
      source = new DemoSource();
      broken = {
        handle: handles.get(session.did) ?? shortDid(session.did),
        onSignOut: () => {
          void oauth.signOut().finally(() => window.location.reload());
        },
      };
    }
  }

  renderAccount(source.label, source.live, onSignIn, inviteLink, broken);

  try {
    const notes = await source.load();
    // Authors who are not in the member list — someone since removed, say — still have
    // notes on the map, and a DID in the sidebar is unreadable.
    if (handleService) learnHandles(notes.map((n) => n.author), handleService);
    store.update({ notes, loading: false });
  } catch (error) {
    report(explainSpaceFailure(error), { loading: false });
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

  // Your own name is worth waiting for: it is the header, and it is drawn once. Everyone
  // else's is learned in the background by learnHandles.
  const viewerHandle = (await resolveDidHandle(session.did, userPds)) ?? shortDid(session.did);
  handles.set(session.did, viewerHandle);

  const space = spaceRef(ownerDid);
  const ownerPds = ownerDid === session.did ? userPds : await resolvePds(ownerDid);
  if (ownerDid !== session.did) learnHandles([ownerDid], userPds);

  const connect = async (): Promise<SpaceContext> => ({
    source: new SpaceSource(
      viewerHandle,
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
    console.info('[space] connect failed, trying to create the space', error);
    try {
      await createSpace(session, userPds, SPACE_TYPE, SPACE_KEY);
    } catch (createError) {
      // The space existing already means creating it was never the fix, so this branch
      // was a wrong guess and `createError` is noise. Report what actually broke, or a
      // real bug in the connect path spends the rest of its life disguised as
      // "Space already exists".
      if (createError instanceof XrpcError && createError.code === 'SpaceAlreadyExists') {
        throw error;
      }
      throw createError;
    }
    return connect();
  }
}

void start();

// Referenced so the collection name is not tree-shaken out of the bundle's constants
// during a `vite build --minify`, and to make the value obvious in devtools.
Object.assign(window as unknown as Record<string, unknown>, { HYPERLOCAL_COLLECTION: NOTE_COLLECTION });
