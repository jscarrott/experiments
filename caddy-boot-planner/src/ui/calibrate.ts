import type { Dim, Provenance, VehicleProfile } from '../model/types.js';
import { CADDY_MAXI_LIFE_2K, cloneProfile } from '../model/vehicle.js';
import type { AppState } from '../state.js';
import { clear, el } from './dom.js';

/**
 * The calibrate panel.
 *
 * This is not a settings screen tucked away in a corner — it is the honest centre
 * of the tool. Half the shipped dimensions are inferred from published load volumes
 * rather than measured, and every check downstream inherits that uncertainty. So
 * each field wears its provenance openly, and typing your own number promotes it to
 * `measured` and marks it as trustworthy.
 */

const PROVENANCE_LABEL: Record<Provenance, string> = {
  published: 'VW figure',
  derived: 'calculated',
  estimated: 'guess',
  measured: 'you measured',
};

const PROVENANCE_HINT: Record<Provenance, string> = {
  published: 'From a VW spec sheet for this bodyshell.',
  derived: 'Calculated from published figures. Close, but check it.',
  estimated: 'An educated guess. This one really wants a tape measure.',
  measured: 'Your own measurement.',
};

type DimKey = {
  [K in keyof VehicleProfile]: VehicleProfile[K] extends Dim ? K : never;
}[keyof VehicleProfile];

const FIELDS: { key: DimKey; label: string; unit?: string }[] = [
  { key: 'floorLength', label: 'Floor length (seats to load lip)' },
  { key: 'floorWidth', label: 'Floor width (widest)' },
  { key: 'widthBetweenArches', label: 'Width between wheel arches' },
  { key: 'loadHeight', label: 'Floor to roof lining' },
  { key: 'widthAtRoof', label: 'Width at roof height' },
  { key: 'archHeight', label: 'Wheel arch height' },
  { key: 'archLength', label: 'Wheel arch length' },
  { key: 'archStartY', label: 'Seats to front of arch' },
  { key: 'apertureWidth', label: 'Tailgate opening width' },
  { key: 'apertureHeight', label: 'Tailgate opening height' },
  { key: 'sillHeight', label: 'Ground to load lip' },
  { key: 'payloadKg', label: 'Payload', unit: 'kg' },
];

export function buildCalibratePanel(state: AppState, onProfileChange: () => void): HTMLElement {
  const panel = el('div', { class: 'panel panel--calibrate' });

  const render = () => {
    clear(panel);
    const profile = state.layout.vehicle;

    const unmeasured = FIELDS.filter((f) => profile[f.key].provenance !== 'measured'
      && profile[f.key].provenance !== 'published').length;

    panel.append(
      el('h2', { class: 'panel__heading', text: 'Calibrate' }),
      el('p', { class: 'panel__hint' }, [
        'VW published load dimensions for the Caddy ',
        el('em', { text: 'van' }),
        ', not the Life with its second row in. Widths carry over; lengths do not. ',
        unmeasured > 0
          ? el('strong', {
              text: `${unmeasured} of these are still calculated or guessed — measure those first.`,
            })
          : el('strong', { text: 'All the important ones are measured. Nice.' }),
      ]),
    );

    const grid = el('div', { class: 'calibrate' });

    for (const field of FIELDS) {
      const value = profile[field.key];
      grid.append(
        el('label', { class: `calibrate__field calibrate__field--${value.provenance}` }, [
          el('span', { class: 'calibrate__label' }, [
            field.label,
            el('span', {
              class: `calibrate__tag calibrate__tag--${value.provenance}`,
              text: PROVENANCE_LABEL[value.provenance],
              title: PROVENANCE_HINT[value.provenance] + (value.note ? `\n\n${value.note}` : ''),
            }),
          ]),
          el('span', { class: 'field__input' }, [
            el('input', {
              class: 'input',
              type: 'number',
              value: String(Math.round(value.value)),
              step: field.unit === 'kg' ? '10' : '5',
              onchange: (e: Event) => {
                const parsed = Number((e.target as HTMLInputElement).value);
                if (Number.isNaN(parsed) || parsed <= 0) return;
                // Typing your own number is a measurement, and is trusted as one.
                profile[field.key] = { value: parsed, provenance: 'measured' };
                syncAnchorsToFloor(profile);
                state.recompute();
                onProfileChange();
                render();
              },
            }),
            el('span', { class: 'field__unit', text: field.unit ?? 'mm' }),
          ]),
          value.note ? el('span', { class: 'field__hint', text: value.note }) : undefined,
        ]),
      );
    }

    panel.append(grid);

    panel.append(
      el('h3', { class: 'panel__subheading', text: 'Rear doors' }),
      el('div', { class: 'row' }, [
        radio('Tailgate', profile.rearDoors === 'tailgate', () => {
          profile.rearDoors = 'tailgate';
          state.recompute();
          onProfileChange();
          render();
        }),
        radio('Barn doors', profile.rearDoors === 'barn', () => {
          profile.rearDoors = 'barn';
          state.recompute();
          onProfileChange();
          render();
        }),
      ]),
      el('p', {
        class: 'panel__hint',
        text: 'The Maxi came both ways, and barn doors give a slightly bigger opening.',
      }),
    );

    panel.append(
      el('button', {
        class: 'button button--small',
        type: 'button',
        text: 'Reset to shipped defaults',
        onclick: () => {
          state.layout.vehicle = cloneProfile(CADDY_MAXI_LIFE_2K);
          state.recompute();
          onProfileChange();
          render();
        },
      }),
    );
  };

  render();
  return panel;
}

/**
 * Anchors and brackets are positioned as fractions of the floor, so when the floor
 * length changes they have to move with it — otherwise correcting the length leaves
 * the lashing eyes hanging outside the van.
 */
function syncAnchorsToFloor(profile: VehicleProfile): void {
  const length = profile.floorLength.value;
  const sideX = profile.widthBetweenArches.value / 2 - 40;
  const rearX = profile.floorWidth.value / 2 - 180;

  const positions: Record<string, { x: number; y: number }> = {
    'eye-fl': { x: -sideX, y: 90 },
    'eye-fr': { x: sideX, y: 90 },
    'eye-ml': { x: -sideX, y: length * 0.55 },
    'eye-mr': { x: sideX, y: length * 0.55 },
    'eye-rl': { x: -rearX, y: length - 90 },
    'eye-rr': { x: rearX, y: length - 90 },
  };

  for (const anchor of profile.anchors) {
    const target = positions[anchor.id];
    if (target) {
      anchor.x = target.x;
      anchor.y = target.y;
    }
  }

  for (const obstruction of profile.floorObstructions) {
    obstruction.y = length * 0.62;
  }
}

function radio(label: string, checked: boolean, onSelect: () => void): HTMLElement {
  return el('label', { class: 'field field--check' }, [
    el('input', { type: 'radio', name: 'rear-doors', checked, onchange: onSelect }),
    el('span', { class: 'field__label', text: label }),
  ]);
}
