/**
 * Printing labels onto A4 instead of a label printer: the page is divided into cells,
 * one label per cell.
 *
 * The cells match the common A4 sticker-label sheets — four A6 quarters, or two A5
 * halves — so a label lands on one sticker. On plain paper the same layouts just
 * save paper over Vinted's one-label-per-sheet PDFs. Starting at a later position
 * lets a half-used sticker sheet go back through the printer.
 */

import type { LabelSize } from './fit.js';

export interface Cell {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}

export interface SheetLayout {
  id: string;
  name: string;
  paper: Pick<LabelSize, 'widthMm' | 'heightMm'>;
  /** In printing order: across, then down. */
  cells: Cell[];
  /** What to call each cell when choosing where to start. */
  positions: string[];
}

const A4 = { widthMm: 210, heightMm: 297 };

export const SHEET_LAYOUTS: SheetLayout[] = [
  {
    id: 'a4-4',
    name: 'A4, 4 per sheet (A6 labels)',
    paper: A4,
    cells: [
      { xMm: 0, yMm: 0, widthMm: 105, heightMm: 148.5 },
      { xMm: 105, yMm: 0, widthMm: 105, heightMm: 148.5 },
      { xMm: 0, yMm: 148.5, widthMm: 105, heightMm: 148.5 },
      { xMm: 105, yMm: 148.5, widthMm: 105, heightMm: 148.5 },
    ],
    positions: ['Top left', 'Top right', 'Bottom left', 'Bottom right'],
  },
  {
    id: 'a4-2',
    name: 'A4, 2 per sheet (A5 labels)',
    paper: A4,
    cells: [
      { xMm: 0, yMm: 0, widthMm: 210, heightMm: 148.5 },
      { xMm: 0, yMm: 148.5, widthMm: 210, heightMm: 148.5 },
    ],
    positions: ['Top half', 'Bottom half'],
  },
  {
    id: 'a4-1',
    name: 'A4, 1 per sheet (full page)',
    paper: A4,
    cells: [{ xMm: 0, yMm: 0, widthMm: 210, heightMm: 297 }],
    positions: ['Whole page'],
  },
];

/**
 * Which cell each label goes in, sheet by sheet. The first sheet starts at
 * `startAt` (0-based) and skips the cells before it; later sheets start from the top.
 */
export function paginate(count: number, layout: SheetLayout, startAt = 0): number[][] {
  const perSheet = layout.cells.length;
  const first = Math.min(Math.max(0, Math.floor(startAt)), perSheet - 1);
  const sheets: number[][] = [];
  let sheet: number[] = [];
  for (let i = 0, cell = first; i < count; i++, cell++) {
    if (cell === perSheet) {
      sheets.push(sheet);
      sheet = [];
      cell = 0;
    }
    sheet.push(cell);
  }
  if (sheet.length) sheets.push(sheet);
  return sheets;
}
