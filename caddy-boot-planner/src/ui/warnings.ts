import type { AppState } from '../state.js';
import { clear, el, kg } from './dom.js';

/**
 * Everything the analysis found, in one place, sorted worst first.
 *
 * Wording is deliberately plain and each entry says what to do about it. A panel
 * that reads "collision detected: box-3" tells you nothing you could not already
 * see from the red box.
 */
export function buildWarningsPanel(state: AppState): HTMLElement {
  const panel = el('div', { class: 'panel panel--warnings' });

  const render = () => {
    clear(panel);
    const { analysis } = state;

    const entries: { severity: 'error' | 'warning'; message: string; boxId?: string }[] = [];
    for (const i of analysis.fit) entries.push({ severity: i.severity, message: i.message, boxId: i.boxId });
    for (const i of analysis.stack) {
      entries.push({ severity: i.kind === 'overhang' ? 'error' : 'warning', message: i.message, boxId: i.boxId });
    }
    for (const i of analysis.restraint) entries.push({ severity: i.severity, message: i.message, boxId: i.boxId });
    for (const i of analysis.access) entries.push({ severity: i.severity, message: i.message, boxId: i.boxId });
    for (const i of analysis.mass) entries.push({ severity: i.severity, message: i.message });

    for (const net of analysis.netResults) {
      if (net.overStretched) {
        entries.push({
          severity: 'warning',
          message:
            `The net is stretched to about ${(net.stretchRatio * 100).toFixed(0)}% of its relaxed size. ` +
            `Past roughly double, the elastic is near its limit and holding much less than it looks like it is.`,
        });
      }
    }

    const errors = entries.filter((e) => e.severity === 'error');
    const warnings = entries.filter((e) => e.severity === 'warning');

    panel.append(
      el('h2', { class: 'panel__heading' }, [
        'Checks',
        errors.length > 0 && el('span', { class: 'badge badge--error', text: String(errors.length) }),
        warnings.length > 0 && el('span', { class: 'badge badge--warning', text: String(warnings.length) }),
      ]),
    );

    panel.append(buildSummary(state));

    if (entries.length === 0) {
      panel.append(
        el('p', {
          class: 'panel__empty panel__empty--good',
          text:
            state.layout.boxes.length === 0
              ? 'Nothing loaded yet.'
              : 'Everything fits, everything is held, and nothing is buried. Good to go.',
        }),
      );
      return;
    }

    const list = el('ul', { class: 'warnings' });
    for (const entry of [...errors, ...warnings]) {
      list.append(
        el(
          'li',
          {
            class: `warnings__item warnings__item--${entry.severity}`,
            onclick: entry.boxId ? () => state.select(entry.boxId) : undefined,
          },
          [el('span', { class: 'warnings__text', text: entry.message })],
        ),
      );
    }
    panel.append(list);
  };

  render();
  state.subscribe(render);
  return panel;
}

/** The running totals: weight, payload headroom, and where the weight sits. */
function buildSummary(state: AppState): HTMLElement {
  const { massResult } = state.analysis;
  const { vehicle } = state.layout;

  const usedFraction = massResult.payloadKg > 0 ? massResult.totalKg / massResult.payloadKg : 0;
  const forePercent = vehicle.floorLength.value > 0
    ? (massResult.centreOfGravity.y / vehicle.floorLength.value) * 100
    : 0;

  return el('div', { class: 'summary' }, [
    el('div', { class: 'summary__row' }, [
      el('span', { class: 'summary__label', text: 'Total weight' }),
      el('span', { class: 'summary__value', text: kg(massResult.totalKg) }),
    ]),
    el('div', { class: 'summary__bar' }, [
      el('div', {
        class: `summary__fill ${massResult.overPayload ? 'summary__fill--over' : ''}`,
        style: `width:${Math.min(usedFraction * 100, 100)}%`,
      }),
    ]),
    el('div', { class: 'summary__row summary__row--sub' }, [
      el('span', {
        class: 'summary__label',
        text: `of ${Math.round(massResult.payloadKg)} kg payload`,
      }),
      state.layout.boxes.length > 0 &&
        el('span', {
          class: 'summary__value summary__value--sub',
          text: `weight sits ${Math.round(forePercent)}% back`,
        }),
    ]),
  ]);
}
