/**
 * The live end-to-end check against a real spaces-capable PDS.
 *
 * Nothing in this repository has been run against a real space: the hosted sandbox is
 * invite-gated and self-hosting needs Docker. This script is what proves the whole
 * path once you have two accounts, and it deliberately ends with the check that
 * actually matters — that a non-member cannot read the notes.
 *
 *   PDS_URL=https://your-pds \
 *   A_HANDLE=alice.example A_PASSWORD=... \
 *   B_HANDLE=bob.example   B_PASSWORD=... \
 *   npm run spike
 *
 * It uses password sessions rather than OAuth because this is a command-line check and
 * the OAuth redirect dance needs a browser. The app itself uses OAuth.
 */
import { JoseKey } from '@atproto/jwk-jose';
import { NOTE_COLLECTION, SPACE_KEY, SPACE_TYPE, spaceRef } from '../shared/nsid.js';
import { buildNote, toNote } from '../shared/note.js';
import { createDpopProof } from '../web/dpop.js';

const PDS = required('PDS_URL');

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`missing ${name}; see the comment at the top of scripts/spike.ts`);
    process.exit(2);
  }
  return value;
}

interface Session {
  did: string;
  jwt: string;
  handle: string;
}

async function login(handle: string, password: string): Promise<Session> {
  const response = await fetch(new URL('/xrpc/com.atproto.server.createSession', PDS), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: handle, password }),
  });
  if (!response.ok) throw new Error(`login ${handle}: ${response.status} ${await response.text()}`);
  const body = (await response.json()) as { did: string; accessJwt: string; handle: string };
  return { did: body.did, jwt: body.accessJwt, handle: body.handle };
}

