import * as THREE from 'three';
import type { VehicleProfile } from '../model/types.js';
import { archBoxes, obstructionBoxes, wallSections } from '../geometry/shell.js';
import { THEME } from './theme.js';

/**
 * Rendering the load bay.
 *
 * Drawn semi-transparent so you can see the load through it, with hard edge lines
 * on top — a wireframe alone reads as a cage, and a solid alone hides everything
 * inside. The combination gives you a shape you can read from any angle.
 */

const MM = 0.001; // millimetres to scene units (metres), so the camera maths stays sane

export function buildShell(profile: VehicleProfile): THREE.Group {
  const group = new THREE.Group();
  group.name = 'shell';

  const length = profile.floorLength.value;
  const height = profile.loadHeight.value;

  // --- Floor ---------------------------------------------------------------
  const floorHalf = profile.floorWidth.value / 2;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(floorHalf * 2 * MM, length * MM),
    new THREE.MeshStandardMaterial({
      color: THEME.floor,
      roughness: 0.95,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, (length / 2) * MM);
  floor.receiveShadow = true;
  group.add(floor);

  group.add(buildFloorGrid(profile));

  // --- Side walls, built from the cross-sections so the lean is real --------
  const sections = wallSections(profile);
  for (const sign of [-1, 1]) {
    const shape = new THREE.Shape();
    shape.moveTo(sign * sections[0]!.halfWidth * MM, 0);
    for (const s of sections) shape.lineTo(sign * s.halfWidth * MM, s.z * MM);
    // Close the profile back down the inside, giving the wall a little thickness.
    for (let i = sections.length - 1; i >= 0; i--) {
      const s = sections[i]!;
      shape.lineTo(sign * (s.halfWidth - 12) * MM, s.z * MM);
    }
    shape.closePath();

    const wall = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shape, { depth: length * MM, bevelEnabled: false }),
      shellMaterial(),
    );
    group.add(wall);
    group.add(outline(wall.geometry, THEME.shellEdge));
  }

  // --- Roof ----------------------------------------------------------------
  const roofHalf = profile.widthAtRoof.value / 2;
  const roof = new THREE.Mesh(
    new THREE.PlaneGeometry(roofHalf * 2 * MM, length * MM),
    shellMaterial(),
  );
  roof.rotation.x = Math.PI / 2;
  roof.position.set(0, height * MM, (length / 2) * MM);
  group.add(roof);

  // --- Second-row seat backs ----------------------------------------------
  const rake = THREE.MathUtils.degToRad(profile.seatBackRake.value);
  const seatHeight = height * 0.62;
  const seats = new THREE.Mesh(
    new THREE.PlaneGeometry(profile.floorWidth.value * MM, seatHeight * MM),
    new THREE.MeshStandardMaterial({
      color: THEME.seats,
      roughness: 1,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    }),
  );
  seats.position.set(0, (seatHeight / 2) * MM, 0);
  seats.rotation.x = -rake;
  group.add(seats);

  // --- Wheel arches --------------------------------------------------------
  for (const arch of archBoxes(profile)) {
    const w = arch.maxX - arch.minX;
    const d = arch.maxY - arch.minY;
    const h = arch.maxZ - arch.minZ;
    const geometry = new THREE.BoxGeometry(w * MM, h * MM, d * MM);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color: THEME.arch, roughness: 0.9, transparent: true, opacity: 0.85 }),
    );
    mesh.position.set(((arch.minX + arch.maxX) / 2) * MM, (h / 2) * MM, ((arch.minY + arch.maxY) / 2) * MM);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    const edges = outline(geometry, THEME.shellEdge);
    edges.position.copy(mesh.position);
    group.add(edges);
  }

  // --- Third-row seat brackets --------------------------------------------
  for (const o of obstructionBoxes(profile)) {
    const w = o.maxX - o.minX;
    const d = o.maxY - o.minY;
    const h = o.maxZ - o.minZ;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w * MM, h * MM, d * MM),
      new THREE.MeshStandardMaterial({ color: THEME.obstruction, roughness: 0.6, metalness: 0.4 }),
    );
    mesh.position.set(((o.minX + o.maxX) / 2) * MM, (h / 2) * MM, ((o.minY + o.maxY) / 2) * MM);
    mesh.userData.tooltip = o.label;
    group.add(mesh);
  }

  // --- Tailgate aperture, drawn as a frame at the back ---------------------
  group.add(buildApertureFrame(profile));

  return group;
}

function shellMaterial(): THREE.Material {
  return new THREE.MeshStandardMaterial({
    color: THEME.shell,
    roughness: 0.9,
    metalness: 0,
    transparent: true,
    opacity: 0.18,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}

function outline(geometry: THREE.BufferGeometry, color: number): THREE.LineSegments {
  return new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry, 20),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.5 }),
  );
}

/**
 * The tailgate opening, drawn as a bright frame. This is the hole everything has
 * to physically pass through, so it earns being visible rather than implied.
 */
function buildApertureFrame(profile: VehicleProfile): THREE.Group {
  const group = new THREE.Group();
  group.name = 'aperture';

  const halfW = (profile.apertureWidth.value / 2) * MM;
  const h = profile.apertureHeight.value * MM;
  const y = profile.floorLength.value * MM;

  const points = [
    new THREE.Vector3(-halfW, 0, y),
    new THREE.Vector3(halfW, 0, y),
    new THREE.Vector3(halfW, h, y),
    new THREE.Vector3(-halfW, h, y),
    new THREE.Vector3(-halfW, 0, y),
  ];

  group.add(
    new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: THEME.aperture, linewidth: 2 }),
    ),
  );
  return group;
}

/** 100 mm floor grid with a heavier line every 500 mm, so you can judge sizes by eye. */
function buildFloorGrid(profile: VehicleProfile): THREE.Group {
  const group = new THREE.Group();
  group.name = 'grid';

  const halfW = profile.floorWidth.value / 2;
  const length = profile.floorLength.value;

  const fine: number[] = [];
  const coarse: number[] = [];

  for (let x = -Math.floor(halfW / 100) * 100; x <= halfW; x += 100) {
    const target = x % 500 === 0 ? coarse : fine;
    target.push(x * MM, 0.001, 0, x * MM, 0.001, length * MM);
  }
  for (let y = 0; y <= length; y += 100) {
    const target = y % 500 === 0 ? coarse : fine;
    target.push(-halfW * MM, 0.001, y * MM, halfW * MM, 0.001, y * MM);
  }

  group.add(gridLines(fine, THEME.gridFine, 0.35));
  group.add(gridLines(coarse, THEME.gridCoarse, 0.6));
  return group;
}

function gridLines(positions: number[], color: number, opacity: number): THREE.LineSegments {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
  );
}

export { MM };
