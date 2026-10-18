/**
 * Printing straight from the page: one image per printed page, either a single label
 * or an A4 sheet of them.
 *
 * The images go into a hidden frame whose stylesheet sets the page size to the paper
 * with no margins, so the print dialog opens already set up for a 4×6 thermal printer
 * or for A4 at actual size. Printing a generated PDF instead would hand the job to the browser's PDF
 * viewer, which scales to fit and adds margins of its own.
 */

import type { LabelSize } from '../layout/fit.js';

export async function printPages(labels: HTMLCanvasElement[], size: Pick<LabelSize, 'widthMm' | 'heightMm'>): Promise<void> {
  const urls = await Promise.all(
    labels.map(
      (label) =>
        new Promise<string>((resolve, reject) =>
          label.toBlob((b) => (b ? resolve(URL.createObjectURL(b)) : reject(new Error('Could not encode the label.')))),
        ),
    ),
  );

  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>Shipping labels</title><style>
    @page { size: ${size.widthMm}mm ${size.heightMm}mm; margin: 0; }
    html, body { margin: 0; padding: 0; }
    img { display: block; width: ${size.widthMm}mm; height: ${size.heightMm}mm; break-after: page; }
    img:last-child { break-after: auto; }
  </style></head><body>${urls.map((u) => `<img src="${u}" alt="">`).join('')}</body></html>`;

  const cleanUp = () => {
    frame.remove();
    for (const u of urls) URL.revokeObjectURL(u);
  };

  await new Promise<void>((resolve) => {
    frame.addEventListener('load', () => resolve(), { once: true });
    document.body.append(frame);
  });
  const win = frame.contentWindow!;
  await Promise.all(
    [...win.document.images].map((img) => (img.complete ? Promise.resolve() : img.decode().catch(() => undefined))),
  );
  win.addEventListener('afterprint', () => setTimeout(cleanUp, 0), { once: true });
  win.focus();
  win.print();
  // Some browsers never fire afterprint for a frame; don't leak it for ever.
  setTimeout(cleanUp, 60_000);
}
