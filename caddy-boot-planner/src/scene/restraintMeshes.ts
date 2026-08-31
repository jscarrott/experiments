import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import type { Anchor, Vec3 } from '../model/types.js';
import type { Cord, NetResult } from '../geometry/net.js';
import type { StrapResult } from '../geometry/straps.js';
import { MM } from './shellMesh.js';
import { THEME } from './theme.js';

/**
 * Anchors, straps, net cords and the centre-of-gravity marker.
 *
 * Straps and net cords are drawn along the taut path the geometry layer computed,
 * so what you see is literally where the line lies — including the fact that it
 * lifts clear of anything short. Seeing the net float over a box is the whole point.
 */

const toScene = (p: Vec3) => new THREE.Vector3(p.x * MM, p.z * MM, p.y * MM);

export function buildAnchors(anchors: Anchor[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'anchors';

  const geometry = new THREE.TorusGeometry(0.022, 0.006, 8, 20);

  for (const anchor of anchors) {
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color: THEME.anchor, roughness: 0.4, metalness: 0.8 }),
    );
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(anchor.x * MM, anchor.z * MM + 0.004, anchor.y * MM);
    mesh.name = `anchor:${anchor.id}`;
    mesh.userData.anchorId = anchor.id;
    group.add(mesh);
  }

  return group;
}

export function setAnchorHighlight(group: THREE.Group, activeIds: Set<string>): void {
  for (const child of group.children) {
    const mesh = child as THREE.Mesh;
    const id = mesh.userData.anchorId as string | undefined;
    if (!id) continue;
    const material = mesh.material as THREE.MeshStandardMaterial;
    material.color.setHex(activeIds.has(id) ? THEME.anchorActive : THEME.anchor);
    material.emissive.setHex(activeIds.has(id) ? THEME.anchorActive : 0x000000).multiplyScalar(0.4);
  }
}

/** A strap as a tube along its taut path — thick enough to read as webbing. */
export function buildStrap(result: StrapResult): THREE.Object3D {
  return tubeAlong(result.path, 0.009, THEME.strap, 1);
}

/**
 * The net, drawn as the taut membrane it is.
 *
 * The analysis models a stretched net as the upper convex hull of the anchors and
 * the load, so the honest way to draw it is that same hull: a translucent skin
 * shrink-wrapped over the boxes. Drawing the fifteen individual anchor-to-anchor
 * cords instead was accurate but read as a tangle of blue spaghetti — and it hid
 * the one thing worth seeing, which is the membrane lifting clear of a short box.
 */
export function buildNet(result: NetResult): THREE.Group {
  const group = new THREE.Group();
  group.name = `net:${result.netId}`;

  // Every point the membrane is pinned to or resting on.
  const points: THREE.Vector3[] = [];
  for (const cord of result.cords) {
    for (const point of cord.points) points.push(toScene(point));
  }

  // A hull needs four non-coplanar points; a flat net over an empty floor has none.
  if (points.length >= 4 && !isDegenerate(points)) {
    try {
      const geometry = new ConvexGeometry(points);
      group.add(
        new THREE.Mesh(
          geometry,
          new THREE.MeshStandardMaterial({
            color: THEME.net,
            roughness: 0.85,
            transparent: true,
            opacity: 0.17,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        ),
      );
      group.add(
        new THREE.LineSegments(
          new THREE.EdgesGeometry(geometry, 1),
          new THREE.LineBasicMaterial({ color: THEME.net, transparent: true, opacity: 0.55 }),
        ),
      );
    } catch {
      // Degenerate point set. Fall through to the cord rendering below.
    }
  }

  // The membrane's own outline can be subtle over a flat load, so keep a light
  // set of cords along the perimeter to make it read as a net.
  if (group.children.length === 0) {
    for (const cord of result.cords) {
      group.add(tubeAlong(cord.points, 0.004, THEME.net, 0.7));
    }
  }

  return group;
}

/** Are all the points effectively in one plane? ConvexGeometry throws on those. */
function isDegenerate(points: THREE.Vector3[]): boolean {
  const box = new THREE.Box3().setFromPoints(points);
  const size = box.getSize(new THREE.Vector3());
  const smallest = Math.min(size.x, size.y, size.z);
  return smallest < 0.005; // under 5 mm of depth in some axis
}

/**
 * A marker where the net bridges over a box without touching it — drawn as a
 * dropped line from the cord above down to the box top, so the gap is obvious.
 */
export function buildBridgeMarkers(
  result: NetResult,
  boxTops: Map<string, { x: number; y: number; z: number }>,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'bridge-markers';

  for (const boxId of result.bridgedBoxIds) {
    const top = boxTops.get(boxId);
    if (!top) continue;

    const above = highestCordAt(result.cords, top.x, top.y);
    if (above === undefined) continue;

    const points = [
      new THREE.Vector3(top.x * MM, top.z * MM, top.y * MM),
      new THREE.Vector3(top.x * MM, above * MM, top.y * MM),
    ];
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineDashedMaterial({
        color: THEME.netBridged,
        dashSize: 0.02,
        gapSize: 0.012,
      }),
    );
    line.computeLineDistances();
    group.add(line);
  }

  return group;
}

/** Height of the lowest cord passing over a point — the gap the box is missing by. */
function highestCordAt(cords: Cord[], x: number, y: number): number | undefined {
  let best: number | undefined;
  for (const cord of cords) {
    for (let i = 0; i < cord.points.length - 1; i++) {
      const a = cord.points[i]!;
      const b = cord.points[i + 1]!;
      const t = projectOnto(a, b, x, y);
      if (t === undefined) continue;
      const z = a.z + (b.z - a.z) * t;
      const px = a.x + (b.x - a.x) * t;
      const py = a.y + (b.y - a.y) * t;
      if (Math.hypot(px - x, py - y) > 60) continue;
      if (best === undefined || z < best) best = z;
    }
  }
  return best;
}

function projectOnto(a: Vec3, b: Vec3, x: number, y: number): number | undefined {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return undefined;
  const t = ((x - a.x) * dx + (y - a.y) * dy) / lengthSq;
  return t >= 0 && t <= 1 ? t : undefined;
}

function tubeAlong(path: Vec3[], radius: number, color: number, opacity: number): THREE.Object3D {
  const points = path.map(toScene);
  if (points.length < 2) return new THREE.Group();

  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0);
  const geometry = new THREE.TubeGeometry(curve, Math.max(points.length * 4, 24), radius, 8, false);
  return new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.8,
      transparent: opacity < 1,
      opacity,
    }),
  );
}

/** Centre of gravity, drawn as a floating crosshair you can see against the load. */
export function buildCogMarker(cog: Vec3): THREE.Group {
  const group = new THREE.Group();
  group.name = 'cog';

  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.028, 16, 12),
    new THREE.MeshStandardMaterial({
      color: THEME.cog,
      emissive: THEME.cog,
      emissiveIntensity: 0.5,
      roughness: 0.3,
    }),
  );
  sphere.position.copy(toScene(cog));
  group.add(sphere);

  // A dropped line to the floor, so you can read its position fore-aft.
  const drop = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      toScene(cog),
      new THREE.Vector3(cog.x * MM, 0, cog.y * MM),
    ]),
    new THREE.LineDashedMaterial({ color: THEME.cog, dashSize: 0.03, gapSize: 0.02 }),
  );
  drop.computeLineDistances();
  group.add(drop);

  return group;
}

export function disposeGroup(group: THREE.Object3D): void {
  group.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material?.dispose();
  });
  group.removeFromParent();
}
