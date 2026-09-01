import type { Aabb, BoxSpec, PlacedBox, VehicleProfile } from '../model/types.js';
import { aabbOf, footprintArea, footprintOverlapArea } from './boxes.js';
import { halfWidthAt } from './shell.js';

/**
 * Stacking.
 *
 * The distinction that earns its keep here is latching vs friction. A TOUGHSYSTEM
 * stack latches into one rigid object: it has to go through the tailgate as a unit,
 * but it won't shed its top box under braking and one strap over the top restrains
 * the whole thing. A stack of attached-lid crates does none of that — every crate
 * is a separate object that can slide off the one below, so overhang and topple
 * matter, and restraint has to reach each one.
 */

export type SpecLookup = (specId: string) => BoxSpec;

export interface Stack {
  /** Bottom box first. */
  boxIds: string[];
  /** True only if every box in the stack latches to the one below it. */
  rigid: boolean;
}

/** Vertical gap below which a box counts as resting on the one beneath, mm. */
const CONTACT_TOLERANCE = 5;
/** A box supported on less than this fraction of its own footprint is overhanging. */
const MIN_SUPPORT_FRACTION = 0.7;
/** Height-to-base ratio above which something is a topple risk. */
const TOPPLE_RATIO = 2.2;
/**
 * How close something has to be before it counts as holding a tall item up, mm.
 * A slab with a wall this near can only lean; it cannot go over.
 */
const BRACE_GAP = 80;
/** A neighbour must reach this fraction of a tall item's height to brace it. */
const BRACE_HEIGHT_FRACTION = 0.5;

/**
 * Which box, if any, is this one resting on? Returns the highest box directly
 * beneath it whose top is within contact tolerance of this one's underside.
 */
export function supportOf(
  box: PlacedBox,
  all: PlacedBox[],
  lookup: SpecLookup,
): PlacedBox | undefined {
  if (box.z <= CONTACT_TOLERANCE) return undefined; // on the floor

  const boxAabb = aabbOf(lookup(box.specId), box);
  let best: PlacedBox | undefined;
  let bestTop = -Infinity;

  for (const other of all) {
    if (other.id === box.id) continue;
    const otherAabb = aabbOf(lookup(other.specId), other);
    if (Math.abs(otherAabb.maxZ - boxAabb.minZ) > CONTACT_TOLERANCE) continue;
    if (footprintOverlapArea(boxAabb, otherAabb) <= 0) continue;
    if (otherAabb.maxZ > bestTop) {
      bestTop = otherAabb.maxZ;
      best = other;
    }
  }
  return best;
}

/** Group boxes into stacks by following the support chain up from the floor. */
export function findStacks(boxes: PlacedBox[], lookup: SpecLookup): Stack[] {
  const supportedBy = new Map<string, string>();
  for (const box of boxes) {
    const support = supportOf(box, boxes, lookup);
    if (support) supportedBy.set(box.id, support.id);
  }

  const childrenOf = new Map<string, string[]>();
  for (const [child, parent] of supportedBy) {
    const list = childrenOf.get(parent) ?? [];
    list.push(child);
    childrenOf.set(parent, list);
  }

  const byId = new Map(boxes.map((b) => [b.id, b]));
  const stacks: Stack[] = [];

  for (const box of boxes) {
    if (supportedBy.has(box.id)) continue; // not the bottom of a stack

    // Walk up. A box sitting across two others branches; we follow the first
    // child, which is enough for the checks that matter and keeps stacks linear.
    const boxIds = [box.id];
    let rigid = true;
    let current = box.id;

    for (;;) {
      const children = childrenOf.get(current);
      if (!children || children.length === 0) break;
      const next = children[0]!;
      const upper = byId.get(next);
      const lower = byId.get(current);
      if (!upper || !lower) break;

      const upperSpec = lookup(upper.specId);
      const lowerSpec = lookup(lower.specId);
      const latched =
        upperSpec.stackMode === 'latching' &&
        lowerSpec.stackMode === 'latching' &&
        upperSpec.stackGroup === lowerSpec.stackGroup;
      if (!latched) rigid = false;

      boxIds.push(next);
      current = next;
    }

    stacks.push({ boxIds, rigid: rigid && boxIds.length > 1 });
  }

  return stacks;
}

export interface StackIssue {
  boxId: string;
  kind: 'overhang' | 'topple-risk' | 'unstable-mix';
  message: string;
}

