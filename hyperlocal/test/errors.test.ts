import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainSignInFailure, explainSpaceFailure } from '../web/errors.js';
import { XrpcError } from '../web/xrpc.js';

// Every case here is a failure this app actually produced while being set up against a
// real PDS. In each one the server's own message named the wrong layer, which is the
// whole reason this translation exists.

test('a PDS without spaces support is named as such, not reported as a 404', () => {
  const explained = explainSpaceFailure(
    new XrpcError(404, 'HTTP404', 'com.atproto.space.getDelegationToken: Not Found'),
  );
  assert.match(explained.headline, /does not support spaces/);
  assert.match(explained.headline, /bsky\.social/);
  assert.match(explained.detail ?? '', /getDelegationToken/);
});

// The PDS could not reach plc.directory, and said "Invalid delegation token", which
// reads as a signature problem and sent me looking at DPoP for an hour.
test('a delegation token rejection points at identity lookup, not at the token', () => {
  const explained = explainSpaceFailure(
    new XrpcError(401, 'BadJwt', 'Invalid delegation token: This operation was aborted'),
  );
  assert.match(explained.headline, /could not verify who you are/);
  assert.match(explained.headline, /plc\.directory/);
});

test('an SSRF refusal explains the private network, not the hostname', () => {
  const explained = explainSpaceFailure(new Error('Hostname resolved to non-unicast address'));
  assert.match(explained.headline, /SSRF/);
});

test('not being a member is distinguished from not being signed in', () => {
  const explained = explainSpaceFailure(new XrpcError(403, 'Forbidden', 'not a member'));
  assert.match(explained.headline, /signed in, but not allowed/);
  assert.match(explained.headline, /member list/);
});

test('an unreachable server is not reported as a permissions problem', () => {
  const explained = explainSpaceFailure(new TypeError('NetworkError when attempting to fetch resource.'));
  assert.match(explained.headline, /Could not reach your server/);
});

test('an unrecognised failure still carries its original text', () => {
  const explained = explainSpaceFailure(new Error('something nobody predicted'));
  assert.equal(explained.headline, 'Could not open your space.');
  assert.equal(explained.detail, 'something nobody predicted');
});

// This one cost a whole evening: the lexicons were not published, and the only signal
// was `invalid_scope` from the authorization server.
test('invalid_scope points at unpublished lexicons', () => {
  const explained = explainSignInFailure(new Error('invalid_scope: Invalid scope'));
  assert.match(explained.headline, /lexicons/);
  assert.match(explained.headline, /published/);
});

test('a cancelled sign-in is not dressed up as a failure', () => {
  const explained = explainSignInFailure(new Error('access_denied'));
  assert.match(explained.headline, /cancelled/);
});
