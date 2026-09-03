import { XrpcError } from './xrpc.js';

/**
 * What to put in front of a person when the space will not open.
 *
 * Every case below is one this app actually produced during setup, and in every one the
 * message the server sent named the wrong layer: a DNS timeout arrives as a signature
 * error, a missing lexicon as a scope error, a PDS without spaces as a 404 on a method.
 * Passing those through verbatim asks the reader to know the protocol. The original text
 * is kept as `detail` rather than dropped — it is what makes a bug report useful — but it
 * stops being the headline.
 */
export interface Explained {
  headline: string;
  detail?: string;
}

export function explainSpaceFailure(error: unknown): Explained {
  const raw = error instanceof Error ? error.message : String(error);
  const code = error instanceof XrpcError ? error.code : '';
  const status = error instanceof XrpcError ? error.status : 0;
  const detail = raw;

  // A PDS with no spaces support does not fail politely — the route simply is not
  // registered. This is what every bsky.social account gets, and it is the single most
  // likely thing to happen to someone following the README.
  if (status === 404 || code === 'MethodNotImplemented' || /Cannot (GET|POST)/i.test(raw)) {
    return {
      headline:
        'Your server does not support spaces yet. Hyperlocal needs an account on a PDS running the atproto spaces alpha — a bsky.social account will not work.',
      detail,
    };
  }

  if (code === 'BadJwt' || /delegation token/i.test(raw)) {
    return {
      headline:
        'Your server could not verify who you are. This usually means it cannot reach plc.directory to look up identities.',
      detail,
    };
  }

  if (/non-unicast|Hostname resolved/i.test(raw)) {
    return {
      headline:
        'Your server refused to fetch from the address it was given. A PDS on a private network needs SSRF protection disabled to talk to itself.',
      detail,
    };
  }

  if (code === 'SpaceNotFound' || /space not found/i.test(raw)) {
    return {
      headline:
        'That space does not exist. If you followed an invite link, ask whoever sent it to check it — a space belongs to its owner, and the link carries their identity.',
      detail,
    };
  }

  if (status === 401 || status === 403 || code === 'AuthMissing' || /not a member/i.test(raw)) {
    return {
      headline:
        'You are signed in, but not allowed into this space. The owner has to add you to its member list before you can read it.',
      detail,
    };
  }

  // No status at all normally means fetch itself failed: wrong host, server down, or —
  // on a private network — simply not connected to it.
  if (status === 0 && /fetch|network|load failed/i.test(raw)) {
    return {
      headline:
        'Could not reach your server. Check it is running, and that you are on the same network as it if it is a private one.',
      detail,
    };
  }

  return { headline: 'Could not open your space.', detail };
}

/** The same treatment for the redirect back from the authorization server. */
export function explainSignInFailure(error: unknown): Explained {
  const raw = error instanceof Error ? error.message : String(error);

  if (/invalid_scope/i.test(raw)) {
    return {
      headline:
        'Your server rejected the permissions this app asks for. Hyperlocal’s lexicons have to be published and resolvable before a space scope can be granted.',
      detail: raw,
    };
  }

  if (/access_denied/i.test(raw)) {
    return { headline: 'Sign-in was cancelled.', detail: raw };
  }

  if (/resolve|handle|did/i.test(raw)) {
    return {
      headline: 'That handle could not be resolved. Check the spelling, and that its DNS record exists.',
      detail: raw,
    };
  }

  return { headline: 'Sign in failed.', detail: raw };
}
