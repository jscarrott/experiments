import type { Layout } from './types.js';
import { CATALOGUE_BY_ID } from './catalogue.js';

/**
 * Saving and loading.
 *
 * Everything is wrapped in try/catch because browser storage throws outright in
 * more situations than people expect — a private window, site data blocked, a
 * thumbnail capture context. A planner that white-screens because it could not
 * read a saved layout would be worse than one that just starts empty.
 */

const STORAGE_KEY = 'caddy-boot-planner:layouts';
const CURRENT_KEY = 'caddy-boot-planner:current';

export function saveCurrent(layout: Layout): void {
  try {
    localStorage.setItem(CURRENT_KEY, JSON.stringify({ ...layout, savedAt: new Date().toISOString() }));
  } catch {
    // Storage unavailable. The layout lives in memory; export still works.
  }
}

export function loadCurrent(): Layout | undefined {
  try {
    const raw = localStorage.getItem(CURRENT_KEY);
    return raw ? parseLayout(raw) : undefined;
  } catch {
    return undefined;
  }
}

export function listSaved(): { name: string; savedAt: string }[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const all = JSON.parse(raw) as Record<string, Layout>;
    return Object.values(all)
      .map((l) => ({ name: l.name, savedAt: l.savedAt }))
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  } catch {
    return [];
  }
}

export function saveNamed(layout: Layout, name: string): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, Layout>) : {};
    all[name] = { ...layout, name, savedAt: new Date().toISOString() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

export function loadNamed(name: string): Layout | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const all = JSON.parse(raw) as Record<string, Layout>;
    const found = all[name];
    return found ? validate(found) : undefined;
  } catch {
    return undefined;
  }
}

export function deleteNamed(name: string): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const all = JSON.parse(raw) as Record<string, Layout>;
    delete all[name];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Nothing to do.
  }
}

export function exportJson(layout: Layout): string {
  return JSON.stringify(layout, null, 2);
}

export function parseLayout(raw: string): Layout {
  return validate(JSON.parse(raw) as Layout);
}

/**
 * Enough validation to fail with a useful message rather than throw somewhere deep
 * in the geometry. Boxes referencing specs that no longer exist are dropped, since
 * one stale entry should not make the whole layout unloadable.
 */
function validate(layout: Layout): Layout {
  if (!layout || typeof layout !== 'object') throw new Error('That is not a layout file.');
  if (layout.schemaVersion !== 1) {
    throw new Error(`Unsupported layout version ${layout.schemaVersion}. This tool reads version 1.`);
  }
  if (!layout.vehicle || !Array.isArray(layout.boxes)) {
    throw new Error('Layout is missing its vehicle profile or box list.');
  }

  const known = layout.boxes.filter((b) => CATALOGUE_BY_ID.has(b.specId));
  const dropped = layout.boxes.length - known.length;
  if (dropped > 0) {
    console.warn(`Dropped ${dropped} box(es) referencing box types this version does not know about.`);
  }

  return {
    ...layout,
    boxes: known,
    straps: Array.isArray(layout.straps) ? layout.straps : [],
    nets: Array.isArray(layout.nets) ? layout.nets : [],
    unrestrainedWarnKg: layout.unrestrainedWarnKg ?? 5,
  };
}
