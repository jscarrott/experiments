import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDidHandle } from '../web/space.js';

const DID = 'did:plc:alice';
const SERVICE = 'https://pds.example';

/** Stand in for plc.directory and a PDS, so no test touches the network. */
function stubFetch(doc: unknown, resolvesTo: string | null) {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = input.toString();
    if (url.includes('plc.directory')) {
      return new Response(JSON.stringify(doc), {
        headers: { 'content-type': 'application/json' },
      });
    }
    if (resolvesTo === null) {
      return new Response(JSON.stringify({ error: 'InvalidRequest' }), { status: 400 });
    }
    return new Response(JSON.stringify({ did: resolvesTo }), {
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = real;
  };
}

test('a handle that resolves back to the same DID is used', async () => {
  const restore = stubFetch({ alsoKnownAs: ['at://alice.example.com'] }, DID);
  try {
    assert.equal(await resolveDidHandle(DID, SERVICE), 'alice.example.com');
  } finally {
    restore();
  }
});

// alsoKnownAs is written by the DID's own owner, so without the round trip anyone could
// display themselves as anyone — in a member list, which is precisely where a name is
// being trusted.
test('a handle claiming to be someone else is refused', async () => {
  const restore = stubFetch({ alsoKnownAs: ['at://mum.jscarrott.com'] }, 'did:plc:mallory');
  try {
    assert.equal(await resolveDidHandle(DID, SERVICE), null);
  } finally {
    restore();
  }
});

test('an unresolvable handle is refused rather than thrown', async () => {
  const restore = stubFetch({ alsoKnownAs: ['at://alice.example.com'] }, null);
  try {
    assert.equal(await resolveDidHandle(DID, SERVICE), null);
  } finally {
    restore();
  }
});

test('a document with no at:// alias yields no handle', async () => {
  const restore = stubFetch({ alsoKnownAs: ['https://alice.example.com'] }, DID);
  try {
    assert.equal(await resolveDidHandle(DID, SERVICE), null);
  } finally {
    restore();
  }
});
