import { JoseKey } from '@atproto/jwk-jose';
import { createDpopProof } from './dpop.js';
import { NOTE_COLLECTION, spaceAuthority } from '../shared/nsid.js';
import { toNote } from '../shared/note.js';
import type { Note, NoteRecord } from '../shared/types.js';
import type { NoteSource } from './source.js';
import { toError, xrpcGet, xrpcPost, type FetchLike } from './xrpc.js';

/**
 * A session that can sign XRPC calls as the user. `@atproto/oauth-client-browser`'s
 * OAuthSession satisfies this; keeping it structural means the sync code can be
 * exercised without an OAuth client.
 */
export interface UserSession {
  did: string;
  serverMetadata?: { issuer?: string };
  fetchHandler: FetchLike;
  /** The user's own PDS. */
  pdsUrl?: string;
}

/**
 * A minted space credential, plus the DPoP key it is bound to.
 *
 * Modelled directly on Bulletin's `SpaceCredential`: the credential goes in an
 * `Authorization: DPoP` header and every request carries a fresh proof over the
 * client-generated key. That the key is generated here, rather than registered in
 * advance, is why a browser-only client works at all.
 */
export class SpaceCredential {
  constructor(
    private readonly token: string,
    private readonly key: JoseKey,
  ) {}

  readonly fetch: FetchLike = async (input, init) => {
    const request = new Request(input, { ...init, redirect: 'error' });
    request.headers.set('authorization', `DPoP ${this.token}`);
    request.headers.set(
      'dpop',
      await createDpopProof(this.key, {
        htm: request.method,
        htu: request.url,
        credential: this.token,
      }),
    );
    return fetch(request);
  };
}

/**
 * Exchange the user's OAuth session for a credential that reads the space.
 *
 * Two hops, and they go to different servers: the delegation token comes from the
 * user's own PDS, and is then spent at the space authority's PDS. Missing that and
 * pointing both at the same host is the obvious way to get this wrong.
 */
export async function mintSpaceCredential(
  session: UserSession,
  space: string,
  resolvePds: (did: string) => Promise<string>,
): Promise<SpaceCredential> {
  const authority = spaceAuthority(space);
  if (!authority) throw new Error(`not a space ref: ${space}`);

  const userPds = session.pdsUrl ?? (await resolvePds(session.did));
  // A query, not a procedure: the lexicon declares getDelegationToken as `type: query`,
  // so a POST here comes back as `InvalidRequest: Incorrect HTTP method (POST) expected
  // GET`. Its sibling getSpaceCredential *is* a procedure, which is what makes the pair
  // easy to get wrong.
  const { token } = await xrpcGet<{ token: string }>(
    session.fetchHandler,
    userPds,
    'com.atproto.space.getDelegationToken',
    { space },
  );

  const authorityPds = await resolvePds(authority);
  const key = await JoseKey.generate(['ES256']);

  const url = new URL('/xrpc/com.atproto.space.getSpaceCredential', authorityPds);
  const request = new Request(url, {
    method: 'POST',
    redirect: 'error',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ space }),
  });
  request.headers.set(
    'dpop',
    await createDpopProof(key, { htm: request.method, htu: request.url }),
  );

  const response = await fetch(request);
  if (!response.ok) {
    // This hop is hand-rolled rather than going through xrpcPost, so it has to do its
    // own error reporting. A bare status is not enough: the server's message is the
    // only thing that separates a bad DPoP proof from a delegation token the authority
    // could not verify, and those have completely different causes.
    throw await toError(response, 'com.atproto.space.getSpaceCredential');
  }
  const body = (await response.json()) as { credential?: string };
  if (!body.credential) throw new Error('credential exchange returned no credential');
  return new SpaceCredential(body.credential, key);
}

interface DidDocument {
  alsoKnownAs?: string[];
  service?: { id?: string; type?: string; serviceEndpoint?: string }[];
}

