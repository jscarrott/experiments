import type { Dim, FloorObstruction, Provenance, VehicleProfile } from '../model/types.js';
import { CADDY_MAXI_LIFE_2K, cloneProfile } from '../model/vehicle.js';
import type { AppState } from '../state.js';
import { clear, el } from './dom.js';

/**
 * The calibrate panel.
 *
 * This is not a settings screen tucked away in a corner — it is the honest centre of
 * the tool. Every check downstream inherits the uncertainty in these numbers, so each
 * field wears its provenance openly, and typing your own number promotes it to
 * `measured`.
 *
 * The floor obstructions section matters as much as the dimensions: the third-row
 * rails ship as estimates derived from the seat position, and until you can type real
 * numbers in, every "will it sit flat" answer is a guess.
 */

const PROVENANCE_LABEL: Record<Provenance, string> = {
  published: 'VW figure',
  derived: 'calculated',
  estimated: 'guess',
  reference: 'measured for this model',
  measured: 'you measured',
};

const PROVENANCE_HINT: Record<Provenance, string> = {
  published: 'From a VW spec sheet for this bodyshell.',
  derived: 'Calculated from published figures. Close, but check it.',
  estimated: 'An educated guess. This one really wants a tape measure.',
  reference:
    'Measured on this exact model by kofferraum.org. Trustworthy — but it was their ' +
    'van, so trim levels and wear could still move it a little.',
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

    const TRUSTED: Provenance[] = ['measured', 'published', 'reference'];
    const unmeasured = FIELDS.filter((f) => !TRUSTED.includes(profile[f.key].provenance)).length;

    panel.append(
      el('h2', { class: 'panel__heading', text: 'Calibrate' }),
      el('p', { class: 'panel__hint' }, [
        'The bay dimensions are measured figures for this model rather than VW ',
        el('em', { text: 'van' }),
        ' shell figures, which describe bare metal you cannot load against. ',
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

    panel.append(buildObstructionSection(state, profile, onProfileChange, render));

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
 * Lashing eye positions are guesses pinned to the bay proportions, so when you correct
 * the floor length they have to move with it — otherwise the eyes end up hanging
 * outside the van.
 *
 * Floor obstructions deliberately do *not* move. They are physical objects at fixed
 * positions, not fractions of the bay, and this used to reset them on every edit —
 * which silently threw away a rail position the moment you corrected anything else.
 */
function syncAnchorsToFloor(profile: VehicleProfile): void {
  const length = profile.floorLength.value;
  const sideX = profile.floorWidth.value / 2 - 40;
  const rearX = profile.floorWidth.value / 2 - 120;

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
}

/**
 * Rails, brackets and anything else proud of the boot floor.
 *
 * Editable because the shipped rails are estimates and yours are whatever they are.
 * The five numbers that matter are the ones asked for here; measure the rail itself,
 * not the seat that used to sit on it.
 */
function buildObstructionSection(
  state: AppState,
  profile: VehicleProfile,
  onProfileChange: () => void,
  rerender: () => void,
): HTMLElement {
  const section = el('div', { class: 'panel__section' });

  const changed = () => {
    state.recompute();
    onProfileChange();
    rerender();
  };

  section.append(
    el('h3', { class: 'panel__subheading', text: 'Floor obstructions' }),
    el('p', {
      class: 'panel__hint',
      text:
        'The rails the third row bolted to. A crate straddling both sits level, just ' +
        'raised — it is a crate caught on one that rocks. These are estimates.',
    }),
  );

  if (profile.floorObstructions.length === 0) {
    section.append(el('p', { class: 'panel__empty', text: 'Nothing in the floor.' }));
  }

  for (const obstruction of profile.floorObstructions) {
    section.append(
      el('div', { class: 'obstruction' }, [
        el('div', { class: 'obstruction__head' }, [
          el('input', {
            class: 'input input--label',
            value: obstruction.label,
            'aria-label': 'Obstruction name',
            onchange: (e: Event) => {
              obstruction.label = (e.target as HTMLInputElement).value;
              changed();
            },
          }),
          el('button', {
            class: 'button button--icon',
            type: 'button',
            text: '×',
            title: 'Remove',
            onclick: () => {
              profile.floorObstructions = profile.floorObstructions.filter(
                (o) => o.id !== obstruction.id,
              );
              changed();
            },
          }),
        ]),
        el('div', { class: 'field-grid field-grid--pairs' }, [
          obstructionField('Across', obstruction.x, (v) => {
            obstruction.x = v;
            changed();
          }, '0 is the centreline'),
          obstructionField('From seats', obstruction.y, (v) => {
            obstruction.y = v;
            changed();
          }, 'To its centre'),
          obstructionField('Width', obstruction.width, (v) => {
            obstruction.width = Math.max(1, v);
            changed();
          }, 'Across the van'),
          obstructionField('Length', obstruction.depth, (v) => {
            obstruction.depth = Math.max(1, v);
            changed();
          }, 'Along the van'),
          obstructionField('Height', obstruction.height, (v) => {
            obstruction.height = Math.max(1, v);
            changed();
          }, 'Above the floor'),
        ]),
      ]),
    );
  }

  section.append(
    el('button', {
      class: 'button button--small',
      type: 'button',
      text: 'Add an obstruction',
      onclick: () => {
        const next: FloorObstruction = {
          id: `obstruction-${Date.now().toString(36)}`,
          label: 'Floor obstruction',
          x: 0,
          y: Math.round(profile.floorLength.value / 2),
          width: 60,
          depth: 400,
          height: 25,
        };
        profile.floorObstructions = [...profile.floorObstructions, next];
        changed();
      },
    }),
  );

  return section;
}

function obstructionField(
  label: string,
  value: number,
  onChange: (value: number) => void,
  hint: string,
): HTMLElement {
  return el('label', { class: 'field' }, [
    el('span', { class: 'field__label', text: label }),
    el('span', { class: 'field__input' }, [
      el('input', {
        class: 'input',
        type: 'number',
        value: String(Math.round(value)),
        step: '5',
        onchange: (e: Event) => {
          const parsed = Number((e.target as HTMLInputElement).value);
          if (!Number.isNaN(parsed)) onChange(parsed);
        },
      }),
      el('span', { class: 'field__unit', text: 'mm' }),
    ]),
    el('span', { class: 'field__hint', text: hint }),
  ]);
}

function radio(label: string, checked: boolean, onSelect: () => void): HTMLElement {
  return el('label', { class: 'field field--check' }, [
    el('input', { type: 'radio', name: 'rear-doors', checked, onchange: onSelect }),
    el('span', { class: 'field__label', text: label }),
  ]);
}
