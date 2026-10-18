import { PDFDocument } from 'pdf-lib';

import type { LabelSize } from '../layout/fit.js';

const PT_PER_MM = 72 / 25.4;

/** One page per label, each exactly the label stock size, the label image filling it. */
export async function labelsToPdf(labels: HTMLCanvasElement[], size: LabelSize): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Shipping labels');
  doc.setCreator('Vinted Label Printer');
  const w = size.widthMm * PT_PER_MM;
  const h = size.heightMm * PT_PER_MM;
  for (const label of labels) {
    const png = await doc.embedPng(await canvasToPng(label));
    doc.addPage([w, h]).drawImage(png, { x: 0, y: 0, width: w, height: h });
  }
  return doc.save();
}

export async function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the label.'))), 'image/png'),
  );
  return new Uint8Array(await blob.arrayBuffer());
}
