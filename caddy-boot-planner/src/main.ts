import * as THREE from 'three';

import './style.css';

import { AppState, defaultLayout } from './state.js';
import { loadCurrent, saveCurrent } from './model/layout.js';
import { aabbOf } from './geometry/boxes.js';
import { restingHeight } from './geometry/stacking.js';
import { obstructionBoxes } from './geometry/shell.js';
import { Viewer, type ViewName } from './scene/viewer.js';
import { buildShell, MM } from './scene/shellMesh.js';
import { buildBoxMesh, disposeBoxMesh, positionBoxGroup, setBoxState, type BoxMesh } from './scene/boxMeshes.js';
import {
  buildAnchors,
  buildBridgeMarkers,
  buildCogMarker,
  buildNet,
  buildStrap,
  disposeGroup,
  setAnchorHighlight,
} from './scene/restraintMeshes.js';
import { buildToolbar } from './ui/toolbar.js';
import { buildLibraryPanel } from './ui/library.js';
import { buildInspector } from './ui/inspector.js';
import { buildWarningsPanel } from './ui/warnings.js';
import { buildRestraintPanel } from './ui/restraint.js';
import { buildCalibratePanel } from './ui/calibrate.js';
import { el } from './ui/dom.js';

/**
 * Wiring. The scene is rebuilt from state on every change, except for box positions
 * during a drag, which are moved directly so dragging stays smooth.
 */

const app = document.getElementById('app');
if (!app) throw new Error('Missing #app');

const state = new AppState(loadCurrent() ?? defaultLayout());

let snapMm = 10;

// --- Layout ----------------------------------------------------------------

const viewportEl = el('div', { class: 'viewport' });
const leftEl = el('aside', { class: 'sidebar sidebar--left' });
const rightEl = el('aside', { class: 'sidebar sidebar--right' });

const viewer = new Viewer(viewportEl, state.layout.vehicle);

const restraintPanel = buildRestraintPanel(state, () => refreshAnchorHighlight());

const toolbar = buildToolbar(state, {
  onView: (view: ViewName) => viewer.setView(view),
  onSnapChange: (value) => {
    snapMm = value;
  },
  snap: snapMm,
});

leftEl.append(buildLibraryPanel(state));
rightEl.append(
  buildWarningsPanel(state),
  buildInspector(state),
  restraintPanel.element,
  buildCalibratePanel(state, () => rebuildShell()),
);

app.append(toolbar, el('main', { class: 'workspace' }, [leftEl, viewportEl, rightEl]));
viewportEl.append(buildHelpOverlay());

// --- Scene groups ----------------------------------------------------------

let shellGroup = buildShell(state.layout.vehicle);
let anchorGroup = buildAnchors(state.layout.vehicle.anchors);
const boxGroup = new THREE.Group();
const restraintGroup = new THREE.Group();

viewer.scene.add(shellGroup, anchorGroup, boxGroup, restraintGroup);

const boxMeshes = new Map<string, BoxMesh>();

function rebuildShell(): void {
  disposeGroup(shellGroup);
  disposeGroup(anchorGroup);
  shellGroup = buildShell(state.layout.vehicle);
  anchorGroup = buildAnchors(state.layout.vehicle.anchors);
  viewer.scene.add(shellGroup, anchorGroup);
  viewer.setProfile(state.layout.vehicle);
  refreshAnchorHighlight();
  viewer.requestRender();
}

/** Bring the scene in line with state. Cheap enough to run on every change. */
function syncScene(): void {
  const wanted = new Set(state.layout.boxes.map((b) => b.id));

  for (const [id, mesh] of boxMeshes) {
    if (!wanted.has(id)) {
      disposeBoxMesh(mesh);
      boxMeshes.delete(id);
    }
  }

  for (const box of state.layout.boxes) {
    const spec = state.lookup(box.specId);
    let mesh = boxMeshes.get(box.id);

    // Rebuild rather than rescale when the shape changed — geometry is cheap here
    // and it keeps the edge lines exactly on the box.
    const signature = `${box.specId}:${box.rotation}:${JSON.stringify(box.overrides ?? {})}`;
    if (mesh && mesh.group.userData.signature !== signature) {
      disposeBoxMesh(mesh);
      boxMeshes.delete(box.id);
      mesh = undefined;
    }

    if (!mesh) {
      mesh = buildBoxMesh(box, spec);
      mesh.group.userData.signature = signature;
      boxMeshes.set(box.id, mesh);
      boxGroup.add(mesh.group);
    } else {
      positionBoxGroup(mesh.group, box, spec);
    }

    const issues = state.analysis.byBox.get(box.id) ?? [];
    const stateName = issues.some((i) => i.severity === 'error')
      ? 'error'
      : issues.length > 0
        ? 'warning'
        : box.id === state.selectedBoxId
          ? 'selected'
          : 'normal';
    setBoxState(mesh, spec, stateName);

    // Selection still needs to read on a box that is also flagged.
    if (box.id === state.selectedBoxId && stateName !== 'selected') {
      (mesh.edges.material as THREE.LineBasicMaterial).color.setHex(0x5ad1a8);
    }
  }

  syncRestraint();
  refreshAnchorHighlight();
  viewer.requestRender();
}

function syncRestraint(): void {
  for (const child of [...restraintGroup.children]) disposeGroup(child);

  for (const result of state.analysis.strapResults) {
    restraintGroup.add(buildStrap(result));
  }

  const boxTops = new Map<string, { x: number; y: number; z: number }>();
  for (const box of state.layout.boxes) {
    const aabb = aabbOf(state.lookup(box.specId), box);
    boxTops.set(box.id, {
      x: (aabb.minX + aabb.maxX) / 2,
      y: (aabb.minY + aabb.maxY) / 2,
      z: aabb.maxZ,
    });
  }

  for (const result of state.analysis.netResults) {
    restraintGroup.add(buildNet(result));
    restraintGroup.add(buildBridgeMarkers(result, boxTops));
  }

  if (state.analysis.massResult.totalKg > 0) {
    restraintGroup.add(buildCogMarker(state.analysis.massResult.centreOfGravity));
  }
}

