import { BrowserOAuthClient, type OAuthSession } from '@atproto/oauth-client-browser';
import { OAUTH_SCOPE } from '../shared/scope.js';

export { OAUTH_SCOPE };

/**
 * atproto's browser OAuth accepts only `127.0.0.1` and `[::1]` as loopback origins —
 * `localhost` is redirected to the IP, which loses anything already in storage. Vite
 * is configured to bind the address it wants; this is the check that says so loudly if
 * that ever changes.
 */
function isLoopback(origin: string): boolean {
  const { hostname } = new URL(origin);
  return hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1' || hostname === 'localhost';
}

function clientMetadata() {
  const origin = window.location.origin;
  const redirectUri = `${origin}/`;

  if (isLoopback(origin)) {
    // Loopback client: the client_id carries its own metadata, so there is nothing to
    // host during development.
    return {
      client_id: `http://localhost?redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(OAUTH_SCOPE)}`,
      client_name: 'Hyperlocal (dev)',
      redirect_uris: [redirectUri] as [string, ...string[]],
      scope: OAUTH_SCOPE,
      grant_types: ['authorization_code', 'refresh_token'] as ['authorization_code', 'refresh_token'],
      response_types: ['code'] as ['code'],
      token_endpoint_auth_method: 'none' as const,
      application_type: 'web' as const,
      dpop_bound_access_tokens: true,
    };
  }

  // In production the client_id must be a public HTTPS URL serving this same document.
  // scripts/client-metadata.mjs writes it into the build.
  return {
    client_id: `${origin}/client-metadata.json`,
    client_name: 'Hyperlocal',
    client_uri: origin,
    redirect_uris: [redirectUri] as [string, ...string[]],
    scope: OAUTH_SCOPE,
    grant_types: ['authorization_code', 'refresh_token'] as ['authorization_code', 'refresh_token'],
    response_types: ['code'] as ['code'],
    token_endpoint_auth_method: 'none' as const,
    application_type: 'web' as const,
    dpop_bound_access_tokens: true,
  };
}

export interface AuthState {
  client: BrowserOAuthClient;
  session: OAuthSession | null;
}

/**
 * Set up OAuth and pick up any session already stored, or the one just returned from a
 * redirect. Returns a null session when nobody is signed in — the app then runs in
 * demo mode rather than showing a wall.
 */
export async function initAuth(handleResolver = 'https://bsky.social'): Promise<AuthState> {
  const client = new BrowserOAuthClient({
    clientMetadata: clientMetadata(),
    handleResolver,
    // Dev runs over plain http on the loopback address.
    allowHttp: isLoopback(window.location.origin),
  });
  const result = await client.init();
  return { client, session: result?.session ?? null };
}

export async function signIn(client: BrowserOAuthClient, handle: string): Promise<never> {
  // Never returns: it navigates away to the authorization server.
  await client.signIn(handle.trim(), { scope: OAUTH_SCOPE });
  throw new Error('unreachable');
}