/**
 * Overhang, topple and mixed-system checks.
 *
 * `profile` and `heldBoxIds` are what let the single-item topple check tell the
 * difference between a table stood sensibly against the side and the same table
 * standing in open floor. Without them it would flag both, and a check that fires on
 * the correct answer is one you learn to ignore.
 */
export function checkStacks(
  boxes: PlacedBox[],
  lookup: SpecLookup,
  profile?: VehicleProfile,
  heldBoxIds: Set<string> = new Set(),
): StackIssue[] {
  const issues: StackIssue[] = [];
  const byId = new Map(boxes.map((b) => [b.id, b]));

  for (const box of boxes) {
    const support = supportOf(box, boxes, lookup);
    if (!support) continue;

    const spec = lookup(box.specId);
    const supportSpec = lookup(support.specId);
    const boxAabb = aabbOf(spec, box);
    const supportAabb = aabbOf(supportSpec, support);

    const supported = footprintOverlapArea(boxAabb, supportAabb) / footprintArea(boxAabb);
    if (supported < MIN_SUPPORT_FRACTION) {
      issues.push({
        boxId: box.id,
        kind: 'overhang',
        message:
          `${box.label} is only ${Math.round(supported * 100)}% supported by ` +
          `${support.label} below it. Shift it so it sits square, or put something under the overhang.`,
      });
    }

    // Latching boxes stacked on non-latching ones lose the rigid-stack benefit,
    // and the plastic lid of a crate is not a load-bearing surface.
    if (spec.stackMode === 'latching' && supportSpec.stackMode === 'friction') {
      issues.push({
        boxId: box.id,
        kind: 'unstable-mix',
        message:
          `${box.label} (${spec.system}) is stacked on ${support.label}, a crate lid. ` +
          `It cannot latch to it, and the lid is not meant to carry that weight.`,
      });
    }
  }

  for (const stack of findStacks(boxes, lookup)) {
    if (stack.rigid || stack.boxIds.length < 2) continue;

    const bottom = byId.get(stack.boxIds[0]!);
    const top = byId.get(stack.boxIds[stack.boxIds.length - 1]!);
    if (!bottom || !top) continue;

    const bottomAabb = aabbOf(lookup(bottom.specId), bottom);
    const topAabb = aabbOf(lookup(top.specId), top);
    const height = topAabb.maxZ - bottomAabb.minZ;
    const base = Math.min(bottomAabb.maxX - bottomAabb.minX, bottomAabb.maxY - bottomAabb.minY);

    if (height / base > TOPPLE_RATIO) {
      issues.push({
        boxId: bottom.id,
        kind: 'topple-risk',
        message:
          `The stack on ${bottom.label} is ${Math.round(height)} mm tall on a ${Math.round(base)} mm base ` +
          `and the boxes don't latch together. Strap it or brace it against a side.`,
      });
    }
  }

  issues.push(...checkUprightItems(boxes, lookup, profile, heldBoxIds));
  return issues;
}

/**
 * A single item standing on a narrow base — a folded table on its edge, a crate on
 * its end — with nothing holding it up.
 *
 * This exists because tipping items on end is exactly the sort of space-saving move
 * that quietly turns a tidy load into something that falls over on the first
 * roundabout, and the stack check above never sees it: it only looks at stacks of two
 * or more boxes.
 */
function checkUprightItems(
  boxes: PlacedBox[],
  lookup: SpecLookup,
  profile: VehicleProfile | undefined,
  heldBoxIds: Set<string>,
): StackIssue[] {
  const issues: StackIssue[] = [];

  for (const box of boxes) {
    // Only items standing on their own. Anything in a stack is the stack check's job.
    if (supportOf(box, boxes, lookup)) continue;
    if (boxes.some((other) => other.id !== box.id && supportOf(other, boxes, lookup)?.id === box.id)) {
      continue;
    }

    const aabb = aabbOf(lookup(box.specId), box);
    const height = aabb.maxZ - aabb.minZ;
    const base = Math.min(aabb.maxX - aabb.minX, aabb.maxY - aabb.minY);
    if (base <= 0 || height / base <= TOPPLE_RATIO) continue;

    if (heldBoxIds.has(box.id)) continue;
    if (bracedBy(box, aabb, boxes, lookup, profile)) continue;

    issues.push({
      boxId: box.id,
      kind: 'topple-risk',
      message:
        `${box.label} is standing ${Math.round(height)} mm tall on a ${Math.round(base)} mm base with ` +
        `nothing holding it up, so it will go over. Stand it against a side or the seat backs, ` +
        `wedge it beside something of similar height, or put a strap on it.`,
    });
  }

  return issues;
}

