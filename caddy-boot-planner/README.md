# Caddy Maxi boot planner

A 3D tool for working out how a set of storage boxes fits in the boot of a VW Caddy
Maxi Life (Typ 2K, 2010–2015), third row removed — and, more usefully, whether the
straps and cargo net actually hold them.

Built for attached-lid containers (Gatortote / Totebox style) and DeWalt TOUGHSYSTEM
2.0 boxes.

## Why it isn't just a box-in-a-box calculator

Three things make eyeballing this unreliable, and each is modelled:

**The load bay is not a box.** Below wheel-arch height it is 1172 mm wide, not 1552 mm.
The side walls lean inward as they rise. The tailgate opening is smaller than the space
behind it. So instead of a bounding box, the bay is described as *available half-width
at a given height and distance back* (`src/geometry/shell.ts`), and every fit check is
measured against the narrowest point over the span a box actually occupies.

**Latching and stacking are different things.** A TOUGHSYSTEM stack latches into one
rigid unit: it has to go through the tailgate as a unit, but it will not shed its top
box under braking, and one strap over the top restrains all of it. A stack of crates
does none of that, so overhang, topple risk and per-box restraint all matter.

**A taut net bridges over anything short.** This is the one that is genuinely hard to
see. A net pulled over the load follows the upper convex hull of what is beneath it, so
a short box between two tall ones has the net passing clean over the top of it, touching
nothing. It looks restrained. It is not. `src/geometry/net.ts` computes the drape and
reports which boxes the net actually bears on, and the 3D view draws the membrane so
you can see it lift clear.

## The dimensions want checking

VW published load-compartment figures for the Caddy **van**, not for the Life with its
second-row seats in place. The widths carry over — same bodyshell — but the lengths do
not, because the van measures from the bulkhead.

| Dimension | Default | Where it came from |
|---|---|---|
| Width between wheel arches | 1172 mm | VW figure |
| Max load width | 1552 mm | VW figure |
| Max load height | 1262 mm | VW figure (Maxi) |
| Wheel arch intrusion per side | 190 mm | Calculated: (1552 − 1172) / 2 |
| Floor length, third row out | ~1100 mm | **Derived from the quoted 1.6 m³** |
| Tailgate opening | ~1220 × 1100 mm | **Estimated** |
| Ground to load lip | ~600 mm | **Estimated** |
| Floor lashing eyes | 6 | Published |

Everything below the line wants a tape measure. The **Calibrate** panel makes every
dimension editable and shows its provenance; typing your own number promotes it to
"you measured" and every check re-runs against it. Box catalogue sizes work the same
way — per-box overrides live in the inspector.

## Running it

```bash
npm install
npm run dev          # dev server
npm test             # unit tests over the pure geometry (35 tests)
npm run test:e2e     # Playwright smoke tests
npm run check        # typecheck + unit + build + e2e
```

### Publishing the single-file build

```bash
npm run build:artifact   # -> dist-artifact/artifact.html
npm run verify:artifact  # loads it standalone, asserts 0 network requests
```

`vite-plugin-singlefile` inlines everything including Three.js, so the published page
fetches nothing at runtime. That matters twice over: it sidesteps the Artifact host's
content-security policy entirely, and it means the tool still works on a phone with no
signal, at the back of the van, which is where you actually want it.

## Layout

```
src/
  model/       plain data: types, the Caddy profile, the box catalogue, save/load
  geometry/    pure functions, no Three.js — every check lives here and is unit-tested
  scene/       Three.js rendering: shell, boxes, straps, net membrane, camera
  ui/          DOM panels: catalogue, inspector, checks, tie-down, calibrate
```

The split matters: `geometry/` imports nothing from `three`, so the fit maths, net drape
and strap lengths are tested with `node --test` and no browser. `state.ts` runs the whole
analysis on every change rather than patching it incrementally — it is well under a
millisecond for a boot's worth of boxes, and it means the warnings panel can never
disagree with the 3D view.

## Controls

Drag a box to move it; it drops onto whatever is beneath. `R` rotates 90°, `D`
duplicates, `Delete` removes, arrow keys nudge by the snap increment (shift for ×5).
Click two floor anchors to run a strap between them.

## What it deliberately doesn't do

No physics simulation, no strap tension figures, nothing approaching a load-securing
compliance check. It is a planning aid for spotting what obviously will not fit and
what is obviously held by nothing — not an engineering calculation.

Layouts save to browser storage, so a plan made on a laptop does not appear on a phone.
Use **Copy JSON** / **Paste JSON** to move one across.
