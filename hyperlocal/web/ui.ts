import { clear, fill, h, ratingLabel, relativeTime } from './dom.js';
import { MAP_KEY } from './map-style.js';
import type { AppState, DerivedState } from './state.js';
import type { Note, PlaceCandidate, PlaceGroup } from '../shared/types.js';

export interface UiHandlers {
  toggleAuthor(did: string): void;
  toggleTag(tag: string): void;
  setRatedOnly(value: boolean): void;
  setSearch(value: string): void;
  openPlace(key: string | null): void;
  focusNote(note: Note): void;
  deleteNote(note: Note): void;
  startCompose(): void;
}

export interface ViewerInfo {
  did: string | null;
  handleFor(did: string): string;
}

/** The left sidebar: who and what to show. */
export function renderFilters(
  root: HTMLElement,
  state: AppState,
  derived: DerivedState,
  viewer: ViewerInfo,
  handlers: UiHandlers,
): void {
  const filter = state.filter;
  const selectedAuthors = new Set(filter.authors ?? []);
  const selectedTags = new Set(filter.tags ?? []);

  fill(root, 
    h('div', { class: 'panel' },
      h('label', { class: 'field' },
        h('span', { class: 'field__label', text: 'Search' }),
        h('input', {
          type: 'search',
          class: 'input',
          placeholder: 'coffee, parking…',
          value: filter.search ?? '',
          'data-testid': 'search',
          oninput: (e) => handlers.setSearch((e.target as HTMLInputElement).value),
        }),
      ),
      h('label', { class: 'toggle' },
        h('input', {
          type: 'checkbox',
          checked: filter.ratedOnly === true,
          'data-testid': 'rated-only',
          onchange: (e) => handlers.setRatedOnly((e.target as HTMLInputElement).checked),
        }),
        h('span', { text: 'Only notes with a rating' }),
      ),
    ),

    h('div', { class: 'panel' },
      h('h2', { class: 'panel__heading', text: 'People' }),
      derived.authors.length === 0
        ? h('p', { class: 'muted', text: 'Nobody has written anything yet.' })
        : h('ul', { class: 'list list--plain', 'data-testid': 'authors' },
            ...derived.authors.map(({ did, count }) =>
              h('li', {},
                h('label', { class: 'toggle' },
                  h('input', {
                    type: 'checkbox',
                    checked: selectedAuthors.has(did),
                    'data-author': did,
                    onchange: () => handlers.toggleAuthor(did),
                  }),
                  h('span', { class: 'grow', text: viewer.handleFor(did) + (did === viewer.did ? ' (you)' : '') }),
                  h('span', { class: 'count', text: String(count) }),
                ),
              ),
            ),
          ),
    ),

    derived.tags.length > 0 &&
      h('div', { class: 'panel' },
        h('h2', { class: 'panel__heading', text: 'Tags' }),
        h('div', { class: 'chips' },
          ...derived.tags.map(({ tag, count }) =>
            h('button', {
              type: 'button',
              class: selectedTags.has(tag) ? 'chip chip--on' : 'chip',
              onclick: () => handlers.toggleTag(tag),
              text: `${tag} ${count}`,
            }),
          ),
        ),
      ),
  );
}

/** The right sidebar: either a place's notes, or everything currently in view. */
/**
 * The colour key for the map, rendered from the same constants the map paints with.
 *
 * It lives in the sidebar rather than floating over the map because the map is the one
 * thing on a phone that should not be covered, and because a key is read once and then
 * remembered.
 */
export function renderMapKey(root: HTMLElement): void {
  fill(root,
    h('div', { class: 'panel' },
      h('h2', { class: 'panel__heading', text: 'Map key' }),
      h('ul', { class: 'list list--plain key', 'data-testid': 'map-key' },
        ...MAP_KEY.map((entry) =>
          h('li', { class: 'key__row' },
            h('span', { class: 'key__dot', style: `background:${entry.colour}` }),
            h('span', { text: entry.label }),
          ),
        ),
      ),
      h('p', { class: 'muted', text: 'Bigger circles mean more notes about the same place.' }),
    ),
  );
}

