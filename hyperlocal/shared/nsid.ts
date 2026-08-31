// Every name derived from the namespace lives here, so pointing this project at a
// domain you actually own is a one-line change plus renaming the lexicon directory.
//
// atproto NSIDs are reversed domain names, and lexicon resolution is moving toward a
// `_lexicon` DNS TXT record on that domain — so `xyz.hyperlocal` is a placeholder that
// works fine while nothing else on the network needs to resolve these schemas.
export const NAMESPACE = 'xyz.hyperlocal';

export const NOTE_COLLECTION = `${NAMESPACE}.note` as const;
export const SPACE_TYPE = `${NAMESPACE}.space` as const;

// The space type declares `"key": "literal:self"`, so every owner has exactly one.
export const SPACE_KEY = 'self';

/** The OAuth scope needed to write notes. */
export const NOTE_SCOPE = `repo:${NOTE_COLLECTION}`;

/**
 * Build the space reference for an owner.
 * Space refs are `at://{authority}/space/{type}/{skey}`, the `space` segment being
 * what distinguishes them from a public record URI (whose first path segment is an
 * NSID, and so contains dots).
 */
export function spaceRef(authorityDid: string, skey: string = SPACE_KEY): string {
  return `at://${authorityDid}/space/${SPACE_TYPE}/${skey}`;
}

/** Pull the authority DID back out of a space ref. Null if it isn't one. */
export function spaceAuthority(ref: string): string | null {
  return ref.match(/^at:\/\/(did:[^/]+)\/space\//)?.[1] ?? null;
}
