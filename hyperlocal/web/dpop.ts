import type { JoseKey } from '@atproto/jwk-jose';

/**
 * DPoP proofs for space credentials (RFC 9449).
 *
 * `@atproto/space` exports exactly this function, but its barrel also pulls in CAR
 * decoding and repo sync, which import `node:fs`, `node:zlib` and friends — so
 * depending on it drags a Node-only tree into a browser bundle for the sake of twenty
 * lines. This is a direct implementation of the same proof, matching the reference
 * claim for claim, checked against
 * node_modules/@atproto/space/dist/dpop.js at 0.0.0-spaces-alpha-20260818163953.
 *
 * The point of the binding: a space credential reads the whole space and is presented
 * to every repo host in it. As a bearer token it would be a shared secret — a host
 * handed one to serve its own repo could replay it against every other host.
 */
const DPOP_PROOF_TYP = 'dpop+jwt';
const SIGNING_ALG = 'ES256';

export interface DpopProofOptions {
  htm: string;
  htu: string;
  /** The credential this proof is bound to. Omitted when obtaining one. */
  credential?: string;
}

export async function createDpopProof(key: JoseKey, opts: DpopProofOptions): Promise<string> {
  const jwk = key.bareJwk;
  if (!jwk) throw new Error('a DPoP proof requires an asymmetric key');
  if (!key.algorithms.includes(SIGNING_ALG)) {
    throw new Error(`a DPoP key must support ${SIGNING_ALG}, got: ${key.algorithms.join(', ')}`);
  }

  return key.createJwt(
    { alg: SIGNING_ALG, typ: DPOP_PROOF_TYP, jwk },
    {
      jti: randomHex(16),
      htm: opts.htm,
      htu: normaliseHtu(opts.htu),
      ...(opts.credential !== undefined
        ? { ath: await sha256Base64Url(opts.credential) }
        : undefined),
      iat: Math.floor(Date.now() / 1000),
    },
  );
}

/** Query and fragment are stripped, per RFC 9449 §4.2, so one proof covers any query
 * on a path — which matters because our reads put everything in the query string. */
function normaliseHtu(url: string): string {
  const parsed = new URL(url);
  return parsed.origin + parsed.pathname;
}

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return [...buffer].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