export function renderList(
  root: HTMLElement,
  state: AppState,
  derived: DerivedState,
  viewer: ViewerInfo,
  handlers: UiHandlers,
): void {
  if (state.openPlace) {
    const group = derived.groups.find((g) => g.key === state.openPlace);
    if (group) {
      fill(root, renderPlace(group, viewer, handlers));
      return;
    }
    // The place fell out of view or out of the filter; drop back to the list rather
    // than showing an empty panel.
  }

  const notes = derived.visible;
  fill(root, 
    h('div', { class: 'panel' },
      // Classed so a phone can drop it: the bottom sheet's own handle already says
      // "7 notes in view", and showing that twice, six pixels apart, reads as a bug.
      h('div', { class: 'row list__head' },
        h('h2', { class: 'panel__heading grow', text: 'In view' }),
        h('span', { class: 'count', 'data-testid': 'visible-count', text: String(notes.length) }),
      ),
      state.loading
        ? h('p', { class: 'muted', text: 'Loading…' })
        : notes.length === 0
          ? h('p', { class: 'muted', text: 'Nothing here. Pan the map, or clear a filter.' })
          : h('ul', { class: 'list', 'data-testid': 'note-list' },
              ...notes.map((note) => noteItem(note, viewer, handlers, true)),
            ),
    ),
  );
}

/**
 * The popup over a single dropped pin: the note itself, rendered exactly as the list
 * renders it, so delete and the author link keep working from the map.
 */
export function renderNotePopup(note: Note, viewer: ViewerInfo, handlers: UiHandlers): HTMLElement {
  return h('div', { class: 'popup', 'data-testid': 'note-popup' },
    h('ul', { class: 'list list--plain' }, noteItem(note, viewer, handlers, false)),
  );
}

/**
 * The popup over a business: a summary and a way in. Deliberately not the full list —
 * several notes will not fit over a map on a phone, and the place page already exists.
 */
export function renderPlacePopup(group: PlaceGroup, handlers: UiHandlers): HTMLElement {
  const count = group.notes.length;
  return h('div', { class: 'popup', 'data-testid': 'place-popup' },
    h('h3', { class: 'popup__name', text: group.place.name ?? 'Unnamed place' }),
    group.averageRating === undefined
      ? h('p', { class: 'muted', text: 'No ratings yet' })
      : h('p', { class: 'note__rating', text: `${ratingLabel(Math.round(group.averageRating))}  ${group.averageRating.toFixed(1)}` }),
    h('button', {
      type: 'button',
      class: 'button button--small',
      'data-testid': 'popup-open-place',
      onclick: () => handlers.openPlace(group.key),
      text: `Read ${count} note${count === 1 ? '' : 's'}`,
    }),
  );
}

function renderPlace(group: PlaceGroup, viewer: ViewerInfo, handlers: UiHandlers): HTMLElement {
  return h('div', { class: 'panel', 'data-testid': 'place-view' },
    h('button', { type: 'button', class: 'link', onclick: () => handlers.openPlace(null), text: '← Back' }),
    h('h2', { class: 'place__name', text: group.place.name ?? 'Unnamed place' }),
    h('p', { class: 'muted', text: group.place.category ?? '' }),
    h('p', { class: 'place__rating' },
      group.averageRating === undefined
        ? h('span', { class: 'muted', text: 'No ratings yet' })
        : h('span', {
            'data-testid': 'average-rating',
            text: `${group.averageRating.toFixed(1)} from ${group.ratingCount} rating${group.ratingCount === 1 ? '' : 's'}`,
          }),
    ),
    h('ul', { class: 'list' }, ...group.notes.map((n) => noteItem(n, viewer, handlers, false))),
    h('p', { class: 'attribution', text: `OpenStreetMap ${group.place.osmType}/${group.place.osmId}` }),
  );
}

function noteItem(
  note: Note,
  viewer: ViewerInfo,
  handlers: UiHandlers,
  showPlace: boolean,
): HTMLElement {
  const { record } = note;
  return h('li', { class: 'note', 'data-uri': note.uri },
    h('div', { class: 'note__head' },
      h('button', {
        type: 'button',
        class: 'link grow',
        onclick: () => handlers.focusNote(note),
        text: viewer.handleFor(note.author),
      }),
      record.rating !== undefined &&
        h('span', { class: 'note__rating', title: `${record.rating} out of 5`, text: ratingLabel(record.rating) }),
    ),
    h('p', { class: 'note__text', text: record.text }),
    h('div', { class: 'note__meta' },
      showPlace && note.placeKey && record.place
        ? h('button', {
            type: 'button',
            class: 'link',
            onclick: () => handlers.openPlace(note.placeKey!),
            text: record.place.name ?? 'Place',
          })
        : h('span', { class: 'muted', text: showPlace ? 'Dropped pin' : '' }),
      h('span', { class: 'grow' }),
      h('time', {
        class: 'muted',
        datetime: record.createdAt,
        title: new Date(note.createdAtMs).toLocaleString(),
        text: relativeTime(note.createdAtMs),
      }),
      note.author === viewer.did &&
        h('button', {
          type: 'button',
          class: 'link link--danger',
          onclick: () => handlers.deleteNote(note),
          text: 'Delete',
        }),
    ),
    ...(record.tags ?? []).map((tag) => h('span', { class: 'chip chip--static', text: tag })),
  );
}

