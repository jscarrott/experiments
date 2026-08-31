import type { PlacedBox, VehicleProfile } from '../model/types.js';
import { aabbOf, overlaps } from './boxes.js';
import { archBoxes, minHalfWidthOver, obstructionBoxes } from './shell.js';
import { findStacks, stackBounds, type SpecLookup } from './stacking.js';

/**
 * Fit checking — does this actually go in the van, and does it sit properly?
 *
 * Every issue carries a plain-English message, because the point of the tool is to
 * tell you what to do about it, not to render a red box and leave you guessing.
 */

export type IssueSeverity = 'error' | 'warning';

export interface FitIssue {
  boxId: string;
  kind:
    | 'clash'
    | 'too-wide'
    | 'too-tall'
    | 'past-tailgate'
    | 'past-seats'
    | 'wont-fit-aperture'
    | 'on-obstruction'
    | 'blocks-rear-view';
  severity: IssueSeverity;
  message: string;
}

/** Above this height the load starts filling the rear window. */
const REAR_VIEW_HEIGHT_FRACTION = 0.75;

export function checkFit(
  boxes: PlacedBox[],
  profile: VehicleProfile,
  lookup: SpecLookup,
): FitIssue[] {
  const issues: FitIssue[] = [];

  // --- Box against box ------------------------------------------------------
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      if (overlaps(aabbOf(lookup(a.specId), a), aabbOf(lookup(b.specId), b))) {
        issues.push({
          boxId: a.id,
          kind: 'clash',
          severity: 'error',
          message: `${a.label} and ${b.label} are occupying the same space.`,
        });
      }
    }
  }

  // --- Box against the shell ------------------------------------------------
  for (const box of boxes) {
    const spec = lookup(box.specId);
    const aabb = aabbOf(spec, box);

    // The width check that matters: measured against the narrowest the bay gets
    // over the height and length this box actually occupies. A crate spanning the
    // wheel arches is checked against 1172 mm, not the 1552 mm maximum.
    const halfWidth = minHalfWidthOver(profile, aabb.minZ, aabb.maxZ, aabb.minY, aabb.maxY);
    const reach = Math.max(Math.abs(aabb.minX), Math.abs(aabb.maxX));
    if (reach > halfWidth + 1) {
      const overBy = Math.round((reach - halfWidth) * 2);
      const archLimited = halfWidth <= profile.widthBetweenArches.value / 2 + 1;
      issues.push({
        boxId: box.id,
        kind: 'too-wide',
        severity: 'error',
        message: archLimited
          ? `${box.label} is about ${overBy} mm too wide to pass between the wheel arches. ` +
            `You have ${Math.round(halfWidth * 2)} mm there.`
          : `${box.label} fouls the side trim by about ${overBy} mm — the walls lean in as they rise, ` +
            `so there is only ${Math.round(halfWidth * 2)} mm at that height.`,
      });
    }

    if (aabb.maxZ > profile.loadHeight.value + 1) {
      issues.push({
        boxId: box.id,
        kind: 'too-tall',
        severity: 'error',
        message:
          `${box.label} reaches ${Math.round(aabb.maxZ)} mm, past the ` +
          `${Math.round(profile.loadHeight.value)} mm roof lining.`,
      });
    }

    if (aabb.maxY > profile.floorLength.value + 1) {
      issues.push({
        boxId: box.id,
        kind: 'past-tailgate',
        severity: 'error',
        message: `${box.label} sticks out past the load lip — the tailgate won't shut on it.`,
      });
    }

    if (aabb.minY < -1) {
      issues.push({
        boxId: box.id,
        kind: 'past-seats',
        severity: 'error',
        message: `${box.label} is pushed into the second-row seat backs.`,
      });
    }

    // A box sitting on the floor across a third-row bracket rocks on one corner.
    if (aabb.minZ < 1) {
      for (const obstruction of obstructionBoxes(profile)) {
        if (overlaps({ ...aabb, maxZ: Math.max(aabb.maxZ, 1) }, obstruction)) {
          issues.push({
            boxId: box.id,
            kind: 'on-obstruction',
            severity: 'warning',
            message:
              `${box.label} is sitting on the ${obstruction.label.toLowerCase()}, so it will rock. ` +
              `Move it clear or pack something under it.`,
          });
        }
      }
    }

    // Wheel arches as solids, for a box floating at arch height beside one.
    for (const arch of archBoxes(profile)) {
      if (overlaps(aabb, arch)) {
        issues.push({
          boxId: box.id,
          kind: 'too-wide',
          severity: 'error',
          message: `${box.label} is inside the wheel arch.`,
        });
        break;
      }
    }

    if (aabb.maxZ > profile.loadHeight.value * REAR_VIEW_HEIGHT_FRACTION) {
      issues.push({
        boxId: box.id,
        kind: 'blocks-rear-view',
        severity: 'warning',
        message: `${box.label} is high enough to fill the rear window. You'll be on mirrors.`,
      });
    }
  }

  // --- Will it go through the hole? ----------------------------------------
  // A single box is checked on its own. A latched TOUGHSYSTEM stack is checked as
  // one object, because that is how it travels — and how you'll try to lift it in.
  const apertureW = profile.apertureWidth.value;
  const apertureH = profile.apertureHeight.value;

  for (const stack of findStacks(boxes, lookup)) {
    const bounds = stackBounds(stack, boxes, lookup);
    const isStack = stack.boxIds.length > 1;
    if (isStack && !stack.rigid) continue; // carried in box by box, so no unit check

    const w = bounds.maxX - bounds.minX;
    const d = bounds.maxY - bounds.minY;
    const h = bounds.maxZ - bounds.minZ;

    // You can turn a box on its way in, so try it every way up: it fits if any
    // pair of dimensions clears the opening.
    const sides: [number, number][] = [
      [w, h],
      [h, w],
      [w, d],
      [d, w],
      [d, h],
      [h, d],
    ];
    const goesIn = sides.some(([a, b]) => a <= apertureW + 1 && b <= apertureH + 1);

    if (!goesIn) {
      const subject = isStack ? `The latched stack on ${stack.boxIds.length} boxes` : undefined;
      const firstId = stack.boxIds[0]!;
      issues.push({
        boxId: firstId,
        kind: 'wont-fit-aperture',
        severity: 'error',
        message:
          (subject ?? 'This box') +
          ` is ${Math.round(w)}×${Math.round(d)}×${Math.round(h)} mm and won't pass through the ` +
          `${Math.round(apertureW)}×${Math.round(apertureH)} mm tailgate opening at any angle` +
          (isStack ? '. Unlatch it and load the boxes separately.' : '.'),
      });
    }
  }

  return issues;
}

/** Issues grouped by box, for tinting meshes and for the inspector. */
export function issuesByBox(issues: FitIssue[]): Map<string, FitIssue[]> {
  const grouped = new Map<string, FitIssue[]>();
  for (const issue of issues) {
    const list = grouped.get(issue.boxId) ?? [];
    list.push(issue);
    grouped.set(issue.boxId, list);
  }
  return grouped;
}
