/**
 * Turning dropped files into pages that can be rendered at any resolution.
 *
 * A page is kept as something that can render itself rather than as pixels, because
 * the app needs it twice at very different sizes: a quick preview to find the label
 * and show the crop, then a 300 DPI render of just the label when printing.
 */

import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface PageSource {
  fileName: string;
  /** 1-based; always 1 for an image. */
  pageNumber: number;
  pageCount: number;
  widthMm: number;
  heightMm: number;
  /** Text on the page, for carrier detection. Empty for images. */
  text: string;
  render(dpi: number): Promise<HTMLCanvasElement>;
}

const MM_PER_INCH = 25.4;
const PT_PER_INCH = 72;

export async function pagesFromFile(file: File): Promise<PageSource[]> {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return pagesFromPdf(file);
  if (file.type.startsWith('image/')) return [await pageFromImage(file)];
  throw new Error(`${file.name} is not a PDF or an image.`);
}

async function pagesFromPdf(file: File): Promise<PageSource[]> {
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({
    data,
    // Label PDFs come from Vinted, but nothing stops someone dropping in anything:
    // never let a PDF's own font programs be compiled to JavaScript.
    isEvalSupported: false,
    standardFontDataUrl: new URL('pdfjs/standard_fonts/', document.baseURI).href,
  }).promise;

  const pages: PageSource[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
    pages.push({
      fileName: file.name,
      pageNumber: n,
      pageCount: doc.numPages,
      widthMm: (viewport.width / PT_PER_INCH) * MM_PER_INCH,
      heightMm: (viewport.height / PT_PER_INCH) * MM_PER_INCH,
      text,
      async render(dpi) {
        const scaled = page.getViewport({ scale: dpi / PT_PER_INCH });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(scaled.width);
        canvas.height = Math.ceil(scaled.height);
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: scaled }).promise;
        return canvas;
      },
    });
  }
  return pages;
}

/**
 * Images have pixels but no physical size. Assume the long side is A4's 297 mm, which
 * is right for a scan or screenshot of a whole label sheet, and only affects how the
 * detector reads its millimetre thresholds otherwise — the output is always scaled to
 * fill the label regardless.
 */
async function pageFromImage(file: File): Promise<PageSource> {
  const bitmap = await createImageBitmap(file);
  const long = Math.max(bitmap.width, bitmap.height);
  const mmPerPx = 297 / long;
  return imagePage(file.name, bitmap, bitmap.width * mmPerPx, bitmap.height * mmPerPx);
}

/** A page backed by an already-drawn image, rendered by resampling. */
export function imagePage(
  fileName: string,
  image: CanvasImageSource & { width: number; height: number },
  widthMm: number,
  heightMm: number,
): PageSource {
  return {
    fileName,
    pageNumber: 1,
    pageCount: 1,
    widthMm,
    heightMm,
    text: '',
    async render(dpi) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round((widthMm / MM_PER_INCH) * dpi));
      canvas.height = Math.max(1, Math.round((heightMm / MM_PER_INCH) * dpi));
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas;
    },
  };
}
