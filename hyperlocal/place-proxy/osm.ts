import { distanceMetres } from '../shared/geo.js';
import type { PlaceCandidate } from '../shared/types.js';

/**
 * The OSM tags that mean "a business a person would write a note about". Deliberately
 * not exhaustive: adding highway or building would bury the café in street segments.
 */
export const PLACE_TAGS = ['amenity', 'shop', 'tourism', 'leisure', 'office', 'craft'];

/**
 * Default search radius. Wide enough to catch the shop you tapped, tight enough not to
 * return the whole parade.
 */
export const DEFAULT_RADIUS_M = 60;

/**
 * Build an Overpass QL query for named places around a point.
 *
 * `nwr` covers nodes, ways and relations in one pass — a shop can be mapped as any of
 * the three — and `out center` gives ways and relations a single coordinate so the
 * caller doesn't have to reduce a polygon.
 */
export function overpassQuery(lat: number, lng: number, radius = DEFAULT_RADIUS_M): string {
  const clauses = PLACE_TAGS.map(
    (tag) => `nwr(around:${radius},${lat},${lng})["${tag}"]["name"];`,
  ).join('\n  ');
  return `[out:json][timeout:20];\n(\n  ${clauses}\n);\nout center tags;`;
}

interface OverpassElement {
  type?: string;
  id?: number | string;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
}

/**
 * Turn an Overpass response into candidates, nearest first.
 *
 * Anything without a name, a usable coordinate or a recognised id is dropped rather
 * than half-rendered: a candidate the user cannot meaningfully attach a note to is
 * worse than one fewer option.
 */
export function parseOverpass(
  body: unknown,
  lat: number,
  lng: number,
  limit = 12,
): PlaceCandidate[] {
  const elements = (body as { elements?: unknown })?.elements;
  if (!Array.isArray(elements)) return [];

  const candidates: PlaceCandidate[] = [];
  for (const raw of elements as OverpassElement[]) {
    const name = raw?.tags?.name;
    if (!name) continue;

    const osmType = normaliseOsmType(raw.type);
    if (!osmType) continue;
    // Ids arrive as JSON numbers and are kept as strings from here on, because they
    // are already past 2^32 and a float would eventually lose the last digits.
    if (raw.id === undefined || !/^\d+$/.test(String(raw.id))) continue;

    const pLat = raw.lat ?? raw.center?.lat;
    const pLng = raw.lon ?? raw.center?.lon;
    if (!Number.isFinite(pLat) || !Number.isFinite(pLng)) continue;

    const candidate: PlaceCandidate = {
      osmType,
      osmId: String(raw.id),
      name,
      lat: pLat as number,
      lng: pLng as number,
      distance: distanceMetres(lat, lng, pLat as number, pLng as number),
    };
    const category = primaryCategory(raw.tags ?? {});
    if (category) candidate.category = category;
    candidates.push(candidate);
  }

  return dedupe(candidates)
    .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity))
    .slice(0, limit);
}

/** The `key=value` of the first recognised place tag, e.g. `amenity=cafe`. */
export function primaryCategory(tags: Record<string, string>): string | undefined {
  for (const tag of PLACE_TAGS) {
    const value = tags[tag];
    if (typeof value === 'string' && value !== '' && value !== 'no') {
      return `${tag}=${value}`;
    }
  }
  return undefined;
}

function normaliseOsmType(value: unknown): PlaceCandidate['osmType'] | undefined {
  switch (value) {
    // Overpass spells them out; Photon uses single letters.
    case 'node':
    case 'N':
      return 'node';
    case 'way':
    case 'W':
      return 'way';
    case 'relation':
    case 'R':
      return 'relation';
    default:
      return undefined;
  }
}

/** Photon is the OSM geocoder built for as-you-type; Nominatim's policy forbids it. */
export function photonUrl(query: string, lat?: number, lng?: number, limit = 8): string {
  const url = new URL('https://photon.komoot.io/api');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(limit));
  // Biasing to the map centre is what makes this hyperlocal rather than global.
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lon', String(lng));
  }
  return url.toString();
}

interface PhotonFeature {
  geometry?: { coordinates?: unknown };
  properties?: Record<string, unknown>;
}

export function parsePhoton(body: unknown): PlaceCandidate[] {
  const features = (body as { features?: unknown })?.features;
  if (!Array.isArray(features)) return [];

  const candidates: PlaceCandidate[] = [];
  for (const feature of features as PhotonFeature[]) {
    const props = feature?.properties ?? {};
    const name = typeof props.name === 'string' ? props.name : undefined;
    if (!name) continue;

    const coords = feature?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    // GeoJSON is [longitude, latitude]. Getting this the wrong way round puts
    // everything in the sea, so it is worth naming.
    const [lng, lat] = coords as [unknown, unknown];
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const candidate: PlaceCandidate = { name, lat: lat as number, lng: lng as number };
    const osmType = normaliseOsmType(props.osm_type);
    if (osmType && /^\d+$/.test(String(props.osm_id))) {
      candidate.osmType = osmType;
      candidate.osmId = String(props.osm_id);
    }
    if (typeof props.osm_key === 'string' && typeof props.osm_value === 'string') {
      candidate.category = `${props.osm_key}=${props.osm_value}`;
    }
    candidates.push(candidate);
  }
  return dedupe(candidates);
}

/** Overpass can return the same feature once per matching tag clause. */
function dedupe(candidates: PlaceCandidate[]): PlaceCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((c) => {
    const key = c.osmId ? `${c.osmType}/${c.osmId}` : `${c.name}@${c.lat},${c.lng}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
