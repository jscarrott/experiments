// Every name derived from the namespace lives here, so pointing this project at a
// domain you actually own is a one-line change plus renaming the lexicon directory.
//
// atproto NSIDs are reversed domain names. The authority for an NSID is everything
// before its final segment, reversed — so `com.jscarrott.hyperlocal.note` resolves via
// `_lexicon.hyperlocal.jscarrott.com`, not via the bare apex.
export const NAMESPACE = 'com.jscarrott.hyperlocal';

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
