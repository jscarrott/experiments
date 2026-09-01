import type { Aabb, PlacedBox, VehicleProfile } from '../model/types.js';
import { aabbOf, footprintOverlaps, overlaps } from './boxes.js';
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

/** A box within this of an obstruction's top counts as resting on it, mm. */
const CONTACT_TOLERANCE = 2;

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
    // over the height and length this box actually occupies, rather than against a
    // single headline width. Which of the three things below is doing the narrowing
    // depends on the vehicle, so the message has to work it out rather than assume.
    // Measure width only where the bay actually exists. Above the roof line there is
    // no width at all, so an over-tall box would otherwise be reported as "too wide,
    // you have 0 mm there" — true in a useless way, and it buries the real problem
    // under a wrong one. The too-tall check below owns that case.
    const zTop = Math.min(aabb.maxZ, profile.loadHeight.value);
    const halfWidth =
      aabb.minZ < profile.loadHeight.value
        ? minHalfWidthOver(profile, aabb.minZ, zTop, aabb.minY, aabb.maxY)
        : Infinity;

    const reach = Math.max(Math.abs(aabb.minX), Math.abs(aabb.maxX));
    if (reach > halfWidth + 1) {
      const overBy = Math.round((reach - halfWidth) * 2);
      const available = Math.round(halfWidth * 2);
      issues.push({
        boxId: box.id,
        kind: 'too-wide',
        severity: 'error',
        message: `${box.label} is about ${overBy} mm too wide — ${whyNarrow(profile, halfWidth, aabb)}` +
          ` You have ${available} mm there.`,
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

    const railIssue = checkFloorSupport(box, aabb, profile);
    if (railIssue) issues.push(railIssue);

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

/**
 * Which feature is actually pinching the bay here?
 *
 * Getting this right matters more than it looks. The tool shipped assuming the wheel
 * arches were always the culprit, which was true of the van the published figures came
 * from and false of a trimmed Life, where the side trim is narrower than the arches
 * everywhere. A message that blames the wrong thing sends you out to measure the wrong
 * part of the van.
 */
function whyNarrow(profile: VehicleProfile, halfWidth: number, aabb: Aabb): string {
  const archesIntrude = profile.widthBetweenArches.value < profile.floorWidth.value - 1;
  const archBound = halfWidth <= profile.widthBetweenArches.value / 2 + 1;

  if (archesIntrude && archBound && aabb.minZ < profile.archHeight.value) {
    return 'it will not pass between the wheel arches.';
  }

  // Only blame the taper if there is a meaningful one and the box is high enough to
  // meet it. On a van body the sides are near vertical and this never applies.
  const taper = profile.floorWidth.value - profile.widthAtRoof.value;
  if (taper > 40 && halfWidth < profile.floorWidth.value / 2 - 1) {
    return 'the side trim leans in as it rises, so the bay is narrower up there.';
  }

  return 'the bay is not that wide.';
}

/**
 * Is this box properly supported on the floor, or is it perched on the third-row rails?
 *
 * The distinction the rails force: two parallel rails of the same height are not a
 * problem at all — a crate straddling both sits dead level, just raised by the height
 * of the rail. It is a crate caught on *one* rail, or bridging rails of different
 * heights, that rocks on a corner. Warning about both cases equally would train you to
 * ignore the warning.
 */
function checkFloorSupport(
  box: PlacedBox,
  aabb: Aabb,
  profile: VehicleProfile,
): FitIssue | undefined {
  const obstructions = obstructionBoxes(profile);

  // Which obstructions is this box actually bearing on? Its footprint has to overlap
  // theirs, and its underside has to be at or below their top — a box resting on a
  // rail sits exactly level with it, so `overlaps` is the wrong tool here: its
  // tolerance exists to stop touching faces counting, which is precisely this case.
  const bearing = obstructions.filter(
    (o) => footprintOverlaps(aabb, o) && aabb.minZ <= o.maxZ + CONTACT_TOLERANCE,
  );
  if (bearing.length === 0) return undefined;

  const heights = [...new Set(bearing.map((o) => Math.round(o.maxZ)))];

  if (bearing.length >= 2 && heights.length === 1) {
    return {
      boxId: box.id,
      kind: 'on-obstruction',
      severity: 'warning',
      message:
        `${box.label} is straddling ${bearing.length} rails of the same height, so it sits level — ` +
        `but ${heights[0]} mm up, which is ${heights[0]} mm less headroom under the roof.`,
    };
  }

  const names = bearing.map((o) => o.label.toLowerCase()).join(' and ');
  return {
    boxId: box.id,
    kind: 'on-obstruction',
    severity: 'warning',
    message:
      heights.length > 1
        ? `${box.label} is bridging ${names}, which are different heights, so it will rock. ` +
          `Pack the low side out.`
        : `${box.label} is perched on the ${names} with nothing under its other side, so it will rock. ` +
          `Slide it clear, or across so it catches both rails.`,
  };
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
