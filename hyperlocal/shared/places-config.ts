export const DEV_PLACES_URL = 'http://127.0.0.1:8787';

/**
 * Decide where the OSM proxy lives, or that there isn't one.
 *
 * In dev it is a separate port on the loopback address. In a production build it must be
 * configured explicitly: falling back to a plaintext loopback URL from a page served over
 * HTTPS is mixed content, which the browser blocks outright — so every compose would burn
 * a guaranteed-failed request before showing the plain-pin message it was going to show
 * anyway.
 *
 * `null` means "there is no proxy": the lookup is skipped entirely and compose goes
 * straight to a plain pin. That is a perfectly usable app, and it is what gets deployed
 * until the proxy is hosted somewhere.
 *
 * It lives in shared/ rather than beside the fetch code because shared/ touches no build
 * constants, so both branches can be unit-tested — not just whichever one the build the
 * tests happen to run against took.
 */
export function resolveBase(configured: string | undefined, isDev: boolean): string | null {
  if (configured) return configured;
  return isDev ? DEV_PLACES_URL : null;
}
