import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEV_PLACES_URL, resolveBase } from '../shared/places-config.js';

test('an explicitly configured proxy always wins', () => {
  assert.equal(resolveBase('https://places.example', true), 'https://places.example');
  assert.equal(resolveBase('https://places.example', false), 'https://places.example');
});

test('dev falls back to the loopback proxy', () => {
  assert.equal(resolveBase(undefined, true), DEV_PLACES_URL);
  assert.equal(resolveBase('', true), DEV_PLACES_URL, 'an empty variable is not a URL');
});

test('an unconfigured production build has no proxy at all', () => {
  // Not the loopback URL: from an HTTPS page that is mixed content, which the browser
  // blocks. Returning null means the request is never attempted and compose drops
  // straight to a plain pin.
  assert.equal(resolveBase(undefined, false), null);
  assert.equal(resolveBase('', false), null);
});
