import { dim, type BoxSpec } from './types.js';

/**
 * The box catalogue.
 *
 * Two of the systems behave differently enough that the difference is modelled
 * rather than glossed over:
 *
 *  - Attached-lid containers (Gatortote / Totebox / Exporta and friends) are all
 *    built on the Euro footprint — 600×400 or 400×300 — and simply sit on top of
 *    one another. Footprints are published and reliable; heights vary a little by
 *    brand because most are slightly conical for nesting, and the quoted height
 *    usually includes the lid.
 *
 *  - DeWalt TOUGHSYSTEM 2.0 boxes share a 554×371 mm footprint and latch together,
 *    so a stack travels as one rigid unit.
 *
 * Everything else — the cool box, the folded camp table — is an ordinary object that
 * sits where you put it and can have things stacked on it.
 *
 * Weights are approximate empty weights and are marked as such — they only affect
 * the total and centre-of-gravity readouts, not whether anything fits.
 */

const ALC_GROUP_600 = 'alc-600x400';
const ALC_GROUP_400 = 'alc-400x300';
const TS2_GROUP = 'toughsystem-2';

const ALC_COLOUR = '#4a7fb5';
const ALC_SMALL_COLOUR = '#6f9fd0';
const TS2_COLOUR = '#d8a51d';
const CAMPING_COLOUR = '#5f9e6e';

function alc600(id: string, height: number, capacityL: number, emptyKg: number): BoxSpec {
  return {
    id,
    system: 'Attached-lid container',
    name: `ALC 600×400×${height} (${capacityL} L)`,
    width: dim(600, 'published', 'Euro footprint — reliable across brands.'),
    depth: dim(400, 'published', 'Euro footprint — reliable across brands.'),
    height: dim(height, 'published', 'Overall height with the lid closed. Brands vary by a few mm.'),
    emptyWeightKg: dim(emptyKg, 'estimated', 'Typical polypropylene ALC empty weight.'),
    capacityL,
    stackMode: 'friction',
    stackGroup: ALC_GROUP_600,
    colour: ALC_COLOUR,
  };
}

function alc400(id: string, height: number, capacityL: number, emptyKg: number): BoxSpec {
  return {
    id,
    system: 'Attached-lid container',
    name: `ALC 400×300×${height} (${capacityL} L)`,
    width: dim(400, 'published', 'Euro half-footprint.'),
    depth: dim(300, 'published', 'Euro half-footprint.'),
    height: dim(height, 'estimated', 'Overall height with the lid closed.'),
    emptyWeightKg: dim(emptyKg, 'estimated', 'Typical polypropylene ALC empty weight.'),
    capacityL,
    stackMode: 'friction',
    stackGroup: ALC_GROUP_400,
    colour: ALC_SMALL_COLOUR,
  };
}

function toughSystem(id: string, name: string, height: number, emptyKg: number): BoxSpec {
  return {
    id,
    system: 'DeWalt TOUGHSYSTEM 2.0',
    name,
    width: dim(554, 'published', 'TOUGHSYSTEM 2.0 common footprint — every box in the range shares it.'),
    depth: dim(371, 'published', 'TOUGHSYSTEM 2.0 common footprint.'),
    height: dim(height, 'published', 'Retailer-listed external height.'),
    emptyWeightKg: dim(emptyKg, 'estimated', 'Approximate empty weight.'),
    stackMode: 'latching',
    stackGroup: TS2_GROUP,
    colour: TS2_COLOUR,
  };
}

export const CATALOGUE: BoxSpec[] = [
  // --- Attached-lid containers, 600×400 -------------------------------------
  alc600('alc-600-250', 250, 46, 2.2),
  alc600('alc-600-300', 300, 56, 2.5),
  alc600('alc-600-340', 340, 60, 2.7),
  alc600('alc-600-370', 370, 66, 2.9),
  alc600('alc-600-400', 400, 76, 3.2),

  // --- Attached-lid containers, 400×300 -------------------------------------
  alc400('alc-400-220', 220, 18, 1.1),
  alc400('alc-400-280', 280, 24, 1.4),

  // --- DeWalt TOUGHSYSTEM 2.0 -----------------------------------------------
  toughSystem('ts2-ds166', 'TOUGHSYSTEM 2.0 DS166 (shallow)', 178, 4.0),
  toughSystem('ts2-ds300', 'TOUGHSYSTEM 2.0 DS300 (medium)', 313, 5.5),
  toughSystem('ts2-ds400', 'TOUGHSYSTEM 2.0 DS400 (deep)', 400, 6.6),

  // --- Camping gear ---------------------------------------------------------
  {
    id: 'coleman-pro-25qt',
    system: 'Camping gear',
    name: 'Coleman Pro 25QT cool box',
    // Coleman's own spec, converted from 17.32 x 13.58 x 17.52 in. Retailers round
    // this to 450 x 350 x 450, which is close enough not to matter but explains the
    // discrepancy if you go looking.
    width: dim(440, 'published', "Coleman spec. Some retailers round it to 450 mm."),
    depth: dim(345, 'published', "Coleman spec. Some retailers round it to 350 mm."),
    height: dim(
      445,
      'published',
      'The tallest single item in this catalogue — taller than a DS400, so it is ' +
        'usually what decides how much you can stack.',
    ),
    emptyWeightKg: dim(5, 'published', 'Empty. Add ice and contents in the inspector.'),
    capacityL: 24,
    stackMode: 'friction',
    stackGroup: 'coleman-pro',
    colour: CAMPING_COLOUR,
  },
  {
    id: 'camp-table-folded',
    system: 'Camping gear',
    name: 'Camp table (folded)',
    // Folded size of the Hi-Gear Storage Table at Go Outdoors, which matches the
    // "folds in half like a suitcase" shape. Override these per box once you have
    // measured your own — there are a dozen similar tables and they all differ.
    width: dim(625, 'estimated', 'Folded. Based on the Hi-Gear Storage Table — measure yours.'),
    depth: dim(625, 'estimated', 'Folded. Based on the Hi-Gear Storage Table — measure yours.'),
    height: dim(70, 'estimated', 'Thickness of the folded slab.'),
    emptyWeightKg: dim(4.5, 'estimated'),
    // A rigid flat slab, so it makes a decent base to stack on.
    stackMode: 'friction',
    stackGroup: 'camp-table',
    colour: '#7fb98c',
  },

  // --- A generic box, for anything not in the list ---------------------------
  {
    id: 'custom',
    system: 'Custom',
    name: 'Custom box',
    width: dim(500, 'estimated'),
    depth: dim(350, 'estimated'),
    height: dim(300, 'estimated'),
    emptyWeightKg: dim(2, 'estimated'),
    stackMode: 'friction',
    stackGroup: 'custom',
    colour: '#8d8d96',
  },
];

export const CATALOGUE_BY_ID = new Map(CATALOGUE.map((spec) => [spec.id, spec]));

export function specById(id: string): BoxSpec {
  const spec = CATALOGUE_BY_ID.get(id);
  if (!spec) throw new Error(`Unknown box spec: ${id}`);
  return spec;
}

/** Catalogue grouped by system, for the picker UI. */
export function catalogueBySystem(): Map<string, BoxSpec[]> {
  const grouped = new Map<string, BoxSpec[]>();
  for (const spec of CATALOGUE) {
    const list = grouped.get(spec.system) ?? [];
    list.push(spec);
    grouped.set(spec.system, list);
  }
  return grouped;
}
