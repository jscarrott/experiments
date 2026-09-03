import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mintSpaceCredential, type UserSession } from '../web/space.js';
import { SPACE_TYPE } from '../shared/nsid.js';

const OWNER = 'did:plc:owner';
const SPACE = `at://${OWNER}/space/${SPACE_TYPE}/self`;

// getDelegationToken is a query and getSpaceCredential a procedure, so the two hops
// differ in HTTP method. Nothing in the type system says so — `xrpcGet` and `xrpcPost`
// have the same shape — and getting it wrong fails only against a live PDS, with
// `Incorrect HTTP method (POST) expected GET`. Hence pinning the wire calls here.
test('the delegation token is fetched with GET and the credential minted with POST', async () => {
  const calls: { url: string; method: string }[] = [];

  const session: UserSession = {
    did: 'did:plc:reader',
    pdsUrl: 'https://reader.example',
    fetchHandler: (input, init) => {
      calls.push({ url: input.toString(), method: init?.method ?? 'GET' });
      return Promise.resolve(
        new Response(JSON.stringify({ token: 'delegation-token' }), {
          headers: { 'content-type': 'application/json' },
        }),
      );
    },
  };

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: Request) => {
    calls.push({ url: input.url, method: input.method });
    return new Response(JSON.stringify({ credential: 'space-credential' }), {
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const credential = await mintSpaceCredential(session, SPACE, async () => 'https://authority.example');
    assert.ok(credential);
  } finally {
    globalThis.fetch = realFetch;
  }

  const [delegation, exchange] = calls;
  assert.equal(delegation.method, 'GET');
  const url = new URL(delegation.url);
  assert.equal(url.origin, 'https://reader.example');
  assert.equal(url.pathname, '/xrpc/com.atproto.space.getDelegationToken');
  assert.equal(url.searchParams.get('space'), SPACE);

  assert.equal(exchange.method, 'POST');
  assert.equal(
    exchange.url,
    'https://authority.example/xrpc/com.atproto.space.getSpaceCredential',
  );
});
