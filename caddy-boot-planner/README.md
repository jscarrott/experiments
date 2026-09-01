# Caddy Maxi boot planner

A 3D tool for working out how a set of storage boxes fits in the boot of a VW Caddy
Maxi Life (Typ 2K, 2010–2015), third row removed — and, more usefully, whether the
straps and cargo net actually hold them.

Built for attached-lid containers (Gatortote / Totebox style) and DeWalt TOUGHSYSTEM
2.0 boxes, plus a Coleman Pro 25QT cool box and a folded camp table.

The cool box is worth knowing about when you plan: at 445 mm it is the tallest single
item in the catalogue, so it is usually what decides what can go on top of what.

## Why it isn't just a box-in-a-box calculator

Four things make eyeballing this unreliable, and each is modelled:

**The usable bay is not the bay VW published.** The load space is about
**1120 mm wide × 1540 mm long × 1130 mm to the roof lining**. VW's published figures
describe the Caddy *van* — bare metal between the panels, measured from a bulkhead you
do not have. Their 1552 mm "maximum load width" is not available to you at any height,
and their 1262 mm height is the shell before it is trimmed. So the bay is described as
*available half-width at a given height and distance back* (`src/geometry/shell.ts`),
and a box is checked against the narrowest point over the span it actually occupies —
which on a van with proud wheel arches is the arches, and on a trimmed Life is the side
trim, the whole way up.

**It has to get through the hole first.** The tailgate opening is smaller than the space
behind it, so every box, and every latched stack as a unit, is tested against it in all
six orientations. A long thin box goes in end-first; something large on its two smallest
dimensions does not go in at all.

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

### The third-row rails

Taking the third row out leaves its mounting rails in the floor, and they are modelled
because they decide what sits flat. The distinction that matters: two parallel rails of
the same height are **not** a problem — a crate straddling both sits dead level, just
raised by the height of the rail, which costs you that much headroom. It is a crate
caught on *one* rail, or bridging rails of different heights, that rocks on a corner.

A useful consequence for this van: a 600 mm Euro crate is almost exactly the gap between
the rails, so it drops between them onto the floor rather than perching on them.

The shipped rail figures are **estimates** derived from the third row's position. They
are editable in the Calibrate panel along with everything else.

## Where the dimensions come from

The bay figures are **measured for this model** by kofferraum.org, from their drawing of
the 2010 Maxi 3-row — the usable trimmed space rather than VW's van shell figures.

| Dimension | Value | Source |
|---|---|---|
| Floor length, third row out | 1540 mm | Measured for this model |
| Usable width | 1120 mm | Measured for this model |
| Floor to roof lining | 1130 mm | Measured for this model |
| Width at roof height | 1110 mm | Measured for this model |
| Ground to load lip | 590 mm | Measured for this model |
| Tailgate opening | ~1100 × 1050 mm | **Estimated** |
| Third-row rails | 60 × 430 × 25 mm | **Estimated** |
| Lashing eye positions | — | **Estimated** |
| Payload | 600 kg | **Estimated** — check your door plate |

The same drawing gives the other two seat configurations, if you ever need them:
**620 mm** behind the third row with all seven seats up, and **1910 mm** with the second
row folded as well.

Everything marked estimated wants a tape measure. The **Calibrate** panel makes every
dimension editable and colour-codes it by provenance — a VW figure, a figure measured
for this model, a calculation, a guess, or your own measurement. Typing your own number
promotes it to "you measured" and re-runs every check. Box catalogue sizes work the same
way, with per-box overrides in the inspector.

## Running it

```bash
npm install
npm run dev          # dev server
npm test             # unit tests over the pure geometry (69 tests)
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

The split matters: `geometry/` imports nothing from `three`, so the fit maths, net drape,
rail support and strap lengths are tested with `node --test` and no browser. `state.ts`
runs the whole analysis on every change rather than patching it incrementally — under a
millisecond for a boot's worth of boxes, and it means the warnings panel can never
disagree with the 3D view.

## Controls

Drag a box to move it; it drops onto whatever is beneath, including the third-row
rails. `R` yaws 90°, `T` tips it onto the next face, `D` duplicates, `Delete` removes,
arrow keys nudge by the snap increment (shift for ×5). Click two floor anchors to run a
strap between them.

### Standing things on edge

A folded camp table laid flat wastes 0.39 m² of a 1.7 m² floor on a 70 mm-thick object.
The **Standing on** control tips any item onto a different face, so a slab can go on edge
against the trim and cost you its thickness instead of its footprint.

That comes with a check, because a 625 mm slab on a 70 mm base falls over on the first
roundabout. It is flagged **only when nothing is holding it up** — a side wall, the seat
backs, a neighbour of similar height, or a strap all count as bracing. Warning about the
correct way to pack something is how you train someone to ignore warnings.

One thing the tool catches here that you would not by eye: the side trim leans inwards as
it rises, so a table that sits hard against the trim when laid flat fouls it by a few
millimetres when stood up 625 mm tall. It has to come inboard slightly.

## What it deliberately doesn't do

No physics simulation, no strap tension figures, nothing approaching a load-securing
compliance check. It is a planning aid for spotting what obviously will not fit and
what is obviously held by nothing — not an engineering calculation.

Layouts save to browser storage, so a plan made on a laptop does not appear on a phone.
Use **Copy JSON** / **Paste JSON** to move one across.
