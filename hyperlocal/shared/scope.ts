import { NOTE_COLLECTION, SPACE_KEY, SPACE_TYPE } from './nsid.js';

/**
 * The OAuth scope this app asks for.
 *
 * Written out rather than pulled from a published permission set, because a permission
 * set has to be resolvable, which means owning the domain the NSID is built from. The
 * raw form needs nothing published and grants the same thing — checked against
 * @atproto/oauth-scopes in docs/spaces-alpha-notes.md.
 *
 * It lives in shared/ because the deployed `client-metadata.json` must carry the exact
 * same string as the app requests, or the authorization server refuses. Two copies of
 * this would drift; one constant cannot.
 *
 * `authority=*` is the part that is easy to get wrong: a member reads a space anchored
 * on the *owner's* DID, and the parameter defaults to `self`.
 */
export const OAUTH_SCOPE = [
  'atproto',
  [
    `space?type=${SPACE_TYPE}`,
    'authority=*',
    `skey=${SPACE_KEY}`,
    `collection=${NOTE_COLLECTION}`,
    'action=read',
    'action=create',
    'action=update',
    'action=delete',
    'manage=create',
  ].join('&'),
].join(' ');
