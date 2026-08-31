/**
 * Core data model. Everything here is plain serialisable data — no Three.js.
 *
 * Coordinate system (millimetres throughout):
 *   x — across the van, 0 at the centreline, +x to the driver's right (UK: kerb side)
 *   y — along the van, 0 at the back of the second-row seats, +y towards the tailgate
 *   z — up, 0 at the boot floor
 *
 * So a box at y=0 is pushed up against the seats and y increases as you come out
 * towards the tailgate. This makes "what can I reach from the back" a simple
 * question about descending y.
 */

/** How much a given dimension can be trusted. Surfaced in the UI next to each field. */
export type Provenance =
  /** From a manufacturer or VW spec sheet. Trust it. */
  | 'published'
  /** Calculated from a published figure (e.g. an arch intrusion from two widths). */
  | 'derived'
  /** An educated guess. Wants a tape measure. */
  | 'estimated'
  /** The user measured their own vehicle or box. Trust it most. */
  | 'measured';

/** A single dimension with its units, provenance and an optional note explaining it. */
export interface Dim {
  value: number;
  provenance: Provenance;
  note?: string;
}

export const dim = (value: number, provenance: Provenance, note?: string): Dim => ({
  value,
  provenance,
  ...(note ? { note } : {}),
});

// ---------------------------------------------------------------------------
// Vehicle
// ---------------------------------------------------------------------------

export type RearDoors = 'tailgate' | 'barn';

/**
 * The load bay described parametrically. The bay is not a box: the walls lean in
 * as they rise (tumblehome), the wheel arches eat into the lower sides, and the
 * tailgate aperture is smaller than the space behind it.
 */
export interface VehicleProfile {
  id: string;
  name: string;
  /** Free-text note shown in the calibrate panel. */
  description: string;
  rearDoors: RearDoors;

  /** Floor length from the back of the second row to the load lip. */
  floorLength: Dim;
  /** Widest point of the load floor, between the trim at floor level. */
  floorWidth: Dim;
  /** Narrowest point — between the two rear wheel arch boxes. */
  widthBetweenArches: Dim;
  /** Floor to the highest point of the load area (roof lining). */
  loadHeight: Dim;

  /** Height of the wheel arch box above the floor. */
  archHeight: Dim;
  /** How far each arch intrudes from the side wall. */
  archIntrusion: Dim;
  /** Fore-aft length of the arch box. */
  archLength: Dim;
  /** Distance from the seat backs (y=0) to the front face of the arch. */
  archStartY: Dim;

  /** Width at roof height. Less than floorWidth — this is the wall lean. */
  widthAtRoof: Dim;

  /** Clear opening of the tailgate/barn doors. */
  apertureWidth: Dim;
  apertureHeight: Dim;
  /** Ground to the load lip. Not used for fitting, but it's what you lift over. */
  sillHeight: Dim;

  /** Rake of the second-row seat backs, degrees off vertical, leaning forward. */
  seatBackRake: Dim;

  /** Factory lashing eyes, and any you have added. */
  anchors: Anchor[];
  /** Third-row seat mounting brackets left in the floor once the seats come out. */
  floorObstructions: FloorObstruction[];

  /** Manufacturer payload, for the weight readout. */
  payloadKg: Dim;
}

export interface Anchor {
  id: string;
  label: string;
  /** Position in vehicle coordinates. Floor eyes sit at z=0. */
  x: number;
  y: number;
  z: number;
  kind: 'factory-eye' | 'added';
  /** Rated capacity if known, kg. */
  ratingKg?: number;
}

/** Something sticking up out of the floor that stops a box sitting flat. */
export interface FloorObstruction {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Boxes
// ---------------------------------------------------------------------------

/**
 * Stacking behaviour differs by system and it matters for restraint:
 *  - `latching` boxes (TOUGHSYSTEM 2.0) lock to each other, so a stack behaves
 *    as one rigid object — it has to fit through the aperture as a unit, but it
 *    won't shed its top box under braking.
 *  - `friction` boxes (attached-lid crates) just sit on each other. They need
 *    the stack checking for overhang and topple, and the restraint has to hold
 *    every box, not just the bottom one.
 */
export type StackMode = 'latching' | 'friction';

/** A catalogue entry — a type of box, not a box you own. */
export interface BoxSpec {
  id: string;
  system: string;
  name: string;
  /** Across the van when rotation is 0. */
  width: Dim;
  /** Along the van when rotation is 0. */
  depth: Dim;
  height: Dim;
  emptyWeightKg: Dim;
  stackMode: StackMode;
  /** Nominal capacity in litres, for the catalogue listing. Not used in geometry. */
  capacityL?: number;
  /**
   * Boxes in the same stackGroup interlock with each other. TOUGHSYSTEM boxes
   * share a group; ALCs of a common footprint share theirs.
   */
  stackGroup: string;
  colour: string;
}

/** A box actually placed in the van. */
export interface PlacedBox {
  id: string;
  specId: string;
  label: string;
  /** Centre of the box footprint, in vehicle coordinates. */
  x: number;
  y: number;
  /** Floor to the underside of the box. Non-zero when stacked. */
  z: number;
  /** Yaw about the vertical axis. Only right angles — these are boxes in a van. */
  rotation: 0 | 90 | 180 | 270;
  /** What you have put in it, kg. Added to the spec's empty weight. */
  contentsKg: number;
  /** Marked as needing frequent access — feeds the buried-box check. */
  needOften: boolean;
  /** Per-box dimension overrides once you have measured the real thing, mm. */
  overrides?: Partial<Record<'width' | 'depth' | 'height', number>>;
}

// ---------------------------------------------------------------------------
// Restraint
// ---------------------------------------------------------------------------

export interface Strap {
  id: string;
  label: string;
  fromAnchorId: string;
  toAnchorId: string;
  /** Boxes the strap passes over, in order from the `from` anchor. */
  overBoxIds: string[];
  kind: 'ratchet' | 'cam';
}

export interface CargoNet {
  id: string;
  label: string;
  /** Anchors the net is clipped to. Needs at least three to define a surface. */
  anchorIds: string[];
  /** Relaxed (unstretched) size of the net, for the over-stretch warning. */
  relaxedWidth: number;
  relaxedLength: number;
  /** How far the net will stretch before it is doing no useful work, as a ratio. */
  maxStretchRatio: number;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export interface Layout {
  schemaVersion: 1;
  name: string;
  savedAt: string;
  vehicle: VehicleProfile;
  boxes: PlacedBox[];
  straps: Strap[];
  nets: CargoNet[];
  /** Boxes heavier than this with no restraint touching them get flagged. */
  unrestrainedWarnKg: number;
}

// ---------------------------------------------------------------------------
// Derived geometry helpers shared across the pure modules
// ---------------------------------------------------------------------------

/** An axis-aligned bounding box in vehicle coordinates. */
export interface Aabb {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
