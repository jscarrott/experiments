import type { AppState } from '../state.js';
import { clear, el, mm } from './dom.js';

/**
 * The restraint panel: the net, and the straps.
 *
 * Straps are created by picking two anchors. The panel is where you see the
 * length to buy, and which boxes each strap is actually bearing on — as opposed
 * to which ones you hoped it was.
 */

export interface RestraintPanelHandles {
  element: HTMLElement;
  /** Called by the scene when an anchor is clicked, to build a strap. */
  onAnchorPicked(anchorId: string): void;
  /** Anchors currently part of a half-finished strap, for highlighting. */
  pendingAnchors(): Set<string>;
}

export function buildRestraintPanel(
  state: AppState,
  onPendingChange: () => void,
): RestraintPanelHandles {
  const panel = el('div', { class: 'panel panel--restraint' });
  let pendingAnchor: string | undefined;

  const render = () => {
    clear(panel);
    panel.append(el('h2', { class: 'panel__heading', text: 'Tie-down' }));

    // --- Net ---------------------------------------------------------------
    const net = state.layout.nets[0];
    const netResult = state.analysis.netResults[0];

    panel.append(
      el('label', { class: 'field field--check' }, [
        el('input', {
          type: 'checkbox',
          checked: !!net,
          onchange: (e: Event) => state.setNetEnabled((e.target as HTMLInputElement).checked),
        }),
        el('span', { class: 'field__label', text: 'Elasticated cargo net' }),
      ]),
    );

    if (net && netResult) {
      const held = netResult.heldBoxIds.size;
      const bridged = netResult.bridgedBoxIds.size;

      panel.append(
        el('div', { class: 'netinfo' }, [
          el('div', { class: 'netinfo__row' }, [
            el('span', { text: 'Holding' }),
            el('span', { class: 'netinfo__value', text: `${held} box${held === 1 ? '' : 'es'}` }),
          ]),
          el('div', { class: `netinfo__row ${bridged > 0 ? 'netinfo__row--bad' : ''}` }, [
            el('span', { text: 'Bridged over' }),
            el('span', { class: 'netinfo__value', text: `${bridged}` }),
          ]),
          el('div', { class: 'netinfo__row' }, [
            el('span', { text: 'Stretched to' }),
            el('span', {
              class: `netinfo__value ${netResult.overStretched ? 'netinfo__value--bad' : ''}`,
              text: `${Math.round(netResult.stretchRatio * 100)}%`,
            }),
          ]),
        ]),
        el('p', {
          class: 'panel__hint',
          text: 'Net size when relaxed, so the stretch figure means something:',
        }),
        el('div', { class: 'field-grid' }, [
          netNumberField('Width', net.relaxedWidth, (v) => state.updateNet(net.id, { relaxedWidth: v })),
          netNumberField('Length', net.relaxedLength, (v) => state.updateNet(net.id, { relaxedLength: v })),
        ]),
      );
    }

    // --- Straps ------------------------------------------------------------
    panel.append(el('h3', { class: 'panel__subheading', text: 'Straps' }));

    panel.append(
      el('p', { class: 'panel__hint' }, [
        pendingAnchor
          ? 'Now click the second anchor to finish the strap.'
          : 'Click two floor anchors in the 3D view to run a strap between them.',
      ]),
    );

    if (pendingAnchor) {
      panel.append(
        el('button', {
          class: 'button button--small',
          type: 'button',
          text: 'Cancel strap',
          onclick: () => {
            pendingAnchor = undefined;
            onPendingChange();
            render();
          },
        }),
      );
    }

    if (state.layout.straps.length === 0) {
      panel.append(el('p', { class: 'panel__empty', text: 'No straps yet.' }));
    } else {
      const list = el('ul', { class: 'straps' });

      for (const strap of state.layout.straps) {
        const result = state.analysis.strapResults.find((r) => r.strapId === strap.id);
        const touching = result?.touchingBoxIds ?? [];
        const names = touching
          .map((id) => state.layout.boxes.find((b) => b.id === id)?.label)
          .filter(Boolean);

        list.append(
          el('li', { class: 'straps__item' }, [
            el('div', { class: 'straps__head' }, [
              el('span', { class: 'straps__name', text: strap.label }),
              el('button', {
                class: 'button button--icon',
                type: 'button',
                text: '×',
                title: 'Remove strap',
                onclick: () => state.removeStrap(strap.id),
              }),
            ]),
            result &&
              el('div', { class: 'straps__detail' }, [
                el('span', { text: `Over the load: ${mm(result.spanLength)}` }),
                el('span', {
                  class: 'straps__buy',
                  text: `Buy at least ${(result.recommendedLength / 1000).toFixed(1)} m`,
                }),
              ]),
            names.length > 0
              ? el('div', { class: 'straps__holding', text: `Bearing on ${names.join(', ')}` })
              : el('div', {
                  class: 'straps__holding straps__holding--none',
                  text: 'Not touching anything — it is lying on the floor.',
                }),
          ]),
        );
      }
      panel.append(list);
    }
  };

  render();
  state.subscribe(render);

  return {
    element: panel,
    onAnchorPicked(anchorId: string) {
      if (!pendingAnchor) {
        pendingAnchor = anchorId;
      } else if (pendingAnchor === anchorId) {
        pendingAnchor = undefined; // clicked the same one again, so cancel
      } else {
        state.addStrap(pendingAnchor, anchorId);
        pendingAnchor = undefined;
      }
      onPendingChange();
      render();
    },
    pendingAnchors() {
      return pendingAnchor ? new Set([pendingAnchor]) : new Set();
    },
  };
}

function netNumberField(label: string, value: number, onChange: (v: number) => void): HTMLElement {
  return el('label', { class: 'field' }, [
    el('span', { class: 'field__label', text: label }),
    el('span', { class: 'field__input' }, [
      el('input', {
        class: 'input',
        type: 'number',
        value: String(value),
        step: '50',
        onchange: (e: Event) => {
          const parsed = Number((e.target as HTMLInputElement).value);
          if (!Number.isNaN(parsed) && parsed > 0) onChange(parsed);
        },
      }),
      el('span', { class: 'field__unit', text: 'mm' }),
    ]),
  ]);
}
