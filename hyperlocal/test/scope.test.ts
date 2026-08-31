import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ScopePermissions } from '@atproto/oauth-scopes';
import { NOTE_COLLECTION, SPACE_KEY, SPACE_TYPE } from '../shared/nsid.js';
import { OAUTH_SCOPE } from '../shared/scope.js';

/**
 * The scope is a hand-written string, so it is checked against the real parser rather
 * than eyeballed. A scope that is subtly wrong fails at the consent screen of a PDS we
 * cannot reach from here, which is an expensive place to find out.
 */
const permissions = new ScopePermissions(OAUTH_SCOPE);
const space = { type: SPACE_TYPE, authority: 'did:plc:someoneelse', skey: SPACE_KEY };

test('grants reading and writing notes in someone else\'s space', () => {
  assert.ok(permissions.allowsSpace({ ...space, action: 'read' }));
  for (const action of ['create', 'update', 'delete'] as const) {
    assert.ok(
      permissions.allowsSpace({ ...space, collection: NOTE_COLLECTION, action }),
      `${action} should be allowed`,
    );
  }
});

test('grants creating your own space', () => {
  assert.ok(permissions.allowsSpace({ ...space, manage: 'create' }));
});

test('authority=* is what lets a member read the owner\'s space', () => {
  // The parameter defaults to `self`, which would only ever match your own space —
  // and a shared space is anchored on the owner's DID, not the reader's.
  assert.ok(permissions.allowsSpace({ ...space, authority: 'did:plc:owner', action: 'read' }));
  assert.ok(permissions.allowsSpace({ ...space, authority: 'did:plc:another', action: 'read' }));
});

test('grants nothing outside the note collection', () => {
  assert.ok(
    !permissions.allowsSpace({ ...space, collection: 'app.bsky.feed.post', action: 'create' }),
    'must not be able to write posts',
  );
  assert.ok(
    !permissions.allowsSpace({ ...space, type: 'app.bsky.group', action: 'read' }),
    'must not be able to read other kinds of space',
  );
  assert.ok(
    !permissions.allowsSpace({ ...space, skey: 'other', action: 'read' }),
    'must be scoped to the one space key',
  );
});

test('the scope asks for atproto and exactly one space grant', () => {
  const parts = OAUTH_SCOPE.split(' ');
  assert.equal(parts[0], 'atproto');
  assert.equal(parts.length, 2, 'a stray space in the scope string splits it silently');
  assert.ok(parts[1].startsWith('space?type='));
});
