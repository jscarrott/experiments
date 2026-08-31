import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { VehicleProfile } from '../model/types.js';
import { MM } from './shellMesh.js';
import { THEME } from './theme.js';

/**
 * Renderer, camera, lights and view presets.
 *
 * The named views are worth having because each answers a different question:
 * `tailgate` is what you see when you open the back and is the one that tells you
 * whether the plan is loadable; `top` is for footprint and gaps; `side` for stack
 * heights against the roof.
 */

export type ViewName = 'iso' | 'top' | 'side' | 'tailgate' | 'front';

export class Viewer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;

  private readonly container: HTMLElement;
  private profile: VehicleProfile;
  private frameRequested = false;

  constructor(container: HTMLElement, profile: VehicleProfile) {
    this.container = container;
    this.profile = profile;

    this.scene.background = new THREE.Color(THEME.background);
    this.scene.fog = new THREE.Fog(THEME.background, 4, 12);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.52; // don't drop below the floor
    this.controls.addEventListener('change', () => this.requestRender());

    this.addLights();
    this.setView('iso');

    const observer = new ResizeObserver(() => this.resize());
    observer.observe(container);
    this.resize();
  }

  private addLights(): void {
    this.scene.add(new THREE.HemisphereLight(0xbcd0f0, 0x3a4152, 2.1));

    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(1.8, 3.2, 1.4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 12;
    const extent = 2;
    key.shadow.camera.left = -extent;
    key.shadow.camera.right = extent;
    key.shadow.camera.top = extent;
    key.shadow.camera.bottom = -extent;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x9fb4d8, 0.6);
    fill.position.set(-2, 1.5, -1.2);
    this.scene.add(fill);
  }

  setProfile(profile: VehicleProfile): void {
    this.profile = profile;
  }

  /** Move the camera to a named viewpoint, framed on the load bay. */
  setView(view: ViewName): void {
    const length = this.profile.floorLength.value * MM;
    const width = this.profile.floorWidth.value * MM;
    const height = this.profile.loadHeight.value * MM;

    const centre = new THREE.Vector3(0, height / 2, length / 2);
    const reach = Math.max(length, width, height);

    const positions: Record<ViewName, THREE.Vector3> = {
      iso: new THREE.Vector3(reach * 1.15, reach * 0.95, length + reach * 1.05),
      top: new THREE.Vector3(0.001, reach * 2.1, length / 2),
      side: new THREE.Vector3(reach * 2.2, height * 0.6, length / 2),
      tailgate: new THREE.Vector3(0, height * 0.55, length + reach * 1.5),
      front: new THREE.Vector3(0, height * 0.55, -reach * 1.2),
    };

    this.camera.position.copy(positions[view]);
    this.controls.target.copy(centre);
    this.controls.update();
    this.requestRender();
  }

  /** What is under the pointer? Returns the first hit among the given objects. */
  pick(event: PointerEvent, objects: THREE.Object3D[]): THREE.Intersection | undefined {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, this.camera);
    return raycaster.intersectObjects(objects, true)[0];
  }

  /**
   * Where on the floor plane (at a given height) is the pointer? This is what turns
   * a drag into a position in the van.
   */
  pointerOnPlane(event: PointerEvent, planeHeight: number): THREE.Vector3 | undefined {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, this.camera);

    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeHeight * MM);
    const hit = new THREE.Vector3();
    return raycaster.ray.intersectPlane(plane, hit) ? hit : undefined;
  }

  private resize(): void {
    const { clientWidth, clientHeight } = this.container;
    if (clientWidth === 0 || clientHeight === 0) return;
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  /**
   * Render on demand rather than in a constant loop. Nothing here animates, so a
   * permanent rAF loop would just flatten a laptop battery for no benefit.
   */
  requestRender(): void {
    if (this.frameRequested) return;
    this.frameRequested = true;
    requestAnimationFrame(() => {
      this.frameRequested = false;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  /** Kept ticking while damping settles after a drag. */
  startDampingLoop(): void {
    const tick = () => {
      const moving = this.controls.update();
      this.renderer.render(this.scene, this.camera);
      if (moving) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}