async function fetchDidDoc(did: string): Promise<DidDocument> {
  const url = did.startsWith('did:web:')
    ? `https://${did.slice('did:web:'.length)}/.well-known/did.json`
    : `https://plc.directory/${did}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`could not resolve ${did}`);
  return (await response.json()) as DidDocument;
}

/** Resolve a DID to its PDS service endpoint. */
export async function resolvePds(did: string): Promise<string> {
  const doc = await fetchDidDoc(did);
  const pds = doc.service?.find(
    (s) => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer',
  )?.serviceEndpoint;
  if (!pds) throw new Error(`${did} has no PDS in its DID document`);
  return pds;
}

/**
 * Resolve a DID back to its handle, for display. Null when there isn't a trustworthy one.
 *
 * `alsoKnownAs` is a claim made by the DID's own owner and nothing more — anyone can put
 * `at://someone.else` in their own document, and a space's member list is exactly the
 * place where being shown a name you recognise matters. atproto's rule is that a handle
 * counts only if resolving it leads back to the same DID, so that round trip is done here
 * rather than trusting the document. A handle that fails it is discarded and the caller
 * falls back to the DID, which is ugly and honest.
 */
export async function resolveDidHandle(did: string, service: string): Promise<string | null> {
  let claimed: string | undefined;
  try {
    const doc = await fetchDidDoc(did);
    claimed = doc.alsoKnownAs?.find((aka) => aka.startsWith('at://'))?.slice('at://'.length);
  } catch {
    return null;
  }
  if (!claimed) return null;

  try {
    return (await resolveHandle(claimed, service)) === did ? claimed : null;
  } catch {
    // An unresolvable handle is the normal case mid-setup, before the `_atproto` TXT
    // record has propagated. Not worth an error; the DID still identifies the person.
    return null;
  }
}

export interface SyncReport {
  notes: Note[];
  /** Members whose repo could not be read, and why. */
  failures: { did: string; message: string }[];
  /** Records that arrived but did not validate — a member's client writing nonsense. */
  invalid: number;
}

interface RepoListing {
  repos: { did: string; rev?: string; hash?: unknown }[];
  cursor?: string;
}

interface RecordListing {
  // No `uri`, unlike every unpermissioned listing and unlike createRecord's own result.
  // A space record is addressed by the space it lives in plus repo/collection/rkey, and
  // the listing returns exactly those parts and leaves assembling them to the caller.
  records: { collection: string; rkey: string; cid: string; value?: unknown }[];
  cursor?: string;
}

/**
 * The at:// URI of a record inside a space.
 *
 * `<space-ref>/<repo did>/<collection>/<rkey>` — deeper than an ordinary record URI,
 * because the space is part of the address rather than implied by the repo. Matches what
 * com.atproto.space.createRecord hands back for the same record, which is what makes a
 * note written this session and the same note re-read next session compare equal.
 */
function spaceRecordUri(space: string, repo: string, collection: string, rkey: string): string {
  return `${space}/${repo}/${collection}/${rkey}`;
}

/**
 * Read every note in the space.
 *
 * `listRepos` is the writer set, not the member list — the lexicon is explicit that it
 * "enumerates only writers, never readers" and "is not itself authoritative". So it is
 * used purely as the list of repos worth reading, and each repo's own host decides
 * what is actually in it.
 *
 * One member's repo failing must not empty the map, so failures are collected and
 * reported rather than thrown.
 */
export async function syncSpace(
  credential: SpaceCredential,
  spaceHost: string,
  space: string,
): Promise<SyncReport> {
  const notes: Note[] = [];
  const failures: SyncReport['failures'] = [];
  let invalid = 0;

  const repos: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await xrpcGet<RepoListing>(
      credential.fetch,
      spaceHost,
      'com.atproto.space.listRepos',
      { space, limit: 100, cursor },
    );
    for (const repo of page.repos ?? []) if (repo?.did) repos.push(repo.did);
    cursor = page.cursor;
  } while (cursor);

  for (const did of repos) {
    try {
      let recordCursor: string | undefined;
      do {
        const page = await xrpcGet<RecordListing>(
          credential.fetch,
          spaceHost,
          'com.atproto.space.listRecords',
          { space, repo: did, collection: NOTE_COLLECTION, limit: 100, cursor: recordCursor },
        );
        for (const record of page.records ?? []) {
          // Validated here, not trusted: a space grants access, not trust, and a
          // member's client can write anything at all into their own repo.
          const note = toNote(
            spaceRecordUri(space, did, record.collection, record.rkey),
            record.cid,
            did,
            record.value,
          );
          if (note) notes.push(note);
          else invalid++;
        }
        recordCursor = page.cursor;
      } while (recordCursor);
    } catch (error) {
      failures.push({ did, message: (error as Error).message });
    }
  }

  return { notes, failures, invalid };
}

