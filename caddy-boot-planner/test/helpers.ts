import { CATALOGUE_BY_ID } from '../src/model/catalogue.js';
import { CADDY_MAXI_LIFE_2K } from '../src/model/vehicle.js';
import type { BoxSpec, PlacedBox, VehicleProfile } from '../src/model/types.js';
import { dim } from '../src/model/types.js';

/** Catalogue lookup extended with any ad-hoc specs a test needs. */
export function makeLookup(extra: BoxSpec[] = []) {
  const map = new Map(CATALOGUE_BY_ID);
  for (const spec of extra) map.set(spec.id, spec);
  return (id: string): BoxSpec => {
    const spec = map.get(id);
    if (!spec) throw new Error(`Unknown spec in test: ${id}`);
    return spec;
  };
}

/** A box spec with exact dimensions, so tests assert on numbers they chose. */
export function spec(
  id: string,
  width: number,
  depth: number,
  height: number,
  opts: Partial<Pick<BoxSpec, 'stackMode' | 'stackGroup' | 'system'>> = {},
): BoxSpec {
  return {
    id,
    system: opts.system ?? 'Test',
    name: id,
    width: dim(width, 'measured'),
    depth: dim(depth, 'measured'),
    height: dim(height, 'measured'),
    emptyWeightKg: dim(1, 'measured'),
    stackMode: opts.stackMode ?? 'friction',
    stackGroup: opts.stackGroup ?? 'test',
    colour: '#888888',
  };
}

export function place(
  id: string,
  specId: string,
  x: number,
  y: number,
  z = 0,
  opts: Partial<PlacedBox> = {},
): PlacedBox {
  return {
    id,
    specId,
    label: id,
    x,
    y,
    z,
    rotation: 0,
    contentsKg: 0,
    needOften: false,
    ...opts,
  };
}

/**
 * The shipped Caddy profile, but with the derived/estimated numbers pinned to
 * round values so tests assert against figures they state rather than against
 * defaults that are expected to change once the van gets measured.
 */
export function testProfile(overrides: Partial<VehicleProfile> = {}): VehicleProfile {
  const base = structuredClone(CADDY_MAXI_LIFE_2K);
  base.floorLength = dim(1200, 'measured');
  base.floorWidth = dim(1552, 'measured');
  base.widthBetweenArches = dim(1172, 'measured');
  base.loadHeight = dim(1200, 'measured');
  base.archHeight = dim(340, 'measured');
  base.archIntrusion = dim(190, 'measured');
  base.archLength = dim(700, 'measured');
  base.archStartY = dim(200, 'measured');
  base.widthAtRoof = dim(1300, 'measured');
  base.apertureWidth = dim(1220, 'measured');
  base.apertureHeight = dim(1100, 'measured');
  // Brackets get in the way of tests that are not about brackets.
  base.floorObstructions = [];
  return { ...base, ...overrides };
}
