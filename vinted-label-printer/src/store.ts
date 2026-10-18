/**
 * What the app remembers between visits: the label settings, and the crop the user
 * settled on for each carrier. Both live in this browser only, and the app works
 * the same with storage blocked; it just forgets.
 */

import type { Carrier } from './detect/carrier.js';
import type { Rect } from './detect/rect.js';
import { LABEL_SIZES } from './layout/fit.js';

export interface StoredSettings {
  sizeId: string;
  marginMm: number;
  rotate: boolean;
  monochrome: boolean;
  dpi: number;
}

export const DEFAULT_SETTINGS: StoredSettings = {
  sizeId: LABEL_SIZES[0]!.id,
  marginMm: 2,
  rotate: true,
  monochrome: true,
  dpi: 203,
};

const SETTINGS_KEY = 'vinted-label-printer.settings';
const PRESETS_KEY = 'vinted-label-printer.presets';

/**
 * A saved crop applies to pages of the same shape only: a crop for an A4 sheet means
 * nothing on a 4×6 one. Pages are bucketed by orientation and rounded aspect ratio.
 */
export function shapeKey(widthMm: number, heightMm: number): string {
  return `${widthMm >= heightMm ? 'landscape' : 'portrait'}-${(Math.max(widthMm, heightMm) / Math.min(widthMm, heightMm)).toFixed(2)}`;
}

type Presets = Partial<Record<string, Rect>>;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked or full; settings just won't persist */
  }
}

export const loadSettings = () => read(SETTINGS_KEY, DEFAULT_SETTINGS);
export const saveSettings = (s: StoredSettings) => write(SETTINGS_KEY, s);

const presetKey = (carrier: Carrier, shape: string) => `${carrier}/${shape}`;

export function loadPreset(carrier: Carrier, shape: string): Rect | undefined {
  return read<Presets>(PRESETS_KEY, {})[presetKey(carrier, shape)];
}

export function savePreset(carrier: Carrier, shape: string, rect: Rect | undefined) {
  const presets = read<Presets>(PRESETS_KEY, {});
  if (rect) presets[presetKey(carrier, shape)] = rect;
  else delete presets[presetKey(carrier, shape)];
  write(PRESETS_KEY, presets);
}
