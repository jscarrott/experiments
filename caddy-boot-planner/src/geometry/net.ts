import type { Aabb, Anchor, CargoNet, PlacedBox, Vec3 } from '../model/types.js';
import { aabbOf } from './boxes.js';
import type { SpecLookup } from './stacking.js';

/**
 * Draping an elasticated cargo net over the load.
 *
 * The model: a net clipped to a ring of anchors is a lattice of cords, and each cord
 * pulled tight between two anchors follows the *upper convex hull* of whatever is
 * underneath it. That is simply what a taut line does — it bridges from high point to
 * high point and never dips into a hollow.
 *
 * Which gives us the check that is genuinely hard to make by eye, and the reason this
 * module exists: a short box sitting between two tall ones has the net passing clean
 * over the top of it, touching nothing. It looks restrained. It is not. Under braking
 * it is the one that moves.
 *
 * So we compute each cord, find where it actually touches the load, and report any box
 * the net never lands on.
 */

/** A box top within this distance of a cord counts as held by it, mm. */
const CONTACT_TOLERANCE = 12;
/** Samples along each cord. 5 mm-ish resolution over a Caddy is plenty. */
const SAMPLES = 120;

export interface Cord {
  fromAnchorId: string;
  toAnchorId: string;
  /** The taut path, in vehicle coordinates. */
  points: Vec3[];
  /** Length along the path, mm. */
  length: number;
  /** Ids of boxes this cord bears down on. */
  touchingBoxIds: string[];
}

export interface NetResult {
  netId: string;
  cords: Cord[];
  /** Boxes the net touches somewhere. */
  heldBoxIds: Set<string>;
  /** Boxes under the net's span that it bridges over without touching. */
  bridgedBoxIds: Set<string>;
  /** Total cord length against the net's relaxed size. 1.0 = unstretched. */
  stretchRatio: number;
  overStretched: boolean;
}

/**
 * Height of the load at a point, ignoring a set of boxes if asked. Returns the top of
 * the tallest box covering that point, or 0 for bare floor.
 */
function loadHeightAt(x: number, y: number, boxes: { id: string; aabb: Aabb }[]): { z: number; boxId?: string } {
  let z = 0;
  let boxId: string | undefined;
  for (const { id, aabb } of boxes) {
    if (x < aabb.minX || x > aabb.maxX || y < aabb.minY || y > aabb.maxY) continue;
    if (aabb.maxZ > z) {
      z = aabb.maxZ;
      boxId = id;
    }
  }
  return boxId ? { z, boxId } : { z };
}

/**
 * Upper convex hull of a 2D profile — the taut-line shape. Andrew's monotone chain,
 * keeping only the upper side. Input must be sorted by t.
 */
export function upperHull(points: { t: number; z: number }[]): { t: number; z: number }[] {
  const hull: { t: number; z: number }[] = [];
  for (const p of points) {
    while (hull.length >= 2) {
      const a = hull[hull.length - 2]!;
      const b = hull[hull.length - 1]!;
      // Clockwise turn keeps the point; anticlockwise means b sags below the line a→p.
      const cross = (b.t - a.t) * (p.z - a.z) - (b.z - a.z) * (p.t - a.t);
      if (cross < 0) break;
      hull.pop();
    }
    hull.push(p);
  }
  return hull;
}

/** Interpolate a hull profile at parameter t. */
function hullHeightAt(hull: { t: number; z: number }[], t: number): number {
  for (let i = 0; i < hull.length - 1; i++) {
    const a = hull[i]!;
    const b = hull[i + 1]!;
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t;
      return span === 0 ? a.z : a.z + ((b.z - a.z) * (t - a.t)) / span;
    }
  }
  return hull[hull.length - 1]?.z ?? 0;
}

