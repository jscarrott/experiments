import type { Aabb, VehicleProfile } from '../model/types.js';

/**
 * The load bay, as pure geometry. No Three.js here — the scene layer consumes this.
 *
 * The central idea: rather than treat the bay as a bounding box, we describe the
 * *available half-width at a given height and distance back*. That single function is
 * what makes the fit checks honest, because it captures both ways a bay narrows —
 * wheel arches eating into the lower sides, and walls leaning in as they rise — and
 * reports whichever binds over the span a given box actually occupies.
 *
 * Which of the two binds is a property of the vehicle, not a constant. On a van the
 * arches usually win; on a trimmed Caddy Life the side trim is already narrower than
 * the arches everywhere, so they never do. A check written around one headline width
 * gets the other case confidently wrong.
 */

/** Half the available width at height z and distance y back from the seats. */
export function halfWidthAt(profile: VehicleProfile, z: number, y: number): number {
  const floorHalf = profile.floorWidth.value / 2;
  const roofHalf = profile.widthAtRoof.value / 2;
  const archHeight = profile.archHeight.value;
  const loadHeight = profile.loadHeight.value;

  if (z < 0 || z > loadHeight) return 0;

  // Wall lean is measured from the floor to the roof, and applies at every height.
  const leanT = clamp(z / loadHeight, 0, 1);
  const wallHalf = floorHalf + (roofHalf - floorHalf) * leanT;

  // Below the top of the arch, and within its fore-aft extent, the arch wins.
  if (z < archHeight && withinArch(profile, y)) {
    return Math.min(wallHalf, profile.widthBetweenArches.value / 2);
  }
  return wallHalf;
}

/** Is this distance back from the seats within the fore-aft extent of the wheel arch? */
export function withinArch(profile: VehicleProfile, y: number): boolean {
  const start = profile.archStartY.value;
  const end = start + profile.archLength.value;
  return y >= start && y <= end;
}

/**
 * The narrowest half-width an object spanning the given ranges has to live within.
 * Sampled rather than solved analytically: the profile is piecewise and sampling at
 * 10 mm is both plainly correct and fast enough to run on every drag frame.
 */
export function minHalfWidthOver(
  profile: VehicleProfile,
  zMin: number,
  zMax: number,
  yMin: number,
  yMax: number,
  step = 10,
): number {
  let smallest = Infinity;
  for (let z = zMin; z <= zMax + 1e-9; z = Math.min(z + step, zMax)) {
    for (let y = yMin; y <= yMax + 1e-9; y = Math.min(y + step, yMax)) {
      smallest = Math.min(smallest, halfWidthAt(profile, z, y));
      if (y >= yMax) break;
    }
    if (z >= zMax) break;
  }
  return smallest === Infinity ? 0 : smallest;
}

/** The overall bounding box of the load bay, for camera framing and the floor grid. */
export function shellBounds(profile: VehicleProfile): Aabb {
  const half = profile.floorWidth.value / 2;
  return {
    minX: -half,
    maxX: half,
    minY: 0,
    maxY: profile.floorLength.value,
    minZ: 0,
    maxZ: profile.loadHeight.value,
  };
}

/**
 * Cross-sections up the bay, for building the rendered shell. Each is the half-width
 * at that height clear of the arches, since the arches are drawn as their own solids.
 */
export function wallSections(profile: VehicleProfile, steps = 12): { z: number; halfWidth: number }[] {
  const sections: { z: number; halfWidth: number }[] = [];
  const loadHeight = profile.loadHeight.value;
  for (let i = 0; i <= steps; i++) {
    const z = (loadHeight * i) / steps;
    // Sample outside the arch so this describes the wall itself.
    const y = profile.archStartY.value - 1;
    sections.push({ z, halfWidth: halfWidthAt(profile, z, Math.max(y, 0)) });
  }
  return sections;
}

/**
 * Bounding boxes of the two wheel arches, for rendering and clash checks.
 *
 * Returns nothing when the arches do not stand proud of the side trim, which is the
 * case on a trimmed Caddy Life. Zero-width solids would otherwise be built and drawn,
 * and a clash test against a zero-width box is meaningless anyway.
 */
export function archBoxes(profile: VehicleProfile): Aabb[] {
  const outer = profile.floorWidth.value / 2;
  const inner = profile.widthBetweenArches.value / 2;
  if (outer - inner < ARCH_MIN_INTRUSION) return [];
  const y0 = profile.archStartY.value;
  const y1 = y0 + profile.archLength.value;
  const h = profile.archHeight.value;

  return [
    { minX: -outer, maxX: -inner, minY: y0, maxY: y1, minZ: 0, maxZ: h },
    { minX: inner, maxX: outer, minY: y0, maxY: y1, minZ: 0, maxZ: h },
  ];
}

/** Bounding boxes of whatever is proud of the floor — on a Life, the third-row rails. */
export function obstructionBoxes(profile: VehicleProfile): (Aabb & { label: string; id: string })[] {
  return profile.floorObstructions.map((o) => ({
    id: o.id,
    label: o.label,
    minX: o.x - o.width / 2,
    maxX: o.x + o.width / 2,
    minY: o.y - o.depth / 2,
    maxY: o.y + o.depth / 2,
    minZ: 0,
    maxZ: o.height,
  }));
}

/** Below this, an arch is flush with the trim and not worth modelling as a solid. */
const ARCH_MIN_INTRUSION = 5;

export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}
