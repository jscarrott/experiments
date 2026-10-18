/**
 * A rectangle in page fractions: (0, 0) is the top-left corner of the page and
 * (1, 1) the bottom-right. Fractions rather than pixels so that a crop worked out on
 * a low-resolution preview applies unchanged to the 300 DPI render, and a crop saved
 * as a carrier default applies to the next label whatever it was rendered at.
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FULL_PAGE: Rect = { x: 0, y: 0, w: 1, h: 1 };

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Clip a rect to the page, keeping at least `min` of each side. */
export function clampRect(rect: Rect, min = 0.02): Rect {
  const x = clamp01(Math.min(rect.x, 1 - min));
  const y = clamp01(Math.min(rect.y, 1 - min));
  const w = Math.max(min, Math.min(rect.w, 1 - x));
  const h = Math.max(min, Math.min(rect.h, 1 - y));
  return { x, y, w, h };
}

export function sameRect(a: Rect, b: Rect, tolerance = 1e-4): boolean {
  return (
    Math.abs(a.x - b.x) < tolerance &&
    Math.abs(a.y - b.y) < tolerance &&
    Math.abs(a.w - b.w) < tolerance &&
    Math.abs(a.h - b.h) < tolerance
  );
}
