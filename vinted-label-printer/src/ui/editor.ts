/**
 * The manual crop editor: the page with the crop box over it, drag the box or its
 * handles, and see the finished label update alongside.
 */

import { CARRIER_NAMES } from '../detect/carrier.js';
import { clampRect, FULL_PAGE, sameRect, type Rect } from '../detect/rect.js';
import type { Job } from '../jobs.js';
import { drawLabel, type LabelSettings } from '../output/label.js';
import { loadPreset, savePreset, shapeKey } from '../store.js';

type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const HANDLES: Handle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

export function openEditor(job: Job, settings: () => LabelSettings, onChange: () => void): void {
  const dialog = document.querySelector<HTMLDialogElement>('#editor')!;
  const stage = dialog.querySelector<HTMLDivElement>('.editor-stage')!;
  const result = dialog.querySelector<HTMLDivElement>('.editor-result')!;
  const title = dialog.querySelector<HTMLElement>('.editor-title')!;
  const saveButton = dialog.querySelector<HTMLButtonElement>('[data-action="save"]')!;
  const forgetButton = dialog.querySelector<HTMLButtonElement>('[data-action="forget"]')!;
  const savedNote = dialog.querySelector<HTMLElement>('.editor-saved')!;

  const shape = shapeKey(job.page.widthMm, job.page.heightMm);
  const carrierName = job.carrier === 'unknown' ? 'pages like this' : `${CARRIER_NAMES[job.carrier]} labels`;
  title.textContent = `${job.page.fileName} — page ${job.page.pageNumber} of ${job.page.pageCount}`;
  saveButton.textContent = `Use this crop for all ${carrierName}`;

  const preview = job.preview;
  preview.classList.add('editor-page');
  const box = document.createElement('div');
  box.className = 'crop-box';
  box.dataset.handle = 'move';
  box.setAttribute('aria-label', 'Crop area. Drag to move; drag the handles to resize; arrow keys nudge.');
  box.tabIndex = 0;
  for (const h of HANDLES) {
    const handle = document.createElement('span');
    handle.className = `crop-handle crop-${h}`;
    handle.dataset.handle = h;
    box.append(handle);
  }
  stage.replaceChildren(preview, box);

  const refresh = () => {
    const c = job.crop;
    box.style.left = `${c.x * 100}%`;
    box.style.top = `${c.y * 100}%`;
    box.style.width = `${c.w * 100}%`;
    box.style.height = `${c.h * 100}%`;
    const label = drawLabel(job.page, preview, c, settings(), 96, false);
    label.className = 'editor-label';
    result.replaceChildren(label);
    const saved = loadPreset(job.carrier, shape);
    forgetButton.hidden = !saved;
    savedNote.textContent = saved
      ? sameRect(saved, c)
        ? `Saved as the crop for ${carrierName}.`
        : `A different crop is saved for ${carrierName}.`
      : '';
  };

  const setCrop = (rect: Rect, origin: Job['origin']) => {
    job.crop = clampRect(rect);
    job.origin = origin;
    refresh();
    onChange();
  };

  let drag: { handle: Handle; startX: number; startY: number; start: Rect } | undefined;
  const onDown = (e: PointerEvent) => {
    const handle = (e.target as HTMLElement).dataset.handle as Handle | undefined;
    if (!handle) return;
    e.preventDefault();
    box.setPointerCapture(e.pointerId);
    drag = { handle, startX: e.clientX, startY: e.clientY, start: { ...job.crop } };
  };
  const onMove = (e: PointerEvent) => {
    if (!drag) return;
    const bounds = stage.getBoundingClientRect();
    const dx = (e.clientX - drag.startX) / bounds.width;
    const dy = (e.clientY - drag.startY) / bounds.height;
    setCrop(resize(drag.start, drag.handle, dx, dy), 'manual');
  };
  const onUp = () => (drag = undefined);
  const onKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.01 : 0.002;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    setCrop(resize(job.crop, e.altKey ? 'se' : 'move', move[0], move[1]), 'manual');
  };
  box.addEventListener('pointerdown', onDown);
  box.addEventListener('pointermove', onMove);
  box.addEventListener('pointerup', onUp);
  box.addEventListener('pointercancel', onUp);
  box.addEventListener('keydown', onKey);

  const actions = new AbortController();
  dialog.addEventListener(
    'click',
    (e) => {
      const action = (e.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action === 'auto') setCrop(job.detected, sameRect(job.detected, FULL_PAGE) ? 'whole' : 'auto');
      if (action === 'whole') setCrop(FULL_PAGE, 'whole');
      if (action === 'save') {
        savePreset(job.carrier, shape, job.crop);
        refresh();
        onChange();
      }
      if (action === 'forget') {
        savePreset(job.carrier, shape, undefined);
        refresh();
        onChange();
      }
      if (action === 'close') dialog.close();
    },
    { signal: actions.signal },
  );
  dialog.addEventListener(
    'close',
    () => {
      actions.abort();
      box.remove();
    },
    { once: true },
  );

  refresh();
  dialog.showModal();
  box.focus();
}

/** Apply a drag of (dx, dy), in page fractions, to the given handle. */
export function resize(start: Rect, handle: Handle, dx: number, dy: number): Rect {
  const min = 0.02;
  let { x, y, w, h } = start;
  if (handle === 'move') {
    x = Math.min(1 - w, Math.max(0, x + dx));
    y = Math.min(1 - h, Math.max(0, y + dy));
    return { x, y, w, h };
  }
  if (handle.includes('w')) {
    const nx = Math.min(x + w - min, Math.max(0, x + dx));
    w += x - nx;
    x = nx;
  }
  if (handle.includes('e')) w = Math.min(1 - x, Math.max(min, w + dx));
  if (handle.includes('n')) {
    const ny = Math.min(y + h - min, Math.max(0, y + dy));
    h += y - ny;
    y = ny;
  }
  if (handle.includes('s')) h = Math.min(1 - y, Math.max(min, h + dy));
  return { x, y, w, h };
}
