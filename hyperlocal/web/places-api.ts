import { resolveBase } from '../shared/places-config.js';
import type { PlaceCandidate } from '../shared/types.js';

const BASE: string | null = resolveBase(import.meta.env.VITE_PLACES_URL, import.meta.env.DEV);

interface PlaceResponse {
  candidates?: PlaceCandidate[];
  cached?: boolean;
  degraded?: boolean;
}

export interface PlaceLookup {
  candidates: PlaceCandidate[];
  /** True when the proxy could not reach Overpass. The UI says so rather than
   * pretending there is nothing here. */
  degraded: boolean;
}

const EMPTY: PlaceLookup = { candidates: [], degraded: true };

async function get(path: string, params: Record<string, string>): Promise<PlaceLookup> {
  if (BASE === null) return EMPTY;
  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  try {
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    if (!response.ok) return EMPTY;
    const body = (await response.json()) as PlaceResponse;
    return { candidates: body.candidates ?? [], degraded: body.degraded === true };
  } catch {
    // The proxy being down must never stop a note being written; the compose form
    // falls back to a plain pin.
    return EMPTY;
  }
}

/**
 * Businesses near a point, with stable OSM ids.
 *
 * Called when the compose panel opens and at no other time. Overpass's public
 * instances budget a few hundred moderate queries a day, so calling this on pan or
 * zoom would burn the budget in a minute and is the one thing not to do.
 */
export function nearbyPlaces(lat: number, lng: number): Promise<PlaceLookup> {
  return get('/places/nearby', { lat: String(lat), lng: String(lng) });
}

/** Search by name, biased to where the map is looking. */
export function searchPlaces(q: string, lat?: number, lng?: number): Promise<PlaceLookup> {
  const params: Record<string, string> = { q };
  if (lat !== undefined && lng !== undefined) {
    params.lat = String(lat);
    params.lng = String(lng);
  }
  return get('/places/search', params);
}