function refreshAnchorHighlight(): void {
  setAnchorHighlight(anchorGroup, restraintPanel.pendingAnchors());
  viewer.requestRender();
}

// --- Pointer interaction ---------------------------------------------------

interface DragState {
  boxId: string;
  /** Offset from the box centre to where the pointer grabbed it, in mm. */
  offsetX: number;
  offsetY: number;
  planeHeight: number;
  moved: boolean;
}

let drag: DragState | undefined;

viewer.renderer.domElement.addEventListener('pointerdown', (event: PointerEvent) => {
  if (event.button !== 0) return;

  // Anchors first — they are small and sit on the floor under everything else.
  const anchorHit = viewer.pick(event, anchorGroup.children);
  if (anchorHit) {
    const anchorId = anchorHit.object.userData.anchorId as string | undefined;
    if (anchorId) {
      restraintPanel.onAnchorPicked(anchorId);
      return;
    }
  }

  const hit = viewer.pick(event, boxGroup.children);
  if (!hit) {
    state.select(undefined);
    return;
  }

  const boxId = findBoxId(hit.object);
  if (!boxId) return;

  const box = state.layout.boxes.find((b) => b.id === boxId);
  if (!box) return;

  state.select(boxId);

  const planeHeight = box.z;
  const point = viewer.pointerOnPlane(event, planeHeight);
  if (!point) return;

  drag = {
    boxId,
    offsetX: box.x - point.x / MM,
    offsetY: box.y - point.z / MM,
    planeHeight,
    moved: false,
  };

  viewer.controls.enabled = false;
  viewer.renderer.domElement.setPointerCapture(event.pointerId);
});

viewer.renderer.domElement.addEventListener('pointermove', (event: PointerEvent) => {
  if (!drag) return;

  const point = viewer.pointerOnPlane(event, drag.planeHeight);
  if (!point) return;

  const box = state.layout.boxes.find((b) => b.id === drag!.boxId);
  if (!box) return;

  box.x = snap(point.x / MM + drag.offsetX);
  box.y = snap(point.z / MM + drag.offsetY);
  drag.moved = true;

  // Move the mesh directly; a full recompute per frame would be wasteful and the
  // analysis is only meaningful once you let go anyway.
  const mesh = boxMeshes.get(box.id);
  if (mesh) positionBoxGroup(mesh.group, box, state.lookup(box.specId));
  viewer.requestRender();
});

viewer.renderer.domElement.addEventListener('pointerup', (event: PointerEvent) => {
  if (!drag) return;

  const box = state.layout.boxes.find((b) => b.id === drag!.boxId);
  if (box && drag.moved) {
    // Drop it onto whatever is underneath, so dragging a box over another stacks it
    // rather than leaving it hovering or intersecting.
    const others = state.layout.boxes.filter((b) => b.id !== box.id);
    box.z = restingHeight(box, others, state.lookup, obstructionBoxes(state.layout.vehicle));
  }

  viewer.controls.enabled = true;
  viewer.renderer.domElement.releasePointerCapture(event.pointerId);
  drag = undefined;
  state.recompute();
});

function findBoxId(object: THREE.Object3D): string | undefined {
  let current: THREE.Object3D | null = object;
  while (current) {
    const id = current.userData.boxId as string | undefined;
    if (id) return id;
    current = current.parent;
  }
  return undefined;
}

function snap(value: number): number {
  return Math.round(value / snapMm) * snapMm;
}

// --- Keyboard --------------------------------------------------------------

window.addEventListener('keydown', (event: KeyboardEvent) => {
  const target = event.target as HTMLElement | null;
  if (target && /input|textarea|select/i.test(target.tagName)) return;

  const box = state.selectedBox;
  if (!box) return;

  const step = event.shiftKey ? snapMm * 5 : snapMm;

  switch (event.key) {
    case 'Delete':
    case 'Backspace':
      event.preventDefault();
      state.removeBox(box.id);
      break;
    case 'r':
      state.updateBox(box.id, { rotation: ((box.rotation + 90) % 360) as 0 | 90 | 180 | 270 });
      break;
    case 'd':
      state.duplicateBox(box.id);
      break;
    case 'ArrowLeft':
      event.preventDefault();
      state.updateBox(box.id, { x: box.x - step });
      break;
    case 'ArrowRight':
      event.preventDefault();
      state.updateBox(box.id, { x: box.x + step });
      break;
    case 'ArrowUp':
      event.preventDefault();
      state.updateBox(box.id, { y: box.y + step });
      break;
    case 'ArrowDown':
      event.preventDefault();
      state.updateBox(box.id, { y: box.y - step });
      break;
    default:
      break;
  }
});

// --- Go --------------------------------------------------------------------

state.subscribe(syncScene);
state.subscribe(() => saveCurrent(state.layout));
syncScene();
viewer.setView('iso');

function buildHelpOverlay(): HTMLElement {
  return el('div', { class: 'help' }, [
    el('span', { text: 'Drag to move · R rotate · D duplicate · Del remove' }),
    el('span', { text: 'Click two floor anchors to run a strap' }),
  ]);
}

// Exposed for the smoke test to assert against without scraping the DOM.
(window as unknown as { __planner: unknown }).__planner = { state, viewer, boxMeshes, THREE };
