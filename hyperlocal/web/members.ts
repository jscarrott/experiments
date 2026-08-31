import { fill, h } from './dom.js';
import { addMember, listMembers, removeMember, resolveHandle, type UserSession } from './space.js';

export interface MembersContext {
  session: UserSession;
  /** The authority's PDS — where every membership call must go. */
  authorityPds: string;
  space: string;
  /** True when the signed-in user is the space authority. */
  isOwner: boolean;
  /** Called after the list changes, so handles can be cached for the sidebar. */
  onChange(dids: string[]): void;
}

interface State {
  dids: string[];
  busy: boolean;
  error: string | null;
  notice: string | null;
}

/**
 * The member list, and inviting people to it.
 *
 * Owner-only, and not by choice: `com.atproto.simplespace.listMembers` must be called
 * on the authority's PDS with OAuth, and the lexicon says a space credential is
 * explicitly not sufficient — so a member hosted elsewhere cannot enumerate the list at
 * all. Everyone else gets told whose space they are in and nothing more, which is the
 * honest rendering of what the protocol will actually give them.
 */
export function mountMembers(root: HTMLElement, context: MembersContext): void {
  const state: State = { dids: [], busy: false, error: null, notice: null };

  const render = () => {
    if (!context.isOwner) {
      fill(root,
        h('div', { class: 'panel' },
          h('h2', { class: 'panel__heading', text: 'This space' }),
          h('p', { class: 'muted', text: 'You are a guest here. Only the owner can see or change who is in the space.' }),
        ),
      );
      return;
    }

    const input = h('input', {
      class: 'input',
      placeholder: 'sister.bsky.social',
      'data-testid': 'invite-handle',
    });

    fill(root,
      h('div', { class: 'panel' },
        h('h2', { class: 'panel__heading', text: 'Who can see this' }),

        h('form', {
          class: 'field',
          onsubmit: (event: Event) => {
            event.preventDefault();
            void invite(input.value);
          },
        },
          h('div', { class: 'row' },
            input,
            h('button', {
              type: 'submit',
              class: 'button button--small',
              disabled: state.busy,
              'data-testid': 'invite',
              text: state.busy ? '…' : 'Invite',
            }),
          ),
        ),

        state.error && h('p', { class: 'error', 'data-testid': 'members-error', text: state.error }),
        state.notice && h('p', { class: 'muted', 'data-testid': 'members-notice', text: state.notice }),

        state.dids.length === 0
          ? h('p', { class: 'muted', text: 'Nobody invited yet.' })
          : h('ul', { class: 'list list--plain', 'data-testid': 'members' },
              ...state.dids.map((did) =>
                h('li', { class: 'row' },
                  h('span', { class: 'grow', title: did, text: shorten(did) }),
                  did === context.session.did
                    ? h('span', { class: 'muted', text: 'you' })
                    : h('button', {
                        type: 'button',
                        class: 'link link--danger',
                        onclick: () => void drop(did),
                        text: 'Remove',
                      }),
                ),
              ),
            ),

        h('p', { class: 'muted', text: 'Removing someone stops them seeing anything new. It cannot take back what they have already read.' }),
      ),
    );
  };

  const refresh = async () => {
    if (!context.isOwner) return;
    try {
      state.dids = await listMembers(context.session, context.authorityPds, context.space);
      context.onChange(state.dids);
    } catch (error) {
      state.error = `Could not read the member list: ${(error as Error).message}`;
    }
    render();
  };

  const invite = async (handle: string) => {
    const trimmed = handle.trim().replace(/^@/, '');
    if (!trimmed || state.busy) return;
    state.busy = true;
    state.error = null;
    state.notice = null;
    render();
    try {
      // Resolve first: adding a DID that does not exist would fail obscurely later,
      // and "no such handle" is the error a person can act on.
      const did = await resolveHandle(trimmed, context.authorityPds);
      await addMember(context.session, context.authorityPds, context.space, did);
      state.notice = `Invited ${trimmed}. Send them the link with ?owner= in it.`;
    } catch (error) {
      state.error = `Could not invite ${trimmed}: ${(error as Error).message}`;
    } finally {
      state.busy = false;
    }
    await refresh();
  };

  const drop = async (did: string) => {
    if (!confirm(`Remove ${shorten(did)} from this space?`)) return;
    try {
      await removeMember(context.session, context.authorityPds, context.space, did);
    } catch (error) {
      state.error = `Could not remove: ${(error as Error).message}`;
    }
    await refresh();
  };

  render();
  void refresh();
}

function shorten(did: string): string {
  return did.length > 24 ? `${did.slice(0, 14)}…${did.slice(-6)}` : did;
}
