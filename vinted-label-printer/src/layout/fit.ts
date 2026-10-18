/**
 * Placing a cropped region onto the label stock.
 *
 * Everything here is in millimetres. The crop is scaled to fill the printable area —
 * up or down — keeping its aspect ratio, and turned a quarter turn when that makes it
 * bigger: a landscape label on portrait 4×6 stock prints at nearly twice the size
 * once it is rotated.
 */

export interface LabelSize {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
}

export const LABEL_SIZES: LabelSize[] = [
  { id: '4x6', name: '4 × 6 in (101.6 × 152.4 mm)', widthMm: 101.6, heightMm: 152.4 },
  { id: '100x150', name: '100 × 150 mm', widthMm: 100, heightMm: 150 },
  { id: 'a6', name: 'A6 (105 × 148 mm)', widthMm: 105, heightMm: 148 },
  { id: '4x4', name: '4 × 4 in (101.6 × 101.6 mm)', widthMm: 101.6, heightMm: 101.6 },
];

export interface Placement {
  /** Turn the crop a quarter turn clockwise before placing it. */
  rotate: boolean;
  /** Label millimetres per source millimetre. */
  scale: number;
  /** The placed content, in label millimetres, after any rotation. */
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}

export function fitCrop(
  cropWidthMm: number,
  cropHeightMm: number,
  label: Pick<LabelSize, 'widthMm' | 'heightMm'>,
  marginMm: number,
  allowRotate: boolean,
): Placement {
  const availW = Math.max(1, label.widthMm - 2 * marginMm);
  const availH = Math.max(1, label.heightMm - 2 * marginMm);

  const upright = Math.min(availW / cropWidthMm, availH / cropHeightMm);
  const turned = Math.min(availW / cropHeightMm, availH / cropWidthMm);
  // A small preference for upright, so a near-square crop is not turned for a 1% gain.
  const rotate = allowRotate && turned > upright * 1.02;
  const scale = rotate ? turned : upright;

  const widthMm = (rotate ? cropHeightMm : cropWidthMm) * scale;
  const heightMm = (rotate ? cropWidthMm : cropHeightMm) * scale;
  return {
    rotate,
    scale,
    widthMm,
    heightMm,
    xMm: (label.widthMm - widthMm) / 2,
    yMm: (label.heightMm - heightMm) / 2,
  };
}

/**
 * Whether a page is already label-sized, so it should be printed whole rather than
 * searched for a label. Some carriers hand out 4×6 PDFs directly.
 */
export function isLabelSized(widthMm: number, heightMm: number): boolean {
  const long = Math.max(widthMm, heightMm);
  const short = Math.min(widthMm, heightMm);
  return long <= 160 && short >= 90;
}
