import { deleteNamed, exportJson, listSaved, loadNamed, parseLayout, saveNamed } from '../model/layout.js';
import type { AppState } from '../state.js';
import type { ViewName } from '../scene/viewer.js';
import { copyToClipboard, el, toast } from './dom.js';

/**
 * Top bar: view presets, snap setting, and save/load.
 *
 * Export goes through the clipboard rather than a download. A published artifact
 * runs in a sandbox where page-initiated downloads are inert, so a download button
 * would silently do nothing — the single most annoying kind of broken. Copy works
 * everywhere, so it is the primary path and the download is the extra.
 */

export interface ToolbarOptions {
  onView(view: ViewName): void;
  onSnapChange(mm: number): void;
  snap: number;
}

const VIEWS: { name: ViewName; label: string; title: string }[] = [
  { name: 'iso', label: 'Iso', title: 'Three-quarter view' },
  { name: 'tailgate', label: 'Tailgate', title: 'What you see when you open the back' },
  { name: 'top', label: 'Top', title: 'Plan view, for footprints and gaps' },
  { name: 'side', label: 'Side', title: 'For stack heights against the roof' },
  { name: 'front', label: 'Front', title: 'Looking back from the second row' },
];

export function buildToolbar(state: AppState, options: ToolbarOptions): HTMLElement {
  const bar = el('header', { class: 'toolbar' });

  bar.append(
    el('div', { class: 'toolbar__brand' }, [
      el('span', { class: 'toolbar__title', text: 'Caddy Maxi boot planner' }),
      el('span', { class: 'toolbar__sub', text: 'Life 2K · third row out' }),
    ]),
  );

  const views = el('div', { class: 'toolbar__group', role: 'group', 'aria-label': 'Camera views' });
  for (const view of VIEWS) {
    views.append(
      el('button', {
        class: 'button button--view',
        type: 'button',
        text: view.label,
        title: view.title,
        onclick: () => options.onView(view.name),
      }),
    );
  }
  bar.append(views);

  const snap = el('label', { class: 'toolbar__snap' }, [
    el('span', { text: 'Snap' }),
    el(
      'select',
      {
        class: 'input input--select',
        onchange: (e: Event) => options.onSnapChange(Number((e.target as HTMLSelectElement).value)),
      },
      [1, 5, 10, 25, 50].map((value) =>
        el('option', { value: String(value), selected: value === options.snap }, [`${value} mm`]),
      ),
    ),
  ]);
  bar.append(snap);

  bar.append(buildSaveGroup(state));
  return bar;
}

function buildSaveGroup(state: AppState): HTMLElement {
  const group = el('div', { class: 'toolbar__group' });

  group.append(
    el('button', {
      class: 'button',
      type: 'button',
      text: 'Save',
      title: 'Save this layout under a name',
      onclick: () => {
        const name = prompt('Save this layout as:', state.layout.name);
        if (!name) return;
        state.layout.name = name;
        const ok = saveNamed(state.layout, name);
        toast(
          ok ? `Saved "${name}"` : 'Could not save — browser storage is unavailable here.',
          ok ? 'ok' : 'error',
        );
      },
    }),
    el('button', {
      class: 'button',
      type: 'button',
      text: 'Open',
      title: 'Load a saved layout',
      onclick: () => {
        const saved = listSaved();
        if (saved.length === 0) {
          toast('No saved layouts yet.', 'error');
          return;
        }
        const names = saved.map((s, i) => `${i + 1}. ${s.name}`).join('\n');
        const choice = prompt(`Which layout?\n\n${names}\n\nEnter a number:`);
        if (!choice) return;
        const picked = saved[Number(choice) - 1];
        if (!picked) return;
        const layout = loadNamed(picked.name);
        if (layout) {
          state.replaceLayout(layout);
          toast(`Opened "${picked.name}"`);
        } else {
          toast('Could not read that layout.', 'error');
        }
      },
    }),
    el('button', {
      class: 'button',
      type: 'button',
      text: 'Copy JSON',
      title: 'Copy this layout to the clipboard, to paste elsewhere or into another device',
      onclick: async () => {
        const ok = await copyToClipboard(exportJson(state.layout));
        toast(ok ? 'Layout copied to the clipboard' : 'Could not copy to the clipboard.', ok ? 'ok' : 'error');
      },
    }),
    el('button', {
      class: 'button',
      type: 'button',
      text: 'Paste JSON',
      title: 'Load a layout from JSON on the clipboard',
      onclick: () => {
        const raw = prompt('Paste a layout JSON here:');
        if (!raw) return;
        try {
          state.replaceLayout(parseLayout(raw));
          toast('Layout loaded');
        } catch (error) {
          toast(error instanceof Error ? error.message : 'That JSON did not parse.', 'error');
        }
      },
    }),
    el('button', {
      class: 'button button--danger',
      type: 'button',
      text: 'Clear',
      title: 'Remove every box',
      onclick: () => {
        if (state.layout.boxes.length === 0) return;
        if (!confirm(`Remove all ${state.layout.boxes.length} boxes? The vehicle profile is kept.`)) return;
        state.layout.boxes = [];
        state.layout.straps = [];
        state.select(undefined);
        state.recompute();
      },
    }),
  );

  return group;
}

export { deleteNamed };
