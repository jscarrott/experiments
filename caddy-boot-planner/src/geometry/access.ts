import type { PlacedBox } from '../model/types.js';
import { aabbOf, footprintOverlaps } from './boxes.js';
import { supportOf, type SpecLookup } from './stacking.js';

/**
 * Can you actually get at it?
 *
 * You load the van once and then live with it. The box you need at every stop being
 * behind two others, or under a third, is the thing you regret three weeks in — and
 * it is invisible in a 3D view where you can orbit round the back of everything.
 *
 * Reachability is from the tailgate, so it is a question about the y axis: a box is
 * blocked by anything between it and the load lip that overlaps it, and by anything
 * stacked on top of it.
 */

export interface AccessIssue {
  boxId: string;
  kind: 'buried' | 'under-stack';
  severity: 'warning';
  message: string;
}

export interface AccessResult {
  /** Boxes reachable from the tailgate without moving anything else. */
  reachable: Set<string>;
  issues: AccessIssue[];
}

/** Vertical overlap needed before a box in front counts as being in the way. */
const BLOCKING_HEIGHT_OVERLAP = 60;

export function checkAccess(boxes: PlacedBox[], lookup: SpecLookup): AccessResult {
  const reachable = new Set<string>();
  const issues: AccessIssue[] = [];

  const withAabb = boxes.map((b) => ({ box: b, aabb: aabbOf(lookup(b.specId), b) }));

  for (const { box, aabb } of withAabb) {
    const blockers: string[] = [];
    let stackedOn: string | undefined;

    for (const other of withAabb) {
      if (other.box.id === box.id) continue;

      // Something resting on top of this box.
      const support = supportOf(other.box, boxes, lookup);
      if (support?.id === box.id) {
        stackedOn = other.box.label;
        continue;
      }

      // Something between this box and the tailgate, at a height that overlaps it.
      const inFront = other.aabb.minY >= aabb.maxY - 1;
      if (!inFront) continue;

      const sideOverlap =
        other.aabb.minX < aabb.maxX - 1 && other.aabb.maxX > aabb.minX + 1;
      if (!sideOverlap) continue;

      const heightOverlap =
        Math.min(other.aabb.maxZ, aabb.maxZ) - Math.max(other.aabb.minZ, aabb.minZ);
      if (heightOverlap > BLOCKING_HEIGHT_OVERLAP) {
        blockers.push(other.box.label);
      }
    }

    if (blockers.length === 0 && !stackedOn) {
      reachable.add(box.id);
    }

    if (!box.needOften) continue;

    if (stackedOn) {
      issues.push({
        boxId: box.id,
        kind: 'under-stack',
        severity: 'warning',
        message:
          `You marked ${box.label} as needed often, but ${stackedOn} is stacked on top of it. ` +
          `Put it on top of the stack instead.`,
      });
    }

    if (blockers.length > 0) {
      const list = blockers.slice(0, 2).join(' and ');
      const more = blockers.length > 2 ? ` and ${blockers.length - 2} more` : '';
      issues.push({
        boxId: box.id,
        kind: 'buried',
        severity: 'warning',
        message:
          `You marked ${box.label} as needed often, but ${list}${more} sit between it and the tailgate. ` +
          `Move it to the back of the load.`,
      });
    }
  }

  return { reachable, issues };
}