/** One taut cord between two anchors, over the current load. */
export function cordBetween(
  from: Anchor,
  to: Anchor,
  boxes: { id: string; aabb: Aabb }[],
): Cord {
  // Sample the terrain under the straight line between the anchors.
  const profile: { t: number; z: number }[] = [];
  const boxAtSample: (string | undefined)[] = [];

  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    const { z, boxId } = loadHeightAt(x, y, boxes);
    profile.push({ t, z });
    boxAtSample.push(boxId);
  }

  // The cord is pinned at the anchors, so force the endpoints to anchor height.
  profile[0] = { t: 0, z: from.z };
  profile[SAMPLES] = { t: 1, z: to.z };

  const hull = upperHull(profile);

  // Where does the taut cord actually rest on something?
  const touching = new Set<string>();
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const boxId = boxAtSample[i];
    if (!boxId) continue;
    if (hullHeightAt(hull, t) - profile[i]!.z <= CONTACT_TOLERANCE) {
      touching.add(boxId);
    }
  }

  const points: Vec3[] = hull.map((h) => ({
    x: from.x + (to.x - from.x) * h.t,
    y: from.y + (to.y - from.y) * h.t,
    z: h.z,
  }));

  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    length += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }

  return {
    fromAnchorId: from.id,
    toAnchorId: to.id,
    points,
    length,
    touchingBoxIds: [...touching],
  };
}

/**
 * Drape a net over the load and report what it holds.
 *
 * Cords are run between every pair of anchors. For the three-to-six anchors a real
 * boot net uses, that is a handful of cords and it approximates the mesh well —
 * including the diagonals, which is where a lot of the actual restraint comes from.
 */
export function drapeNet(
  net: CargoNet,
  anchors: Anchor[],
  boxes: PlacedBox[],
  lookup: SpecLookup,
): NetResult {
  const anchorById = new Map(anchors.map((a) => [a.id, a]));
  const used = net.anchorIds
    .map((id) => anchorById.get(id))
    .filter((a): a is Anchor => !!a);

  const boxAabbs = boxes.map((b) => ({ id: b.id, aabb: aabbOf(lookup(b.specId), b) }));

  const cords: Cord[] = [];
  for (let i = 0; i < used.length; i++) {
    for (let j = i + 1; j < used.length; j++) {
      cords.push(cordBetween(used[i]!, used[j]!, boxAabbs));
    }
  }

  const held = new Set<string>();
  for (const cord of cords) {
    for (const id of cord.touchingBoxIds) held.add(id);
  }

  // Bridged = under the net's footprint, but never touched by a cord.
  const span = anchorSpan(used);
  const bridged = new Set<string>();
  for (const { id, aabb } of boxAabbs) {
    if (held.has(id)) continue;
    if (!withinSpan(aabb, span)) continue;
    bridged.add(id);
  }

  // Stretch: how far the net has been pulled compared with its relaxed size. The
  // longest cord is a fair proxy for the diagonal a stretch net is worked hardest on.
  const relaxedDiagonal = Math.hypot(net.relaxedWidth, net.relaxedLength);
  const longest = cords.reduce((max, c) => Math.max(max, c.length), 0);
  const stretchRatio = relaxedDiagonal > 0 ? longest / relaxedDiagonal : 0;

  return {
    netId: net.id,
    cords,
    heldBoxIds: held,
    bridgedBoxIds: bridged,
    stretchRatio,
    overStretched: stretchRatio > net.maxStretchRatio,
  };
}

interface Span {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function anchorSpan(anchors: Anchor[]): Span {
  if (anchors.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  return {
    minX: Math.min(...anchors.map((a) => a.x)),
    maxX: Math.max(...anchors.map((a) => a.x)),
    minY: Math.min(...anchors.map((a) => a.y)),
    maxY: Math.max(...anchors.map((a) => a.y)),
  };
}

/** Is the box's footprint centre inside the anchor span? */
function withinSpan(aabb: Aabb, span: Span): boolean {
  const cx = (aabb.minX + aabb.maxX) / 2;
  const cy = (aabb.minY + aabb.maxY) / 2;
  return cx >= span.minX && cx <= span.maxX && cy >= span.minY && cy <= span.maxY;
}

/**
 * A sensible default net for a Caddy boot: clipped to all six floor eyes.
 *
 * Sized as a net you would actually buy for a bay this long. A small 700 mm square
 * net stretched across 1.5 m reports as permanently over-stretched, and a warning
 * that is always on is a warning nobody reads.
 */
export function defaultNet(anchorIds: string[]): CargoNet {
  return {
    id: 'net-1',
    label: 'Elasticated cargo net',
    anchorIds,
    relaxedWidth: 1000,
    relaxedLength: 900,
    // Most stretch nets are useful to roughly twice their relaxed size; past that
    // the elastic is near its limit and holding much less than you would hope.
    maxStretchRatio: 2.0,
  };
}
