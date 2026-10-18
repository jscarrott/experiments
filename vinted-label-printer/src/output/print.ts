/**
 * Printing straight from the page: one image per printed page, either a single label
 * or an A4 sheet of them.
 *
 * The images go into a print-only section of this page, and a print stylesheet hides
 * everything else and sets the page size to the paper with no margins, so the print
 * dialog opens already set up for a 4×6 thermal printer or for A4 at actual size.
 *
 * Not a hidden frame: Chrome on Android prints the top-level page whatever frame asks,
 * and printing a generated PDF hands the job to a PDF viewer that scales to fit and
 * adds margins of its own.
 */

import type { LabelSize } from '../layout/fit.js';

export async function printPages(pages: HTMLCanvasElement[], size: Pick<LabelSize, 'widthMm' | 'heightMm'>): Promise<void> {
  const urls = await Promise.all(
    pages.map(
      (page) =>
        new Promise<string>((resolve, reject) =>
          page.toBlob((b) => (b ? resolve(URL.createObjectURL(b)) : reject(new Error('Could not encode the label.')))),
        ),
    ),
  );

  const style = document.createElement('style');
  style.textContent = `@media print {
    @page { size: ${size.widthMm}mm ${size.heightMm}mm; margin: 0; }
    html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
    body > :not(#print-pages) { display: none !important; }
    #print-pages { display: block !important; }
    #print-pages img { display: block; width: ${size.widthMm}mm; height: ${size.heightMm}mm; break-after: page; }
    #print-pages img:last-child { break-after: auto; }
  }`;
  const container = document.createElement('div');
  container.id = 'print-pages';
  container.hidden = true;
  const images = urls.map((url) => Object.assign(document.createElement('img'), { src: url, alt: '' }));
  container.append(...images);
  document.head.append(style);
  document.body.append(container);
  await Promise.all(images.map((img) => img.decode().catch(() => undefined)));

  const cleanUp = () => {
    style.remove();
    container.remove();
    for (const u of urls) URL.revokeObjectURL(u);
  };
  // print() blocks until the dialog closes on desktop, but returns at once on Android,
  // where the page must stay printable until the system print UI has rendered it.
  // afterprint fires in both cases once it is done with the page.
  window.addEventListener('afterprint', () => setTimeout(cleanUp, 0), { once: true });
  window.print();
}
