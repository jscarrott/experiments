import type { SheetLayout } from '../layout/sheet.js';
import { paginate } from '../layout/sheet.js';

const MM_PER_INCH = 25.4;

/**
 * Lay finished labels out on sheets. Each label was drawn at its cell's size, so this
 * only places them. Cut guides are light dashed lines between cells, for plain paper.
 */
export function composeSheets(
  labels: HTMLCanvasElement[],
  layout: SheetLayout,
  startAt: number,
  dpi: number,
  cutGuides: boolean,
): HTMLCanvasElement[] {
  const pxPerMm = dpi / MM_PER_INCH;
  let next = 0;
  return paginate(labels.length, layout, startAt).map((cells) => {
    const sheet = document.createElement('canvas');
    sheet.width = Math.round(layout.paper.widthMm * pxPerMm);
    sheet.height = Math.round(layout.paper.heightMm * pxPerMm);
    const ctx = sheet.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, sheet.width, sheet.height);

    for (const index of cells) {
      const cell = layout.cells[index]!;
      ctx.drawImage(labels[next++]!, Math.round(cell.xMm * pxPerMm), Math.round(cell.yMm * pxPerMm));
    }

    if (cutGuides && layout.cells.length > 1) {
      ctx.strokeStyle = '#999';
      ctx.lineWidth = Math.max(1, Math.round(0.2 * pxPerMm));
      ctx.setLineDash([3 * pxPerMm, 2 * pxPerMm]);
      ctx.beginPath();
      // The inner edges only: the paper edge needs no guide.
      for (const c of layout.cells) {
        const right = c.xMm + c.widthMm;
        const bottom = c.yMm + c.heightMm;
        if (right < layout.paper.widthMm - 1e-6) {
          ctx.moveTo(right * pxPerMm, c.yMm * pxPerMm);
          ctx.lineTo(right * pxPerMm, bottom * pxPerMm);
        }
        if (bottom < layout.paper.heightMm - 1e-6) {
          ctx.moveTo(c.xMm * pxPerMm, bottom * pxPerMm);
          ctx.lineTo(right * pxPerMm, bottom * pxPerMm);
        }
      }
      ctx.stroke();
    }
    return sheet;
  });
}
