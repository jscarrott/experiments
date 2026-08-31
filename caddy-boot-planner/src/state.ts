import type { BoxSpec, CargoNet, Layout, PlacedBox, Strap } from './model/types.js';
import { specById } from './model/catalogue.js';
import { CADDY_MAXI_LIFE_2K, cloneProfile } from './model/vehicle.js';
import { checkFit, type FitIssue } from './geometry/fit.js';
import { checkStacks, findStacks, type StackIssue } from './geometry/stacking.js';
import { defaultNet, drapeNet, type NetResult } from './geometry/net.js';
import { checkRestraint, routeAll, type RestraintIssue, type StrapResult } from './geometry/straps.js';
import { checkAccess, type AccessIssue } from './geometry/access.js';
import { checkMass, computeMass, type MassIssue, type MassResult } from './geometry/mass.js';

/**
 * Application state, and the single analysis pass that everything else reads from.
 *
 * The whole model is recomputed on every change rather than patched incrementally.
 * With a boot's worth of boxes that is well under a millisecond, and it removes an
 * entire category of bug where the warnings panel disagrees with the 3D view.
 */

export interface Analysis {
  fit: FitIssue[];
  stack: StackIssue[];
  restraint: RestraintIssue[];
  access: AccessIssue[];
  mass: MassIssue[];
  massResult: MassResult;
  strapResults: StrapResult[];
  netResults: NetResult[];
  /** Every issue keyed by box, for tinting and the inspector. */
  byBox: Map<string, { severity: 'error' | 'warning'; message: string }[]>;
}

export type Listener = () => void;

export class AppState {
  layout: Layout;
  selectedBoxId: string | undefined;
  analysis!: Analysis;

  private listeners = new Set<Listener>();
  private counter = 0;

