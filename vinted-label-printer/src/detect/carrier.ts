/**
 * Work out who the label is for from the text in the PDF.
 *
 * Vinted's label PDFs carry real text, so this is a word count rather than any kind
 * of image recognition. It counts rather than stopping at the first hit because the
 * instructions printed around a label sometimes name a second carrier ("drop it at an
 * InPost locker or an Evri ParcelShop"); the carrier whose own label it is gets named
 * far more often — in its logo text, its service name and its terms.
 */

export type Carrier = 'royal-mail' | 'evri' | 'inpost' | 'dpd' | 'yodel' | 'unknown';

export const CARRIER_NAMES: Record<Carrier, string> = {
  'royal-mail': 'Royal Mail',
  evri: 'Evri',
  inpost: 'InPost',
  dpd: 'DPD',
  yodel: 'Yodel',
  unknown: 'Unknown carrier',
};

const PATTERNS: [Exclude<Carrier, 'unknown'>, RegExp][] = [
  ['royal-mail', /royal\s*mail|parcelforce|tracked\s*(?:24|48)/gi],
  // Evri was Hermes until 2022, and older label templates still say so.
  ['evri', /\bevri\b|\bhermes\b/gi],
  ['inpost', /\binpost\b|\bparcel\s*locker/gi],
  ['dpd', /\bdpd\b/gi],
  ['yodel', /\byodel\b/gi],
];

export function detectCarrier(text: string): Carrier {
  let best: Carrier = 'unknown';
  let bestCount = 0;
  for (const [carrier, pattern] of PATTERNS) {
    const count = text.match(pattern)?.length ?? 0;
    if (count > bestCount) {
      best = carrier;
      bestCount = count;
    }
  }
  return best;
}
