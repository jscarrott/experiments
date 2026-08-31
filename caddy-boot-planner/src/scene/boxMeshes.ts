import * as THREE from 'three';
import type { BoxSpec, PlacedBox } from '../model/types.js';
import { dimsOf, footprintOf } from '../geometry/boxes.js';
import { MM } from './shellMesh.js';
import { THEME } from './theme.js';

/**
 * Boxes in the scene.
 *
 * Solid faces plus hard edge lines. The edges matter more than they might seem:
 * a set of same-coloured crates butted together reads as one shapeless mass without
 * them, and half the point of the tool is seeing where one box ends and the next
 * begins.
 */

export interface BoxMesh {
  group: THREE.Group;
  mesh: THREE.Mesh;
  edges: THREE.LineSegments;
  boxId: string;
}

export function buildBoxMesh(placed: PlacedBox, spec: BoxSpec): BoxMesh {
  const { width, depth } = footprintOf(spec, placed);
  const { height } = dimsOf(spec, placed);

  const geometry = new THREE.BoxGeometry(width * MM, height * MM, depth * MM);
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(spec.colour),
    roughness: 0.7,
    metalness: 0.05,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.boxId = placed.id;

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45 }),
  );

  const group = new THREE.Group();
  group.name = `box:${placed.id}`;
  group.userData.boxId = placed.id;
  group.add(mesh, edges);
  positionBoxGroup(group, placed, spec);

  return { group, mesh, edges, boxId: placed.id };
}

export function positionBoxGroup(group: THREE.Object3D, placed: PlacedBox, spec: BoxSpec): void {
  const { height } = dimsOf(spec, placed);
  group.position.set(placed.x * MM, (placed.z + height / 2) * MM, placed.y * MM);
}

export type BoxState = 'normal' | 'selected' | 'error' | 'warning';

/**
 * Recolour a box for its current state. Selection reads as an outline rather than a
 * fill so you can still see the box's own colour and tell what it is.
 */
export function setBoxState(boxMesh: BoxMesh, spec: BoxSpec, state: BoxState): void {
  const material = boxMesh.mesh.material as THREE.MeshStandardMaterial;
  const edgeMaterial = boxMesh.edges.material as THREE.LineBasicMaterial;

  const base = new THREE.Color(spec.colour);

  switch (state) {
    case 'error':
      material.color.copy(base).lerp(new THREE.Color(THEME.error), 0.65);
      material.emissive.setHex(THEME.error).multiplyScalar(0.25);
      edgeMaterial.color.setHex(THEME.error);
      edgeMaterial.opacity = 1;
      break;
    case 'warning':
      material.color.copy(base).lerp(new THREE.Color(THEME.warning), 0.45);
      material.emissive.setHex(0x000000);
      edgeMaterial.color.setHex(THEME.warning);
      edgeMaterial.opacity = 0.9;
      break;
    case 'selected':
      material.color.copy(base);
      material.emissive.setHex(THEME.selection).multiplyScalar(0.2);
      edgeMaterial.color.setHex(THEME.selection);
      edgeMaterial.opacity = 1;
      break;
    default:
      material.color.copy(base);
      material.emissive.setHex(0x000000);
      edgeMaterial.color.setHex(0x000000);
      edgeMaterial.opacity = 0.45;
  }
}

export function disposeBoxMesh(boxMesh: BoxMesh): void {
  boxMesh.mesh.geometry.dispose();
  (boxMesh.mesh.material as THREE.Material).dispose();
  boxMesh.edges.geometry.dispose();
  (boxMesh.edges.material as THREE.Material).dispose();
  boxMesh.group.removeFromParent();
}
