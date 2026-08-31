import type { Anchor, PlacedBox, Strap, Vec3 } from '../model/types.js';
import { aabbOf } from './boxes.js';
import { cordBetween } from './net.js';
import type { SpecLookup } from './stacking.js';

/**
 * Ratchet straps from the floor lashing eyes, over the load, to another eye.
 *
 * A strap is the same physics as a net cord — a line pulled taut over whatever is
 * beneath it — so it reuses `cordBetween`. The difference is intent: with a strap you
 * choose which boxes it should hold, and the useful output is the length, so you can
 * buy the right one instead of guessing in the shop.
 */

export interface StrapResult {
  strapId: string;
  path: Vec3[];
  /** Path length over the load, mm. */
  spanLength: number;
  /** Length to buy: the span plus slack for the ratchet and tail. */
  recommendedLength: number;
  /** Boxes the strap actually bears on. */
  touchingBoxIds: string[];
  /** Boxes you asked it to hold that it passes over without touching. */
  missedBoxIds: string[];
}

/** Ratchet mechanism, hook tails and enough loose end to tension it, mm. */
const STRAP_SLACK = 600;

export function routeStrap(
  strap: Strap,
  anchors: Anchor[],
  boxes: PlacedBox[],
  lookup: SpecLookup,
): StrapResult | undefined {
  const from = anchors.find((a) => a.id === strap.fromAnchorId);
  const to = anchors.find((a) => a.id === strap.toAnchorId);
  if (!from || !to) return undefined;

  const boxAabbs = boxes.map((b) => ({ id: b.id, aabb: aabbOf(lookup(b.specId), b) }));
  const cord = cordBetween(from, to, boxAabbs);

  const touching = new Set(cord.touchingBoxIds);
  const missed = strap.overBoxIds.filter((id) => !touching.has(id));

  return {
    strapId: strap.id,
    path: cord.points,
    spanLength: cord.length,
    recommendedLength: Math.ceil((cord.length + STRAP_SLACK) / 100) * 100,
    touchingBoxIds: cord.touchingBoxIds,
    missedBoxIds: missed,
  };
}

export function routeAll(
  straps: Strap[],
  anchors: Anchor[],
  boxes: PlacedBox[],
  lookup: SpecLookup,
): StrapResult[] {
  return straps
    .map((s) => routeStrap(s, anchors, boxes, lookup))
    .filter((r): r is StrapResult => !!r);
}

export interface RestraintIssue {
  boxId: string;
  kind: 'unrestrained' | 'strap-misses';
  severity: 'error' | 'warning';
  message: string;
}

/**
 * The summary question: is anything heavy in here held by nothing at all?
 *
 * A box counts as restrained if a strap or a net cord bears on it, or if it is
 * latched into a stack whose other boxes are held — that is the whole point of a
 * latching system.
 */
export function checkRestraint(
  boxes: PlacedBox[],
  lookup: SpecLookup,
  strapResults: StrapResult[],
  netHeldBoxIds: Set<string>,
  netBridgedBoxIds: Set<string>,
  rigidStacks: { boxIds: string[]; rigid: boolean }[],
  warnAboveKg: number,
): RestraintIssue[] {
  const issues: RestraintIssue[] = [];

  const held = new Set<string>(netHeldBoxIds);
  for (const result of strapResults) {
    for (const id of result.touchingBoxIds) held.add(id);
  }

  // A latched stack shares restraint across its members.
  for (const stack of rigidStacks) {
    if (!stack.rigid) continue;
    if (stack.boxIds.some((id) => held.has(id))) {
      for (const id of stack.boxIds) held.add(id);
    }
  }

  for (const box of boxes) {
    const spec = lookup(box.specId);
    const weight = spec.emptyWeightKg.value + box.contentsKg;
    if (held.has(box.id) || weight < warnAboveKg) continue;

    const bridged = netBridgedBoxIds.has(box.id);
    issues.push({
      boxId: box.id,
      kind: 'unrestrained',
      severity: 'error',
      message: bridged
        ? `${box.label} (${weight.toFixed(1)} kg) sits under the net but nothing touches it — ` +
          `the net bridges straight over the taller boxes either side. Pack it out to net height, ` +
          `move it to the outside of the stack, or put a strap on it.`
        : `${box.label} (${weight.toFixed(1)} kg) has no strap or net on it.`,
    });
  }

  for (const result of strapResults) {
    for (const missedId of result.missedBoxIds) {
      const box = boxes.find((b) => b.id === missedId);
      if (!box) continue;
      issues.push({
        boxId: missedId,
        kind: 'strap-misses',
        severity: 'warning',
        message:
          `The strap is meant to hold ${box.label} but passes over it without contact — ` +
          `something taller is taking the tension.`,
      });
    }
  }

  return issues;
}
