/** A bounding box in degrees. West/east are longitudes, south/north latitudes. */
export interface Bbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export const MAX_LAT = 90;
export const MAX_LNG = 180;

/**
 * Parse a `community.lexicon.location.geo` coordinate.
 *
 * That lexicon stores latitude and longitude as strings, which is deliberate: it keeps
 * the exact decimal the writer meant rather than whatever a float round-trip produces.
 * We parse once, at the edge, and keep the string in the record untouched.
 *
 * Returns null rather than NaN for anything that isn't a finite number in range, so a
 * malformed record from another member is dropped instead of poisoning the map with a
 * NaN that compares false against every bbox.
 */
export function parseCoord(value: string, max: number): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  // Number() accepts hex, Infinity and whitespace-only; require plain decimal.
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(value.trim())) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) > max) return null;
  return n;
}

export function parseLatitude(value: string): number | null {
  return parseCoord(value, MAX_LAT);
}

export function parseLongitude(value: string): number | null {
  return parseCoord(value, MAX_LNG);
}

/** Format a number back to the string form the lexicon wants. */
export function formatCoord(n: number): string {
  // 7 decimal places is ~1cm; more is noise and makes records bigger for nothing.
  return String(Number(n.toFixed(7)));
}

/**
 * Is a point inside a bbox?
 *
 * Bboxes crossing the antimeridian are not supported — see `normaliseBbox`, which
 * rejects them. Handling the split is real work for a tool aimed at one town.
 */
export function inBbox(lat: number, lng: number, box: Bbox): boolean {
  return lat >= box.south && lat <= box.north && lng >= box.west && lng <= box.east;
}

/**
 * Clamp a bbox to the valid range and put the corners the right way round.
 * Returns null for a box that crosses the antimeridian, which we decline to handle.
 */
export function normaliseBbox(box: Bbox): Bbox | null {
  if (![box.west, box.south, box.east, box.north].every(Number.isFinite)) return null;
  if (box.east < box.west) return null; // crosses the antimeridian
  return {
    west: Math.max(box.west, -MAX_LNG),
    east: Math.min(box.east, MAX_LNG),
    south: Math.max(Math.min(box.south, box.north), -MAX_LAT),
    north: Math.min(Math.max(box.south, box.north), MAX_LAT),
  };
}

/** Grow a bbox by a fraction of its own size, so panning a little doesn't refetch. */
export function padBbox(box: Bbox, fraction: number): Bbox {
  const dLat = (box.north - box.south) * fraction;
  const dLng = (box.east - box.west) * fraction;
  return (
    normaliseBbox({
      west: box.west - dLng,
      east: box.east + dLng,
      south: box.south - dLat,
      north: box.north + dLat,
    }) ?? box
  );
}

const EARTH_RADIUS_M = 6_371_008.8;

/** Great-circle distance in metres. */
export function distanceMetres(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLng = (bLng - aLng) * toRad;
  const lat1 = aLat * toRad;
  const lat2 = bLat * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Round a coordinate to a cache cell. Used as the Overpass cache key, so two people
 * tapping the same shop reuse one upstream query.
 *
 * 4 decimal places is ~11m at the equator, which is about the granularity at which
 * "the same shopfront" stops being true.
 */
export function cacheCell(lat: number, lng: number, places = 4): string {
  return `${lat.toFixed(places)},${lng.toFixed(places)}`;
}
