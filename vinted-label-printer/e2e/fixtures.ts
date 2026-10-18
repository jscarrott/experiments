import { PDFDocument, rgb, StandardFonts, type PDFPage } from 'pdf-lib';

const MM = 72 / 25.4;

/**
 * An A4 sheet laid out the way Vinted's are: the label framed in the top-left
 * quarter, instructions beside and below it, a dashed cut line, and a blank second
 * page. pdf-lib's origin is bottom-left, so y is flipped from the top of the page.
 */
export async function vintedStylePdf(carrier: string, { blankSecondPage = true } = {}): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([210 * MM, 297 * MM]);
  const H = 297;

  const rect = (p: PDFPage, x: number, y: number, w: number, h: number, filled = true) =>
    p.drawRectangle({
      x: x * MM,
      y: (H - y - h) * MM,
      width: w * MM,
      height: h * MM,
      ...(filled ? { color: rgb(0, 0, 0) } : { borderColor: rgb(0, 0, 0), borderWidth: 1.2 }),
    });
  const text = (s: string, x: number, y: number, size = 9, f = font) =>
    page.drawText(s, { x: x * MM, y: (H - y) * MM, size, font: f });

  // The label: 100 × 150 mm at (10, 10).
  rect(page, 10, 10, 100, 150, false);
  rect(page, 15, 15, 22, 14);
  text(carrier.toUpperCase(), 42, 22, 16, bold);
  text(`${carrier} Standard Parcel`, 42, 28);
  for (let x = 15; x < 105; x += 1.2) rect(page, x, 35, x % 3 < 1.5 ? 0.6 : 0.35, 26);
  ['DELIVER TO:', 'A. Buyer', '12 Example Street', 'Sampletown', 'AB1 2CD'].forEach((line, i) =>
    text(line, 15, 72 + i * 6, 11, i === 0 ? bold : font),
  );
  rect(page, 15, 115, 32, 32);
  text(`${carrier} tracking`, 52, 122);
  text('H00AB1234567890', 52, 128, 10, bold);

  // A dashed cut line around it, and instructions outside.
  page.drawLine({
    start: { x: 115 * MM, y: H * MM },
    end: { x: 115 * MM, y: (H - 170) * MM },
    thickness: 0.8,
    dashArray: [8, 6],
  });
  page.drawLine({ start: { x: 0, y: (H - 170) * MM }, end: { x: 210 * MM, y: (H - 170) * MM }, thickness: 0.8, dashArray: [8, 6] });
  text('How to send your parcel', 120, 20, 12, bold);
  for (let i = 0; i < 22; i++) text(`Step ${i + 1}: pack your item securely and take it along.`, 120, 30 + i * 6, 7.5);
  text('Thank you for selling on Vinted', 15, 185, 14, bold);
  for (let i = 0; i < 14; i++) {
    text('Please keep your proof of postage until the buyer has confirmed the item has arrived safely.', 15, 196 + i * 6, 9);
  }

  if (blankSecondPage) doc.addPage([210 * MM, 297 * MM]);
  return Buffer.from(await doc.save());
}
