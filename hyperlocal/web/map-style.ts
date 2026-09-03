/**
 * The colours the map paints notes with, and the key that explains them.
 *
 * Kept apart from map.ts so it can be read without pulling in MapLibre — and so the
 * legend and the paint expression are built from the same constants. A map with a
 * five-way colour code and no key is a map that only its author can read, and a key that
 * has drifted from the map is worse than none.
 */
export const PLACE_GOOD = '#5ad1a8';
export const PLACE_FAIR = '#e0a33a';
export const PLACE_POOR = '#e05a5a';
export const PLACE_UNRATED = '#6b7285';
export const NOTE_PIN = '#8ab4f8';

/** Rating boundaries, shared with the labels below so the two cannot disagree. */
export const FAIR_FROM = 2.5;
export const GOOD_FROM = 3.5;

/** The `circle-color` expression for grouped places. */
export function placeCircleColour(): unknown[] {
  return [
    'case',
    ['==', ['get', 'rated'], false], PLACE_UNRATED,
    ['<', ['get', 'rating'], FAIR_FROM], PLACE_POOR,
    ['<', ['get', 'rating'], GOOD_FROM], PLACE_FAIR,
    PLACE_GOOD,
  ];
}

export interface KeyEntry {
  colour: string;
  label: string;
  /** A business is drawn as a ring around the basemap's own icon; a loose note as a dot. */
  shape: 'ring' | 'dot';
}

export const MAP_KEY: KeyEntry[] = [
  { colour: PLACE_GOOD, label: `Rated ${GOOD_FROM} and up`, shape: 'ring' },
  { colour: PLACE_FAIR, label: `Rated ${FAIR_FROM} to ${GOOD_FROM}`, shape: 'ring' },
  { colour: PLACE_POOR, label: `Rated under ${FAIR_FROM}`, shape: 'ring' },
  { colour: PLACE_UNRATED, label: 'Written about, but not rated', shape: 'ring' },
  { colour: NOTE_PIN, label: 'A dropped pin, not a business', shape: 'dot' },
];

/** Every colour the map can paint a feature. Used by the drift test. */
export function paintedColours(): string[] {
  const found = new Set<string>([NOTE_PIN]);
  const walk = (node: unknown): void => {
    if (typeof node === 'string' && /^#[0-9a-f]{6}$/i.test(node)) found.add(node);
    else if (Array.isArray(node)) node.forEach(walk);
  };
  walk(placeCircleColour());
  return [...found];
}