  constructor(layout?: Layout) {
    this.layout = layout ?? defaultLayout();
    this.recompute();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  lookup = (specId: string): BoxSpec => specById(specId);

  /** Recompute the analysis and notify. Call after any mutation. */
  recompute(notify = true): void {
    const { boxes, vehicle, straps, nets, unrestrainedWarnKg } = this.layout;

    const fit = checkFit(boxes, vehicle, this.lookup);
    const stack = checkStacks(boxes, this.lookup);
    const stacks = findStacks(boxes, this.lookup);

    const strapResults = routeAll(straps, vehicle.anchors, boxes, this.lookup);
    const netResults = nets.map((net) => drapeNet(net, vehicle.anchors, boxes, this.lookup));

    const netHeld = new Set<string>();
    const netBridged = new Set<string>();
    for (const result of netResults) {
      for (const id of result.heldBoxIds) netHeld.add(id);
      for (const id of result.bridgedBoxIds) netBridged.add(id);
    }

    const restraint = checkRestraint(
      boxes,
      this.lookup,
      strapResults,
      netHeld,
      netBridged,
      stacks,
      unrestrainedWarnKg,
    );

    const access = checkAccess(boxes, this.lookup);
    const massResult = computeMass(boxes, this.lookup, vehicle.payloadKg.value);
    const mass = checkMass(massResult, vehicle.floorLength.value, vehicle.loadHeight.value);

    const byBox = new Map<string, { severity: 'error' | 'warning'; message: string }[]>();
    const add = (boxId: string, severity: 'error' | 'warning', message: string) => {
      const list = byBox.get(boxId) ?? [];
      list.push({ severity, message });
      byBox.set(boxId, list);
    };
    for (const i of fit) add(i.boxId, i.severity, i.message);
    for (const i of stack) add(i.boxId, i.kind === 'overhang' ? 'error' : 'warning', i.message);
    for (const i of restraint) add(i.boxId, i.severity, i.message);
    for (const i of access.issues) add(i.boxId, i.severity, i.message);

    this.analysis = {
      fit,
      stack,
      restraint,
      access: access.issues,
      mass,
      massResult,
      strapResults,
      netResults,
      byBox,
    };

    if (notify) this.emit();
  }

  // --- Mutations ------------------------------------------------------------

  addBox(specId: string, at?: { x: number; y: number; z: number }): PlacedBox {
    const spec = this.lookup(specId);
    const existing = this.layout.boxes.filter((b) => b.specId === specId).length;

    const box: PlacedBox = {
      id: `box-${++this.counter}-${Date.now().toString(36)}`,
      specId,
      label: existing > 0 ? `${spec.name} (${existing + 1})` : spec.name,
      x: at?.x ?? 0,
      y: at?.y ?? this.layout.vehicle.floorLength.value / 2,
      z: at?.z ?? 0,
      rotation: 0,
      contentsKg: 0,
      needOften: false,
    };

    this.layout.boxes.push(box);
    this.selectedBoxId = box.id;
    this.recompute();
    return box;
  }

  updateBox(id: string, patch: Partial<PlacedBox>): void {
    const box = this.layout.boxes.find((b) => b.id === id);
    if (!box) return;
    Object.assign(box, patch);
    this.recompute();
  }

  removeBox(id: string): void {
    this.layout.boxes = this.layout.boxes.filter((b) => b.id !== id);
    // Drop the box from any strap that was meant to hold it.
    for (const strap of this.layout.straps) {
      strap.overBoxIds = strap.overBoxIds.filter((b) => b !== id);
    }
    if (this.selectedBoxId === id) this.selectedBoxId = undefined;
    this.recompute();
  }

  duplicateBox(id: string): PlacedBox | undefined {
    const box = this.layout.boxes.find((b) => b.id === id);
    if (!box) return undefined;
    const spec = this.lookup(box.specId);
    const copy: PlacedBox = {
      ...box,
      id: `box-${++this.counter}-${Date.now().toString(36)}`,
      label: `${box.label} (copy)`,
      // Offset along the van by its own depth, so the copy lands beside it.
      y: box.y + (spec.depth.value + 20),
    };
    this.layout.boxes.push(copy);
    this.selectedBoxId = copy.id;
    this.recompute();
    return copy;
  }

  select(id: string | undefined): void {
    this.selectedBoxId = id;
    this.emit();
  }

  addStrap(fromAnchorId: string, toAnchorId: string, overBoxIds: string[] = []): Strap {
    const strap: Strap = {
      id: `strap-${++this.counter}`,
      label: `Strap ${this.layout.straps.length + 1}`,
      fromAnchorId,
      toAnchorId,
      overBoxIds,
      kind: 'ratchet',
    };
    this.layout.straps.push(strap);
    this.recompute();
    return strap;
  }

  removeStrap(id: string): void {
    this.layout.straps = this.layout.straps.filter((s) => s.id !== id);
    this.recompute();
  }

  setNetEnabled(enabled: boolean): void {
    if (enabled && this.layout.nets.length === 0) {
      this.layout.nets = [defaultNet(this.layout.vehicle.anchors.map((a) => a.id))];
    } else if (!enabled) {
      this.layout.nets = [];
    }
    this.recompute();
  }

  updateNet(id: string, patch: Partial<CargoNet>): void {
    const net = this.layout.nets.find((n) => n.id === id);
    if (!net) return;
    Object.assign(net, patch);
    this.recompute();
  }

  replaceLayout(layout: Layout): void {
    this.layout = layout;
    this.selectedBoxId = undefined;
    this.recompute();
  }

  get selectedBox(): PlacedBox | undefined {
    return this.layout.boxes.find((b) => b.id === this.selectedBoxId);
  }
}

export function defaultLayout(): Layout {
  return {
    schemaVersion: 1,
    name: 'My load',
    savedAt: new Date().toISOString(),
    vehicle: cloneProfile(CADDY_MAXI_LIFE_2K),
    boxes: [],
    straps: [],
    nets: [],
    // Roughly the weight at which an unrestrained box stops being a nuisance and
    // starts being a hazard in a heavy stop.
    unrestrainedWarnKg: 5,
  };
}
