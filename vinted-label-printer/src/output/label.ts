/**
 * Drawing one finished label: the crop from a rendered page, placed on the label
 * stock by {@link fitCrop}, optionally reduced to pure black and white.
 */

import type { Rect } from '../detect/rect.js';
import { fitCrop, type LabelSize } from '../layout/fit.js';
import type { PageSource } from '../source.js';

export interface LabelSettings {
  size: LabelSize;
  marginMm: number;
  rotate: boolean;
  /**
   * Threshold to pure black and white. Thermal printers cannot print grey; left to
   * the driver, anti-aliased edges get dithered, and dithered barcode edges are where
   * scans fail.
   */
  monochrome: boolean;
  dpi: number;
}

const MM_PER_INCH = 25.4;
/** Luminance below which a pixel prints black. Slightly generous, so fine text holds. */
const MONO_THRESHOLD = 170;

/** The page resolution needed for the crop to come out at the output DPI after scaling. */
export function sourceDpiFor(page: PageSource, crop: Rect, settings: LabelSettings): number {
  const { scale } = placementFor(page, crop, settings);
  return Math.min(600, Math.max(150, Math.ceil(settings.dpi * scale)));
}

function placementFor(page: PageSource, crop: Rect, settings: LabelSettings) {
  return fitCrop(crop.w * page.widthMm, crop.h * page.heightMm, settings.size, settings.marginMm, settings.rotate);
}

/**
 * Draw a label from a page already rendered at some resolution. Used both for full
 * quality output and for thumbnails drawn from the preview render.
 */
export function drawLabel(
  page: PageSource,
  rendered: HTMLCanvasElement,
  crop: Rect,
  settings: LabelSettings,
  dpi = settings.dpi,
  monochrome = settings.monochrome,
): HTMLCanvasElement {
  const { size } = settings;
  const placement = placementFor(page, crop, settings);
  const pxPerMm = dpi / MM_PER_INCH;

  const out = document.createElement('canvas');
  out.width = Math.round(size.widthMm * pxPerMm);
  out.height = Math.round(size.heightMm * pxPerMm);
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const sx = crop.x * rendered.width;
  const sy = crop.y * rendered.height;
  const sw = crop.w * rendered.width;
  const sh = crop.h * rendered.height;

  // Draw in the crop's own orientation, centred on the placed box, turning the
  // context a quarter clockwise first when the placement calls for it.
  const cx = (placement.xMm + placement.widthMm / 2) * pxPerMm;
  const cy = (placement.yMm + placement.heightMm / 2) * pxPerMm;
  const dw = (placement.rotate ? placement.heightMm : placement.widthMm) * pxPerMm;
  const dh = (placement.rotate ? placement.widthMm : placement.heightMm) * pxPerMm;
  ctx.save();
  ctx.translate(cx, cy);
  if (placement.rotate) ctx.rotate(Math.PI / 2);
  ctx.drawImage(rendered, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();

  if (monochrome) threshold(ctx, out.width, out.height);
  return out;
}

function threshold(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const image = ctx.getImageData(0, 0, width, height);
  const d = image.data;
  for (let p = 0; p < d.length; p += 4) {
    const luma = (d[p]! * 299 + d[p + 1]! * 587 + d[p + 2]! * 114) / 1000;
    const v = luma < MONO_THRESHOLD ? 0 : 255;
    d[p] = d[p + 1] = d[p + 2] = v;
    d[p + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

/** Render a label at full output quality, straight from the source page. */
export async function renderLabel(page: PageSource, crop: Rect, settings: LabelSettings): Promise<HTMLCanvasElement> {
  const rendered = await page.render(sourceDpiFor(page, crop, settings));
  const label = drawLabel(page, rendered, crop, settings);
  // A 600 DPI A4 render is over 100 MB of pixels; let it go now rather than at the
  // end of a batch.
  rendered.width = rendered.height = 0;
  return label;
}
