import type { InkMap } from '../src/detect/crop.js';

/**
 * A synthetic page to run the detector against, drawn in millimetres. The marks are
 * chosen to have the ink density of the real thing at a glance: text is thin strokes
 * (about a quarter ink), barcodes are half ink, QR codes and service boxes solid.
 */
export class Page {
  readonly map: InkMap;

  constructor(
    readonly widthMm = 210,
    readonly heightMm = 297,
    readonly pxPerMm = 4,
  ) {
    const width = Math.round(widthMm * pxPerMm);
    const height = Math.round(heightMm * pxPerMm);
    this.map = { width, height, ink: new Uint8Array(width * height), pxPerMm };
  }

  fill(x: number, y: number, w: number, h: number): this {
    const { width, height, ink } = this.map;
    const p = this.pxPerMm;
    const x0 = Math.max(0, Math.round(x * p));
    const y0 = Math.max(0, Math.round(y * p));
    const x1 = Math.min(width, Math.round((x + w) * p));
    const y1 = Math.min(height, Math.round((y + h) * p));
    for (let yy = y0; yy < y1; yy++) ink.fill(1, yy * width + x0, yy * width + x1);
    return this;
  }

  /** A 0.5 mm frame. */
  frame(x: number, y: number, w: number, h: number): this {
    const t = 0.5;
    return this.fill(x, y, w, t).fill(x, y + h - t, w, t).fill(x, y, t, h).fill(x + w - t, y, t, h);
  }

  /** Lines of text: 2.5 mm tall, 5 mm apart, one thin stroke per millimetre. */
  text(x: number, y: number, w: number, h: number): this {
    for (let row = y; row + 2.5 <= y + h; row += 5) {
      for (let col = x; col < x + w; col += 1) this.fill(col, row, 0.25, 2.5);
    }
    return this;
  }

  barcode(x: number, y: number, w: number, h: number): this {
    for (let col = x; col < x + w; col += 1) this.fill(col, y, 0.5, h);
    return this;
  }

  /** A dashed line, 0.3 mm thick: 3 mm dashes with 2 mm gaps. */
  dashed(x: number, y: number, length: number, vertical = false): this {
    for (let d = 0; d < length; d += 5) {
      if (vertical) this.fill(x, y + d, 0.3, Math.min(3, length - d));
      else this.fill(x + d, y, Math.min(3, length - d), 0.3);
    }
    return this;
  }

  /** Convert a detected fractional rect back to millimetres. */
  mm(rect: { x: number; y: number; w: number; h: number }) {
    return {
      x: rect.x * this.widthMm,
      y: rect.y * this.heightMm,
      w: rect.w * this.widthMm,
      h: rect.h * this.heightMm,
    };
  }
}

/** A framed 4×6-ish shipping label with a barcode, address text and a QR code. */
export function drawLabel(page: Page, x: number, y: number, w = 100, h = 150, framed = true): Page {
  if (framed) page.frame(x, y, w, h);
  page.fill(x + 5, y + 5, 20, 12); // service code box
  page.text(x + 30, y + 5, w - 35, 12);
  page.barcode(x + 5, y + 25, w - 10, 25);
  page.text(x + 5, y + 58, w - 10, 40);
  page.fill(x + 5, y + h - 40, 30, 30); // QR code
  page.text(x + 40, y + h - 40, w - 45, 30);
  return page;
}
