import { dim, type Anchor, type FloorObstruction, type VehicleProfile } from './types.js';

/**
 * VW Caddy Maxi Life, Typ 2K (2010–2015 shape), third row removed, second row up.
 *
 * A word on where these numbers come from, because it matters:
 *
 * VW published load-compartment dimensions for the Caddy *van*, not for the Life
 * with its second-row seats in place. The width figures carry over — the body is
 * the same shell — but the load *length* does not, because the van measures from
 * the bulkhead and the Life measures from the back of the second row.
 *
 * So: widths and heights are `published`, the arch intrusion is `derived` from two
 * published widths, and the lengths are `derived` from Parkers' quoted 1.6 m³ /
 * 3.9 m³ load volumes. The aperture and sill are frankly `estimated`.
 *
 * Anything not marked `published` wants twenty minutes with a tape measure, and
 * the Calibrate panel exists so you can put your own numbers in. The tool is only
 * as good as these values.
 */
export const CADDY_MAXI_LIFE_2K: VehicleProfile = {
  id: 'caddy-maxi-life-2k',
  name: 'Caddy Maxi Life (2K, 2010–2015)',
  description:
    'Third row removed, second row upright. Widths are VW published figures for the ' +
    'Caddy 2K bodyshell; lengths are derived from quoted load volumes and should be ' +
    'measured. Yours is a 64 plate, so this is the pre-facelift shape.',
  rearDoors: 'tailgate',

  floorLength: dim(
    1100,
    'derived',
    'From the 1.6 m³ quoted with the third row out, divided by the average usable ' +
      'cross-section. Measure seat-back to load lip and correct this first — every ' +
      'other check depends on it.',
  ),
  floorWidth: dim(1552, 'published', 'VW maximum load width, Caddy 2K.'),
  widthBetweenArches: dim(1172, 'published', 'VW figure, Caddy 2K.'),
  loadHeight: dim(1262, 'published', 'VW maximum load height, Maxi. Floor to roof lining at the highest point.'),

  archHeight: dim(340, 'estimated', 'Floor to the top of the wheel arch box.'),
  archIntrusion: dim(
    190,
    'derived',
    'Half the difference between max load width and width between arches: (1552 − 1172) / 2.',
  ),
  archLength: dim(700, 'estimated', 'Fore-aft length of the arch box.'),
  archStartY: dim(150, 'estimated', 'Seat backs to the front face of the arch.'),

  widthAtRoof: dim(
    1300,
    'estimated',
    'The side walls lean inwards as they rise. This is why a tall box that fits on ' +
      'the floor can still foul the trim at head height.',
  ),

  apertureWidth: dim(1220, 'estimated', 'Clear width of the tailgate opening.'),
  apertureHeight: dim(1100, 'estimated', 'Clear height of the tailgate opening.'),
  sillHeight: dim(600, 'estimated', 'Ground to the load lip. What you lift over.'),

  seatBackRake: dim(12, 'estimated', 'Degrees off vertical, leaning forwards.'),

  payloadKg: dim(600, 'estimated', 'Check the plate in your door shut for the real figure.'),

  anchors: factoryAnchors(1100, 1552, 1172),
  floorObstructions: thirdRowBrackets(1100),
};

/**
 * The six factory floor lashing eyes. Two rows of two down the sides plus a pair
 * at the rear. Positions are estimated from the load bay proportions — drag them
 * in the calibrate panel to match where yours actually are.
 */
function factoryAnchors(floorLength: number, floorWidth: number, betweenArches: number): Anchor[] {
  // Side eyes sit inboard of the trim; the rear pair sit just ahead of the load lip.
  const sideX = betweenArches / 2 - 40;
  const rearX = floorWidth / 2 - 180;

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
 * The third-row seat mounting brackets stay in the floor once the seats come out.
 * They are the reason a crate that "obviously fits" ends up rocking on one corner,
 * so they are modelled rather than ignored.
 */
function thirdRowBrackets(floorLength: number): FloorObstruction[] {
  const y = floorLength * 0.62;
  return [
    { id: 'bracket-l', label: 'Third-row bracket (left)', x: -420, y, width: 120, depth: 90, height: 25 },
    { id: 'bracket-r', label: 'Third-row bracket (right)', x: 420, y, width: 120, depth: 90, height: 25 },
  ];
}

export const VEHICLE_PRESETS: VehicleProfile[] = [CADDY_MAXI_LIFE_2K];

/** Deep clone so edits in the calibrate panel never mutate the shipped preset. */
export function cloneProfile(profile: VehicleProfile): VehicleProfile {
  return structuredClone(profile);
}
