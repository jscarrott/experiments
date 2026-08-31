import type { PlacedBox } from '../model/types.js';
import { dimsOf } from '../geometry/boxes.js';
import type { AppState } from '../state.js';
import { clear, el, kg, mm } from './dom.js';

/**
 * Properties of the selected box. Position is editable numerically as well as by
 * dragging, because "600 from the seat backs" is often exactly what you want and
 * is fiddly to hit with a mouse.
 */
export function buildInspector(state: AppState): HTMLElement {
  const panel = el('div', { class: 'panel panel--inspector' });

  const render = () => {
    clear(panel);
    const box = state.selectedBox;

    if (!box) {
      panel.append(
        el('h2', { class: 'panel__heading', text: 'Box' }),
        el('p', {
          class: 'panel__empty',
          text: 'Select a box in the van or in the list to edit it.',
        }),
      );
      return;
    }

    const spec = state.lookup(box.specId);
    const dims = dimsOf(spec, box);
    const weight = spec.emptyWeightKg.value + box.contentsKg;
    const issues = state.analysis.byBox.get(box.id) ?? [];

    panel.append(
      el('h2', { class: 'panel__heading', text: 'Box' }),
      el('input', {
        class: 'input input--label',
        value: box.label,
        'aria-label': 'Box name',
        onchange: (e: Event) =>
          state.updateBox(box.id, { label: (e.target as HTMLInputElement).value }),
      }),
      el('p', { class: 'inspector__spec', text: `${spec.system} · ${spec.name}` }),
    );

    if (issues.length > 0) {
      const list = el('ul', { class: 'inspector__issues' });
      for (const issue of issues) {
        list.append(el('li', { class: `inspector__issue inspector__issue--${issue.severity}`, text: issue.message }));
      }
      panel.append(list);
    }

    // --- Position ----------------------------------------------------------
    panel.append(
      el('h3', { class: 'panel__subheading', text: 'Position' }),
      el('div', { class: 'field-grid' }, [
        numberField('Across', box.x, (v) => state.updateBox(box.id, { x: v }), {
          hint: '0 is the centreline',
        }),
        numberField('From seats', box.y, (v) => state.updateBox(box.id, { y: v }), {
          hint: '0 is against the second row',
        }),
        numberField('Height', box.z, (v) => state.updateBox(box.id, { z: v }), {
          hint: 'Underside above the floor',
        }),
      ]),
      el('div', { class: 'row' }, [
        el('button', {
          class: 'button',
          type: 'button',
          text: 'Rotate 90°',
          onclick: () =>
            state.updateBox(box.id, { rotation: (((box.rotation + 90) % 360) as PlacedBox['rotation']) }),
        }),
        el('span', { class: 'row__note', text: `${dims.width} × ${dims.depth} × ${dims.height} mm` }),
      ]),
    );

    // --- Weight and access -------------------------------------------------
    panel.append(
      el('h3', { class: 'panel__subheading', text: 'Contents' }),
      el('div', { class: 'field-grid' }, [
        numberField('Contents', box.contentsKg, (v) => state.updateBox(box.id, { contentsKg: Math.max(0, v) }), {
          unit: 'kg',
          step: 0.5,
          hint: `Empty box is ${kg(spec.emptyWeightKg.value)}`,
        }),
      ]),
      el('p', { class: 'inspector__total', text: `Loaded weight: ${kg(weight)}` }),
      checkboxField('Needed often', box.needOften, (v) => state.updateBox(box.id, { needOften: v }),
        'Warns if this ends up buried behind or under other boxes'),
    );

    // --- Measured overrides ------------------------------------------------
    panel.append(
      el('h3', { class: 'panel__subheading', text: 'Measured size' }),
      el('p', {
        class: 'panel__hint',
        text: 'Catalogue sizes are close but brands vary. Put your own measurements in here.',
      }),
      el('div', { class: 'field-grid' }, [
        overrideField('Width', spec.width.value, box.overrides?.width, (v) =>
          setOverride(state, box, 'width', v),
        ),
        overrideField('Depth', spec.depth.value, box.overrides?.depth, (v) =>
          setOverride(state, box, 'depth', v),
        ),
        overrideField('Height', spec.height.value, box.overrides?.height, (v) =>
          setOverride(state, box, 'height', v),
        ),
      ]),
    );

    panel.append(
      el('div', { class: 'row row--actions' }, [
        el('button', {
          class: 'button',
          type: 'button',
          text: 'Duplicate',
          onclick: () => state.duplicateBox(box.id),
        }),
        el('button', {
          class: 'button button--danger',
          type: 'button',
          text: 'Remove',
          onclick: () => state.removeBox(box.id),
        }),
      ]),
    );
  };

  render();
  state.subscribe(render);
  return panel;
}

function setOverride(
  state: AppState,
  box: PlacedBox,
  key: 'width' | 'depth' | 'height',
  value: number | undefined,
): void {
  const overrides = { ...(box.overrides ?? {}) };
  if (value === undefined || Number.isNaN(value) || value <= 0) delete overrides[key];
  else overrides[key] = value;
  state.updateBox(box.id, {
    overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
  });
}

function numberField(
  label: string,
  value: number,
  onChange: (value: number) => void,
  opts: { unit?: string; step?: number; hint?: string } = {},
): HTMLElement {
  return el('label', { class: 'field' }, [
    el('span', { class: 'field__label', text: label }),
    el('span', { class: 'field__input' }, [
      el('input', {
        class: 'input',
        type: 'number',
        value: String(Math.round(value * 10) / 10),
        step: String(opts.step ?? 5),
        onchange: (e: Event) => {
          const parsed = Number((e.target as HTMLInputElement).value);
          if (!Number.isNaN(parsed)) onChange(parsed);
        },
      }),
      el('span', { class: 'field__unit', text: opts.unit ?? 'mm' }),
    ]),
    opts.hint ? el('span', { class: 'field__hint', text: opts.hint }) : undefined,
  ]);
}

/** A dimension field that shows the catalogue value as its placeholder. */
function overrideField(
  label: string,
  catalogueValue: number,
  override: number | undefined,
  onChange: (value: number | undefined) => void,
): HTMLElement {
  return el('label', { class: 'field' }, [
    el('span', { class: 'field__label', text: label }),
    el('span', { class: 'field__input' }, [
      el('input', {
        class: 'input',
        type: 'number',
        value: override !== undefined ? String(override) : '',
        placeholder: String(catalogueValue),
        step: '1',
        onchange: (e: Event) => {
          const raw = (e.target as HTMLInputElement).value.trim();
          onChange(raw === '' ? undefined : Number(raw));
        },
      }),
      el('span', { class: 'field__unit', text: 'mm' }),
    ]),
    el('span', {
      class: 'field__hint',
      text: override !== undefined ? `catalogue says ${mm(catalogueValue)}` : 'using catalogue size',
    }),
  ]);
}

function checkboxField(
  label: string,
  checked: boolean,
  onChange: (value: boolean) => void,
  hint?: string,
): HTMLElement {
  return el('label', { class: 'field field--check' }, [
    el('input', {
      type: 'checkbox',
      checked,
      onchange: (e: Event) => onChange((e.target as HTMLInputElement).checked),
    }),
    el('span', { class: 'field__label', text: label }),
    hint ? el('span', { class: 'field__hint', text: hint }) : undefined,
  ]);
}
