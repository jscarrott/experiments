import type { PlacedBox, Vec3 } from '../model/types.js';
import { aabbOf, centreOf } from './boxes.js';
import type { SpecLookup } from './stacking.js';

/**
 * Weight and where it sits. Two things worth knowing before a long drive: how much
 * you have actually loaded, and whether it is all stacked high and at the back —
 * which is exactly where you least want it.
 */

export interface MassResult {
  totalKg: number;
  /** Centre of gravity of the load, in vehicle coordinates. */
  centreOfGravity: Vec3;
  /** Heaviest box, for the "put this at the bottom" nudge. */
  heaviestBoxId?: string;
  overPayload: boolean;
  payloadKg: number;
}

export function computeMass(
  boxes: PlacedBox[],
  lookup: SpecLookup,
  payloadKg: number,
): MassResult {
  let total = 0;
  let mx = 0;
  let my = 0;
  let mz = 0;
  let heaviest = 0;
  let heaviestBoxId: string | undefined;

  for (const box of boxes) {
    const spec = lookup(box.specId);
    const weight = spec.emptyWeightKg.value + box.contentsKg;
    const centre = centreOf(aabbOf(spec, box));

    total += weight;
    mx += centre.x * weight;
    my += centre.y * weight;
    mz += centre.z * weight;

    if (weight > heaviest) {
      heaviest = weight;
      heaviestBoxId = box.id;
    }
  }

  const centreOfGravity: Vec3 =
    total > 0 ? { x: mx / total, y: my / total, z: mz / total } : { x: 0, y: 0, z: 0 };

  return {
    totalKg: total,
    centreOfGravity,
    ...(heaviestBoxId ? { heaviestBoxId } : {}),
    overPayload: total > payloadKg,
    payloadKg,
  };
}

export interface MassIssue {
  boxId?: string;
  kind: 'over-payload' | 'rear-heavy' | 'top-heavy';
  severity: 'error' | 'warning';
  message: string;
}

/** Above this fraction of the load length, the weight is sitting behind the axle. */
const REAR_HEAVY_FRACTION = 0.6;
/** Above this fraction of the load height, the centre of gravity is uncomfortably high. */
const TOP_HEAVY_FRACTION = 0.45;

export function checkMass(
  mass: MassResult,
  floorLength: number,
  loadHeight: number,
): MassIssue[] {
  const issues: MassIssue[] = [];
  if (mass.totalKg <= 0) return issues;

  if (mass.overPayload) {
    issues.push({
      kind: 'over-payload',
      severity: 'error',
      message:
        `Load is ${mass.totalKg.toFixed(0)} kg against a ${mass.payloadKg.toFixed(0)} kg payload — ` +
        `and that is before passengers. Check the plate in your door shut.`,
    });
  }

  if (mass.centreOfGravity.y > floorLength * REAR_HEAVY_FRACTION) {
    issues.push({
      kind: 'rear-heavy',
      severity: 'warning',
      message:
        `The weight is sitting towards the tailgate. Move the heavy boxes forward against ` +
        `the seat backs — it steers better and the straps have less to fight.`,
    });
  }

  if (mass.centreOfGravity.z > loadHeight * TOP_HEAVY_FRACTION) {
    issues.push({
      kind: 'top-heavy',
      severity: 'warning',
      message: `The centre of gravity is high. Put the heaviest boxes on the floor, not on the stack.`,
    });
  }

  return issues;
}
