import { dim, type Anchor, type FloorObstruction, type VehicleProfile } from './types.js';

/**
 * VW Caddy Maxi Life, Typ 2K (2010–2015 shape), third row removed, second row up.
 *
 * Where these numbers come from, because it decides how much to trust the tool:
 *
 * VW published load-compartment dimensions for the Caddy *van*, and those turn out to
 * be the wrong figures for a Life. The van numbers are bare metal between the panels;
 * a Life is trimmed, and the trim is what you actually load against. VW's 1552 mm
 * "maximum load width" is not available to you at any height.
 *
 * So the bay dimensions here come from kofferraum.org's measured drawing of the 2010
 * Maxi 3-row (`reference`), which measures the usable box rather than the shell. It
 * gives a load bay that is essentially parallel-sided at about 1120 mm — the side trim
 * runs roughly flush with the tops of the wheel arches, so the arches do not eat into
 * anything the trim has not already taken.
 *
 * That drawing gives all three seat configurations. Only the middle one is modelled
 * here, but the others are worth knowing:
 *   - 620 mm behind the third row, all seven seats up
 *   - 1540 mm behind the second row, third row out  ← this profile
 *   - 1910 mm behind the front seats, second row folded too
 *
 * What is still guesswork: the tailgate aperture, the wheel arch dimensions (which no
 * longer affect anything, since the trim binds first) and the third-row rails. Those
 * are marked `estimated` and want a tape measure.
 */
export const CADDY_MAXI_LIFE_2K: VehicleProfile = {
  id: 'caddy-maxi-life-2k',
  name: 'Caddy Maxi Life (2K, 2010–2015)',
  description:
    'Third row removed, second row upright. Bay dimensions are kofferraum.org measured ' +
    'figures for the 2010 Maxi 3-row — the usable trimmed space, not VW van shell ' +
    'figures. The tailgate opening and the third-row rails are still estimates. Yours ' +
    'is a 64 plate, so this is the pre-facelift shape.',
  rearDoors: 'tailgate',

  floorLength: dim(
    1540,
    'reference',
    'Second-row seat backs to the load lip with the third row out. kofferraum.org ' +
      'measured 154 cm. For comparison: 62 cm with all seven seats up, 191 cm with the ' +
      'second row folded as well.',
  ),
  floorWidth: dim(
    1120,
    'reference',
    "Usable width between the side trim. VW's 1552 mm is bare metal in a van and is not " +
      'available in a trimmed Life.',
  ),
  widthBetweenArches: dim(
    1120,
    'reference',
    'The same as the floor width: the trim runs roughly flush with the arch tops, so ' +
      'the arches take nothing the trim has not already taken.',
  ),
  loadHeight: dim(
    1130,
    'reference',
    "Floor to roof lining. VW's 1262 mm is the van's bare shell height.",
  ),

  archHeight: dim(340, 'estimated', 'Floor to the top of the wheel arch box.'),
  archIntrusion: dim(
    0,
    'reference',
    'Nil: the arches sit behind trim that is already the narrowest point. Set this ' +
      'above zero only if your arches actually stand proud of the side trim.',
  ),
  archLength: dim(700, 'estimated', 'Fore-aft length of the arch box.'),
  archStartY: dim(400, 'estimated', 'Seat backs to the front face of the arch.'),

  widthAtRoof: dim(
    1110,
    'reference',
    'Barely narrower than the floor — this is a van body, so the sides are close to ' +
      'vertical rather than tumbling in like a car.',
  ),

  apertureWidth: dim(1100, 'estimated', 'Clear width of the tailgate opening, between the D-pillars.'),
  apertureHeight: dim(1050, 'estimated', 'Clear height of the tailgate opening.'),
  sillHeight: dim(
    590,
    'reference',
    'Ground to the load lip. There is also a 2 cm step up from the lip to the boot floor.',
  ),

  seatBackRake: dim(12, 'estimated', 'Degrees off vertical, leaning forwards.'),

  payloadKg: dim(600, 'estimated', 'Check the plate in your door shut for the real figure.'),

  anchors: factoryAnchors(1540, 1120),
  floorObstructions: thirdRowRails(1540),
};

/**
 * The six factory floor lashing eyes. Two rows of two down the sides plus a pair
 * at the rear. Positions are estimated from the load bay proportions — correct them
 * in the calibrate panel to match where yours actually are.
 */
function factoryAnchors(floorLength: number, floorWidth: number): Anchor[] {
  const sideX = floorWidth / 2 - 40;
  const rearX = floorWidth / 2 - 120;

  return [
    { id: 'eye-fl', label: 'Front left', x: -sideX, y: 90, z: 0, kind: 'factory-eye', ratingKg: 200 },
    { id: 'eye-fr', label: 'Front right', x: sideX, y: 90, z: 0, kind: 'factory-eye', ratingKg: 200 },
    { id: 'eye-ml', label: 'Mid left', x: -sideX, y: floorLength * 0.55, z: 0, kind: 'factory-eye', ratingKg: 200 },
    { id: 'eye-mr', label: 'Mid right', x: sideX, y: floorLength * 0.55, z: 0, kind: 'factory-eye', ratingKg: 200 },
    { id: 'eye-rl', label: 'Rear left', x: -rearX, y: floorLength - 90, z: 0, kind: 'factory-eye', ratingKg: 200 },
    { id: 'eye-rr', label: 'Rear right', x: rearX, y: floorLength - 90, z: 0, kind: 'factory-eye', ratingKg: 200 },
  ];
}

/**
 * The rails the third row mounts to, which stay in the floor once the seats come out.
 *
 * These are estimates, and the reasoning is written down so you can check it rather
 * than take it on faith: the third row leaves 620 mm of boot behind it, so its seat
 * back sits at y ≈ 920, and a bench base around 400 mm deep puts its mountings across
 * roughly y 520–950. Hence a 430 mm rail centred at y = 735.
 *
 * Two parallel rails of the same height are not necessarily a problem — a crate
 * straddling both sits level, just raised. It is a crate caught on one of them that
 * rocks. `fit.ts` makes that distinction.
 */
function thirdRowRails(floorLength: number): FloorObstruction[] {
  const centre = floorLength - 805; // 620 behind the third row, minus half the rail

  return [
    { id: 'rail-l', label: 'Third-row rail (left)', x: -330, y: centre, width: 60, depth: 430, height: 25 },
    { id: 'rail-r', label: 'Third-row rail (right)', x: 330, y: centre, width: 60, depth: 430, height: 25 },
  ];
}

export const VEHICLE_PRESETS: VehicleProfile[] = [CADDY_MAXI_LIFE_2K];

/** Deep clone so edits in the calibrate panel never mutate the shipped preset. */
export function cloneProfile(profile: VehicleProfile): VehicleProfile {
  return structuredClone(profile);
}
