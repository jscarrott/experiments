/**
 * A job is one page that may become one label: the page, a preview render of it, who
 * it is for, and the crop to print.
 */

import { CARRIER_NAMES, detectCarrier, type Carrier } from './detect/carrier.js';
import { findLabel, inkMapFromRgba } from './detect/crop.js';
import { FULL_PAGE, type Rect } from './detect/rect.js';
import { isLabelSized } from './layout/fit.js';
import { pagesFromFile, type PageSource } from './source.js';
import { loadPreset, shapeKey } from './store.js';

/** Enough to find a label and to see a crop on screen; nowhere near print quality. */
export const PREVIEW_DPI = 100;

/** Where the current crop came from, so the list can say so. */
export type CropOrigin = 'auto' | 'saved' | 'whole' | 'manual';

export interface Job {
  id: number;
  page: PageSource;
  preview: HTMLCanvasElement;
  carrier: Carrier;
  /** What the detector found, kept so "Auto-detect" can put it back after edits. */
  detected: Rect;
  crop: Rect;
  origin: CropOrigin;
  include: boolean;
}

let nextId = 1;

export interface FileResult {
  jobs: Job[];
  /** Pages with nothing on them — Vinted's PDFs often carry a blank second page. */
  blankPages: number;
}

export async function jobsFromFile(file: File): Promise<FileResult> {
  const pages = await pagesFromFile(file);
  const jobs: Job[] = [];
  let blankPages = 0;
  for (const page of pages) {
    const job = await jobFromPage(page);
    if (job) jobs.push(job);
    else blankPages++;
  }
  return { jobs, blankPages };
}

/** A job for a page, or undefined if the page is blank. */
export async function jobFromPage(page: PageSource, wholePage = false): Promise<Job | undefined> {
  const preview = await page.render(PREVIEW_DPI);
  const ctx = preview.getContext('2d', { willReadFrequently: true })!;
  const pixels = ctx.getImageData(0, 0, preview.width, preview.height).data;
  const detection = findLabel(inkMapFromRgba(pixels, preview.width, preview.height, preview.width / page.widthMm));
  if (detection.blank) return undefined;

  const carrier = detectCarrier(page.text);
  const whole = wholePage || isLabelSized(page.widthMm, page.heightMm);
  const detected = whole ? FULL_PAGE : detection.rect;
  const saved = whole ? undefined : loadPreset(carrier, shapeKey(page.widthMm, page.heightMm));
  return {
    id: nextId++,
    page,
    preview,
    carrier,
    detected,
    crop: saved ?? detected,
    origin: saved ? 'saved' : whole ? 'whole' : 'auto',
    include: true,
  };
}

export function describeOrigin(job: Job): string {
  switch (job.origin) {
    case 'auto':
      return 'Cropped automatically';
    case 'saved':
      return `Your saved ${job.carrier === 'unknown' ? '' : `${CARRIER_NAMES[job.carrier]} `}crop`;
    case 'whole':
      return 'Whole page';
    case 'manual':
      return 'Adjusted by hand';
  }
}
