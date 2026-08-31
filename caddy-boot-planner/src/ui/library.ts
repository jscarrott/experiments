import { catalogueBySystem } from '../model/catalogue.js';
import type { AppState } from '../state.js';
import { clear, el } from './dom.js';

/**
 * The box catalogue picker, and the list of what is currently in the van.
 *
 * The list doubles as the selection UI, because in a 3D view with boxes stacked
 * inside each other, clicking the one you mean is not always possible.
 */
export function buildLibraryPanel(state: AppState): HTMLElement {
  const panel = el('div', { class: 'panel panel--library' });

  const catalogue = el('div', { class: 'panel__section' });
  catalogue.append(el('h2', { class: 'panel__heading', text: 'Add a box' }));

  for (const [system, specs] of catalogueBySystem()) {
    catalogue.append(el('h3', { class: 'panel__subheading', text: system }));
    const list = el('div', { class: 'catalogue' });

    for (const spec of specs) {
      list.append(
        el(
          'button',
          {
            class: 'catalogue__item',
            type: 'button',
            title: `${spec.width.value} × ${spec.depth.value} × ${spec.height.value} mm`,
            onclick: () => state.addBox(spec.id),
          },
          [
            el('span', { class: 'catalogue__swatch', style: `background:${spec.colour}` }),
            el('span', { class: 'catalogue__text' }, [
              el('span', { class: 'catalogue__name', text: shortName(spec.name) }),
              el('span', {
                class: 'catalogue__dims',
                text: `${spec.width.value}×${spec.depth.value}×${spec.height.value}`,
              }),
            ]),
            spec.stackMode === 'latching' &&
              el('span', { class: 'tag tag--latch', text: 'latches', title: 'Stacks into one rigid unit' }),
          ],
        ),
      );
    }
    catalogue.append(list);
  }

  const loaded = el('div', { class: 'panel__section' });
  panel.append(catalogue, loaded);

  const render = () => {
    clear(loaded);
    const { boxes } = state.layout;

    loaded.append(
      el('h2', { class: 'panel__heading' }, [
        `In the van`,
        el('span', { class: 'panel__count', text: String(boxes.length) }),
      ]),
    );

    if (boxes.length === 0) {
      loaded.append(
        el('p', {
          class: 'panel__empty',
          text: 'Nothing loaded yet. Pick a box above to drop it in.',
        }),
      );
      return;
    }

    const list = el('ul', { class: 'loaded' });
    for (const box of boxes) {
      const issues = state.analysis.byBox.get(box.id) ?? [];
      const worst = issues.some((i) => i.severity === 'error')
        ? 'error'
        : issues.length > 0
          ? 'warning'
          : undefined;

      list.append(
        el(
          'li',
          {
            class: [
              'loaded__item',
              box.id === state.selectedBoxId && 'loaded__item--selected',
              worst && `loaded__item--${worst}`,
            ]
              .filter(Boolean)
              .join(' '),
            onclick: () => state.select(box.id),
          },
          [
            el('span', {
              class: 'loaded__swatch',
              style: `background:${state.lookup(box.specId).colour}`,
            }),
            el('span', { class: 'loaded__name', text: box.label }),
            box.needOften && el('span', { class: 'tag tag--often', text: 'often', title: 'Needed often' }),
            worst && el('span', { class: `dot dot--${worst}`, title: issues[0]?.message ?? '' }),
          ],
        ),
      );
    }
    loaded.append(list);
  };

  render();
  state.subscribe(render);
  return panel;
}

/** Catalogue names carry the system prefix; the heading already says it. */
function shortName(name: string): string {
  return name.replace(/^TOUGHSYSTEM 2\.0 /, '').replace(/^ALC /, '');
}
