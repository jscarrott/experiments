import type { Aabb, BoxSpec, PlacedBox, Vec3 } from '../model/types.js';

/**
 * Turning a PlacedBox plus its catalogue spec into world-space geometry.
 * Shared by every other pure module, so it lives on its own.
 */

export interface BoxDims {
  width: number;
  depth: number;
  height: number;
}

/** Spec dimensions with any per-box measured overrides applied. */
export function dimsOf(spec: BoxSpec, placed: PlacedBox): BoxDims {
  return {
    width: placed.overrides?.width ?? spec.width.value,
    depth: placed.overrides?.depth ?? spec.depth.value,
    height: placed.overrides?.height ?? spec.height.value,
  };
}

/**
 * Footprint after rotation. Only right angles are allowed, so this is a swap
 * rather than a trigonometric mess.
 */
export function footprintOf(spec: BoxSpec, placed: PlacedBox): { width: number; depth: number } {
  const { width, depth } = dimsOf(spec, placed);
  const turned = placed.rotation === 90 || placed.rotation === 270;
  return turned ? { width: depth, depth: width } : { width, depth };
}

export function aabbOf(spec: BoxSpec, placed: PlacedBox): Aabb {
  const { width, depth } = footprintOf(spec, placed);
  const { height } = dimsOf(spec, placed);
  return {
    minX: placed.x - width / 2,
    maxX: placed.x + width / 2,
    minY: placed.y - depth / 2,
    maxY: placed.y + depth / 2,
    minZ: placed.z,
    maxZ: placed.z + height,
  };
}

/** The four top corners, which is what the net and straps actually rest on. */
export function topCorners(box: Aabb): Vec3[] {
  return [
    { x: box.minX, y: box.minY, z: box.maxZ },
    { x: box.maxX, y: box.minY, z: box.maxZ },
    { x: box.maxX, y: box.maxY, z: box.maxZ },
    { x: box.minX, y: box.maxY, z: box.maxZ },
  ];
}

export function centreOf(box: Aabb): Vec3 {
  return {
    x: (box.minX + box.maxX) / 2,
    y: (box.minY + box.maxY) / 2,
    z: (box.minZ + box.maxZ) / 2,
  };
}

/**
 * Do two boxes overlap? A shared face is not an overlap — boxes are meant to sit
 * against each other — so the comparison uses a small tolerance.
 */
export function overlaps(a: Aabb, b: Aabb, tolerance = 1): boolean {
  return (
    a.minX < b.maxX - tolerance &&
    a.maxX > b.minX + tolerance &&
    a.minY < b.maxY - tolerance &&
    a.maxY > b.minY + tolerance &&
    a.minZ < b.maxZ - tolerance &&
    a.maxZ > b.minZ + tolerance
  );
}

/** Do two footprints overlap, ignoring height? Used for stacking and access. */
export function footprintOverlaps(a: Aabb, b: Aabb, tolerance = 1): boolean {
  return (
    a.minX < b.maxX - tolerance &&
    a.maxX > b.minX + tolerance &&
    a.minY < b.maxY - tolerance &&
    a.maxY > b.minY + tolerance
  );
}

/** Area of footprint overlap, in mm². Drives the stack-overhang check. */
export function footprintOverlapArea(a: Aabb, b: Aabb): number {
  const dx = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const dy = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  return dx > 0 && dy > 0 ? dx * dy : 0;
}

export function footprintArea(box: Aabb): number {
  return (box.maxX - box.minX) * (box.maxY - box.minY);
}