async function call<T>(session: Session | null, nsid: string, body?: unknown, params?: Record<string, string>): Promise<T> {
  const url = new URL(`/xrpc/${nsid}`, PDS);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(session ? { authorization: `Bearer ${session.jwt}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${nsid}: ${response.status} ${text}`);
  return (text ? JSON.parse(text) : {}) as T;
}

function step(n: number, what: string): void {
  console.log(`\n${n}. ${what}`);
}

async function main(): Promise<void> {
  const alice = await login(required('A_HANDLE'), required('A_PASSWORD'));
  const bob = await login(required('B_HANDLE'), required('B_PASSWORD'));
  console.log(`alice ${alice.did}\nbob   ${bob.did}`);

  const space = spaceRef(alice.did);

  step(1, `create the space ${space}`);
  try {
    const created = await call<{ uri: string }>(alice, 'com.atproto.simplespace.createSpace', {
      type: SPACE_TYPE,
      skey: SPACE_KEY,
      policy: { $type: 'com.atproto.simplespace.defs#memberListPolicy' },
      appAccess: { $type: 'com.atproto.simplespace.defs#open' },
    });
    console.log(`   created ${created.uri}`);
  } catch (error) {
    // Re-running the spike must not need a fresh account.
    console.log(`   already exists (${(error as Error).message.slice(0, 80)}…)`);
  }

  step(2, 'add bob to the member list');
  await call(alice, 'com.atproto.simplespace.addMember', { space, did: bob.did });
  const members = await call<{ members: { did: string }[] }>(
    alice,
    'com.atproto.simplespace.listMembers',
    undefined,
    { space },
  );
  console.log(`   members: ${members.members.map((m) => m.did).join(', ')}`);

  step(3, 'each writes a note');
  for (const [who, session] of [['alice', alice], ['bob', bob]] as const) {
    const record = buildNote({
      text: `spike note from ${who} at ${new Date().toISOString()}`,
      lat: 51.4529,
      lng: -2.5975,
      rating: 4,
    });
    const written = await call<{ uri: string }>(session, 'com.atproto.space.createRecord', {
      space,
      repo: session.did,
      collection: NOTE_COLLECTION,
      record,
    });
    console.log(`   ${who}: ${written.uri}`);
  }

  step(4, 'bob mints a space credential and reads the whole space');
  // A query, so `space` goes in the query string; sent as a body it becomes a POST and
  // the server answers `Incorrect HTTP method (POST) expected GET`.
  const delegation = await call<{ token: string }>(
    bob,
    'com.atproto.space.getDelegationToken',
    undefined,
    { space },
  );
  const key = await JoseKey.generate(['ES256']);
  const credentialUrl = new URL('/xrpc/com.atproto.space.getSpaceCredential', PDS);
  const credentialResponse = await fetch(credentialUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${delegation.token}`,
      'content-type': 'application/json',
      dpop: await createDpopProof(key, { htm: 'POST', htu: credentialUrl.toString() }),
    },
    body: JSON.stringify({ space }),
  });
  if (!credentialResponse.ok) {
    throw new Error(`credential exchange: ${credentialResponse.status} ${await credentialResponse.text()}`);
  }
  const { credential } = (await credentialResponse.json()) as { credential: string };

  const spaceFetch = async (url: URL) => {
    return fetch(url, {
      headers: {
        accept: 'application/json',
        authorization: `DPoP ${credential}`,
        dpop: await createDpopProof(key, { htm: 'GET', htu: url.toString(), credential }),
      },
    });
  };

  const reposUrl = new URL('/xrpc/com.atproto.space.listRepos', PDS);
  reposUrl.searchParams.set('space', space);
  const repos = (await (await spaceFetch(reposUrl)).json()) as { repos: { did: string }[] };
  console.log(`   writers: ${repos.repos.map((r) => r.did).join(', ')}`);

  let total = 0;
  for (const repo of repos.repos) {
    const recordsUrl = new URL('/xrpc/com.atproto.space.listRecords', PDS);
    recordsUrl.searchParams.set('space', space);
    recordsUrl.searchParams.set('repo', repo.did);
    recordsUrl.searchParams.set('collection', NOTE_COLLECTION);
    const listing = (await (await spaceFetch(recordsUrl)).json()) as {
      records: { uri: string; cid: string; value: unknown }[];
    };
    for (const record of listing.records) {
      const note = toNote(record.uri, record.cid, repo.did, record.value);
      console.log(`   ${note ? '✓' : '✗ (did not validate)'} ${record.uri}`);
      total++;
    }
  }
  if (total < 2) throw new Error(`expected both notes, saw ${total}`);

  step(5, 'THE CHECK THAT MATTERS: a stranger must not be able to read any of this');
  const strangerUrl = new URL('/xrpc/com.atproto.space.listRecords', PDS);
  strangerUrl.searchParams.set('space', space);
  strangerUrl.searchParams.set('repo', alice.did);
  strangerUrl.searchParams.set('collection', NOTE_COLLECTION);
  const anonymous = await fetch(strangerUrl, { headers: { accept: 'application/json' } });
  if (anonymous.ok) {
    throw new Error(`PRIVACY FAILURE: unauthenticated read returned ${anonymous.status}`);
  }
  console.log(`   unauthenticated read refused with ${anonymous.status} — correct`);

  // Public repo listing must not carry them either: space records live in a separate
  // permissioned repo, not the public one, and must never appear on the firehose.
  const publicUrl = new URL('/xrpc/com.atproto.repo.listRecords', PDS);
  publicUrl.searchParams.set('repo', alice.did);
  publicUrl.searchParams.set('collection', NOTE_COLLECTION);
  const publicListing = await fetch(publicUrl, { headers: { accept: 'application/json' } });
  const publicBody = publicListing.ok
    ? ((await publicListing.json()) as { records?: unknown[] })
    : { records: [] };
  if ((publicBody.records?.length ?? 0) > 0) {
    throw new Error('PRIVACY FAILURE: notes are visible in the public repo');
  }
  console.log('   public repo listing is empty — correct');

  console.log('\nAll checks passed.');
}

main().catch((error) => {
  console.error(`\nFAILED: ${(error as Error).message}`);
  process.exit(1);
});
