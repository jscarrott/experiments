/**
 * One palette for the 3D scene, so the meshes and the DOM panels agree.
 * Kept as numbers because Three.js wants them that way; the CSS side mirrors
 * these in style.css.
 */
export const THEME = {
  background: 0x14161c,
  floor: 0x2a2f3a,
  shell: 0x8fa4c8,
  shellEdge: 0x9fb4d8,
  arch: 0x3c4353,
  seats: 0x4a4038,
  obstruction: 0x8a6a3a,
  aperture: 0x5ad1a8,
  gridFine: 0x3a4152,
  gridCoarse: 0x525c73,

  selection: 0x5ad1a8,
  error: 0xe05a5a,
  warning: 0xe0a33a,
  anchor: 0xc8d2e6,
  anchorActive: 0x5ad1a8,
  strap: 0xe0a33a,
  net: 0x7fd4ff,
  netBridged: 0xe05a5a,
  cog: 0xff4d94,
} as const;