export interface ComposeDraft {
  lat: number;
  lng: number;
  text: string;
  rating?: number;
  tags: string;
  place: PlaceCandidate | null;
  candidates: PlaceCandidate[];
  /** True when the proxy could not reach Overpass, so there are no ids to offer. */
  degraded: boolean;
  loadingPlaces: boolean;
  error: string | null;
  saving: boolean;
}

export interface ComposeHandlers {
  choosePlace(candidate: PlaceCandidate | null): void;
  change(patch: Partial<ComposeDraft>): void;
  submit(): void;
  cancel(): void;
}

export function renderCompose(
  root: HTMLElement,
  draft: ComposeDraft | null,
  handlers: ComposeHandlers,
): void {
  if (!draft) {
    clear(root);
    root.hidden = true;
    return;
  }
  root.hidden = false;

  fill(root, 
    h('form', {
      class: 'panel compose',
      'data-testid': 'compose',
      onsubmit: (e) => {
        e.preventDefault();
        handlers.submit();
      },
    },
      h('div', { class: 'row' },
        h('h2', { class: 'panel__heading grow', text: draft.place?.name ?? 'A note about this spot' }),
        h('button', { type: 'button', class: 'link', onclick: () => handlers.cancel(), text: 'Close' }),
      ),

      h('p', { class: 'muted', text: `${draft.lat.toFixed(5)}, ${draft.lng.toFixed(5)}` }),

      draft.loadingPlaces
        ? h('p', { class: 'muted', text: 'Looking for what is here…' })
        : draft.candidates.length > 0
          ? h('div', { class: 'field' },
              h('span', { class: 'field__label', text: 'What is this about?' }),
              h('div', { class: 'chips', 'data-testid': 'place-candidates' },
                ...draft.candidates.slice(0, 6).map((candidate) =>
                  h('button', {
                    type: 'button',
                    class:
                      draft.place?.osmId === candidate.osmId && candidate.osmId
                        ? 'chip chip--on'
                        : 'chip',
                    onclick: () => handlers.choosePlace(candidate),
                    text: candidate.distance !== undefined
                      ? `${candidate.name} · ${Math.round(candidate.distance)}m`
                      : candidate.name,
                  }),
                ),
                h('button', {
                  type: 'button',
                  class: draft.place === null ? 'chip chip--on' : 'chip',
                  onclick: () => handlers.choosePlace(null),
                  text: 'Somewhere not listed',
                }),
              ),
            )
          : h('p', { class: 'muted', text: draft.degraded
              ? 'Could not reach OpenStreetMap, so this will be a plain pin.'
              : 'Nothing mapped here — this will be a plain pin.' }),

      h('label', { class: 'field' },
        h('span', { class: 'field__label', text: 'Note' }),
        h('textarea', {
          class: 'input',
          rows: 4,
          maxlength: 3000,
          required: true,
          placeholder: 'Good coffee, bad food…',
          'data-testid': 'compose-text',
          oninput: (e) => handlers.change({ text: (e.target as HTMLTextAreaElement).value }),
        }),
      ),

      h('div', { class: 'field' },
        h('span', { class: 'field__label', text: 'Rating (optional)' }),
        h('div', { class: 'chips', 'data-testid': 'rating' },
          ...[1, 2, 3, 4, 5].map((value) =>
            h('button', {
              type: 'button',
              class: draft.rating === value ? 'chip chip--on' : 'chip',
              'data-rating': value,
              // Clicking the chosen rating again clears it: a note without a rating
              // is a normal thing to want, not an error.
              onclick: () => handlers.change({ rating: draft.rating === value ? undefined : value }),
              text: '★'.repeat(value),
            }),
          ),
        ),
      ),

      h('label', { class: 'field' },
        h('span', { class: 'field__label', text: 'Tags (comma separated)' }),
        h('input', {
          class: 'input',
          value: draft.tags,
          placeholder: 'coffee, wifi',
          'data-testid': 'compose-tags',
          oninput: (e) => handlers.change({ tags: (e.target as HTMLInputElement).value }),
        }),
      ),

      draft.error && h('p', { class: 'error', 'data-testid': 'compose-error', text: draft.error }),

      h('button', {
        type: 'submit',
        class: 'button',
        disabled: draft.saving,
        'data-testid': 'compose-save',
        text: draft.saving ? 'Saving…' : 'Save note',
      }),
    ),
  );

  const textarea = root.querySelector('textarea');
  if (textarea && textarea.value !== draft.text) textarea.value = draft.text;
}