/** Is anything close enough to stop this item falling over? */
function bracedBy(
  box: PlacedBox,
  aabb: Aabb,
  boxes: PlacedBox[],
  lookup: SpecLookup,
  profile: VehicleProfile | undefined,
): boolean {
  if (profile) {
    // A side wall, measured at mid-height where the item would lean against it.
    const midZ = (aabb.minZ + aabb.maxZ) / 2;
    const midY = (aabb.minY + aabb.maxY) / 2;
    const wallHalf = halfWidthAt(profile, midZ, midY);
    if (wallHalf > 0) {
      if (aabb.maxX >= wallHalf - BRACE_GAP) return true;
      if (aabb.minX <= -wallHalf + BRACE_GAP) return true;
    }

    // The second-row seat backs, and the closed tailgate.
    if (aabb.minY <= BRACE_GAP) return true;
    if (aabb.maxY >= profile.floorLength.value - BRACE_GAP) return true;
  }

  // A neighbour tall enough to lean on, close enough to reach.
  for (const other of boxes) {
    if (other.id === box.id) continue;
    const otherAabb = aabbOf(lookup(other.specId), other);
    if (otherAabb.maxZ < aabb.minZ + (aabb.maxZ - aabb.minZ) * BRACE_HEIGHT_FRACTION) continue;

    const besideAcross =
      overlaps1d(aabb.minY, aabb.maxY, otherAabb.minY, otherAabb.maxY) &&
      gap1d(aabb.minX, aabb.maxX, otherAabb.minX, otherAabb.maxX) <= BRACE_GAP;
    const besideAlong =
      overlaps1d(aabb.minX, aabb.maxX, otherAabb.minX, otherAabb.maxX) &&
      gap1d(aabb.minY, aabb.maxY, otherAabb.minY, otherAabb.maxY) <= BRACE_GAP;

    if (besideAcross || besideAlong) return true;
  }

  return false;
}

function overlaps1d(aMin: number, aMax: number, bMin: number, bMax: number): boolean {
  return aMin < bMax && aMax > bMin;
}

/** Clear distance between two ranges; 0 if they touch or overlap. */
function gap1d(aMin: number, aMax: number, bMin: number, bMax: number): number {
  if (aMax < bMin) return bMin - aMax;
  if (bMax < aMin) return aMin - bMax;
  return 0;
}

/** Bounding box of a whole stack, for the aperture check on rigid stacks. */
export function stackBounds(stack: Stack, boxes: PlacedBox[], lookup: SpecLookup) {
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const members = stack.boxIds.map((id) => byId.get(id)).filter((b): b is PlacedBox => !!b);
  const aabbs = members.map((b) => aabbOf(lookup(b.specId), b));
  return {
    minX: Math.min(...aabbs.map((a) => a.minX)),
    maxX: Math.max(...aabbs.map((a) => a.maxX)),
    minY: Math.min(...aabbs.map((a) => a.minY)),
    maxY: Math.max(...aabbs.map((a) => a.maxY)),
    minZ: Math.min(...aabbs.map((a) => a.minZ)),
    maxZ: Math.max(...aabbs.map((a) => a.maxZ)),
  };
}

/**
 * Where should a box land if dropped at this spot? Returns the height of the highest
 * surface under its footprint, so dragging a box over another snaps it on top rather
 * than through it.
 *
 * Floor obstructions count as surfaces too. Without them a crate dragged over the
 * third-row rails sits at z = 0 with the rails passing through it, which both looks
 * wrong and quietly overstates your headroom by the height of the rail.
 */
export function restingHeight(
  candidate: PlacedBox,
  others: PlacedBox[],
  lookup: SpecLookup,
  obstructions: Aabb[] = [],
): number {
  const candidateAabb = aabbOf(lookup(candidate.specId), candidate);
  let top = 0;
  for (const other of others) {
    if (other.id === candidate.id) continue;
    const otherAabb = aabbOf(lookup(other.specId), other);
    if (footprintOverlapArea(candidateAabb, otherAabb) <= 0) continue;
    top = Math.max(top, otherAabb.maxZ);
  }
  for (const obstruction of obstructions) {
    if (footprintOverlapArea(candidateAabb, obstruction) <= 0) continue;
    top = Math.max(top, obstruction.maxZ);
  }
  return top;
}