/** A live space, as the UI sees it. */
export class SpaceSource implements NoteSource {
  readonly live = true;

  constructor(
    readonly label: string,
    readonly viewer: string,
    private readonly session: UserSession,
    private readonly credential: SpaceCredential,
    private readonly spaceHost: string,
    private readonly space: string,
    private readonly userPds: string,
  ) {}

  async load(): Promise<Note[]> {
    const report = await syncSpace(this.credential, this.spaceHost, this.space);
    if (report.failures.length > 0) {
      console.warn('[space] some members could not be read', report.failures);
    }
    if (report.invalid > 0) {
      console.warn(`[space] skipped ${report.invalid} record(s) that did not validate`);
    }
    return report.notes;
  }

  async create(record: NoteRecord): Promise<Note> {
    // Writes go to the user's own PDS, over their OAuth session — a member writes to
    // their own repo, never to anyone else's.
    const result = await xrpcPost<{ uri: string; cid: string }>(
      this.session.fetchHandler,
      this.userPds,
      'com.atproto.space.createRecord',
      { space: this.space, repo: this.viewer, collection: NOTE_COLLECTION, record },
    );
    const note = toNote(result.uri, result.cid, this.viewer, record);
    if (!note) throw new Error('wrote a record that does not validate');
    return note;
  }

  async remove(note: Note): Promise<void> {
    const rkey = note.uri.split('/').pop();
    if (!rkey) throw new Error(`cannot parse rkey from ${note.uri}`);
    await xrpcPost(this.session.fetchHandler, this.userPds, 'com.atproto.space.deleteRecord', {
      space: this.space,
      repo: this.viewer,
      collection: NOTE_COLLECTION,
      rkey,
    });
  }
}

/** Add a member to the space's list. Owner only — see docs/spaces-alpha-notes.md. */
export async function addMember(
  session: UserSession,
  authorityPds: string,
  space: string,
  did: string,
): Promise<void> {
  await xrpcPost(session.fetchHandler, authorityPds, 'com.atproto.simplespace.addMember', {
    space,
    did,
  });
}

export async function removeMember(
  session: UserSession,
  authorityPds: string,
  space: string,
  did: string,
): Promise<void> {
  await xrpcPost(session.fetchHandler, authorityPds, 'com.atproto.simplespace.removeMember', {
    space,
    did,
  });
}

/**
 * List the space's members.
 *
 * Only works for the owner: the lexicon requires OAuth on the authority's PDS and says
 * a space credential is explicitly not sufficient, so a member hosted elsewhere cannot
 * enumerate the list. Callers must be ready for this to throw.
 */
export async function listMembers(
  session: UserSession,
  authorityPds: string,
  space: string,
): Promise<string[]> {
  const dids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await xrpcGet<{ members: { did: string }[]; cursor?: string }>(
      session.fetchHandler,
      authorityPds,
      'com.atproto.simplespace.listMembers',
      { space, limit: 100, cursor },
    );
    for (const member of page.members ?? []) if (member?.did) dids.push(member.did);
    cursor = page.cursor;
  } while (cursor);
  return dids;
}

/** Create the one space this app uses. */
export async function createSpace(
  session: UserSession,
  userPds: string,
  spaceType: string,
  skey: string,
): Promise<string> {
  const result = await xrpcPost<{ uri: string }>(
    session.fetchHandler,
    userPds,
    'com.atproto.simplespace.createSpace',
    {
      type: spaceType,
      skey,
      // Exactly the model this app wants: a list of people you invite.
      policy: { $type: 'com.atproto.simplespace.defs#memberListPolicy' },
      // "Any app may access the space. No client attestation required" — which is what
      // lets this run as a plain browser app with no server holding a client secret.
      appAccess: { $type: 'com.atproto.simplespace.defs#open' },
    },
  );
  return result.uri;
}

/** Resolve a handle to a DID, for invites. */
export async function resolveHandle(handle: string, service: string): Promise<string> {
  const result = await xrpcGet<{ did: string }>(
    fetch,
    service,
    'com.atproto.identity.resolveHandle',
    { handle },
  );
  return result.did;
}
