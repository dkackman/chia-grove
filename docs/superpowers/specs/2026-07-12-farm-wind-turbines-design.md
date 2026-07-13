# Farm wind turbines — design

## Goal

Add a distant wind farm to the farm theme: wind turbines standing on the far horizon in random groupings at random distances. They are **scenery**, not a data channel — but they react to new blocks with a gust, so the horizon breathes with the chain.

## Context

The farm scene already separates two layers:

- **Chain-data layer** (each has a legend row): sun = netspace, chickens = mempool, tractor pass = new block, crows = reorg, crops = spends.
- **Scenery layer** (no legend rows): barn, silo, fence, hand-placed trees, three hazy hills, drifting clouds and cloud-shadows, chimney smoke, weathervane.

Turbines join the scenery layer. They get no legend entry.

Relevant existing facts the design depends on:

- The turf is a `CircleGeometry(140)` centred on the origin. Anything past radius 140 floats over open sky.
- The hills sit at z ≈ −78…−95, squashed to a y-scale of 0.16, so they are only ~8 units tall.
- Fog is `FogExp2` at density 0.005. Objects soften noticeably past ~100 units and are strongly hazed by ~150.
- The camera drifts along the field's near edge (z ≈ +20) looking at (0, 1, −6); far plane 500.
- The scene's wind blows **+x**: clouds drift +x, cloud-shadows drift +x, pollen motes have `windX: 1`.
- `prefers-reduced-motion` is respected throughout (tractor, crows, smoke, motes all back off).

## Placement

New module `web/src/themes/farm/turbines.ts` exports a **pure** `turbineLayout()` returning a deterministic array of turbine descriptors:

```ts
interface TurbineSpec {
  x: number;
  z: number;
  height: number; // tower height
  yaw: number; // rotor facing, into the +x wind, with jitter
  rate: number; // idle spin rate, rad/s
  phase: number; // starting blade phase
}
```

Seeded from a fixed constant via `mulberry32`, so the wind farm is identical on every reload and on every snapshot replay. This mirrors how `addTrees` seeds its per-tree variation.

Generation:

- **4 clusters of 2–4 turbines each** (≈11 total).
- Cluster centres: `z ∈ [−88, −124]`, `x ∈ [−110, 110]`.
- Members scatter ±(6–22) in x and ±(4–16) in z around their cluster centre.
- Each final z is clamped to **≤ −85**, keeping every turbine beyond the barn (z ≈ −26) and the hill line even after scatter.
- Each final position is clamped to **radius ≤ 132 from the origin**, so each turbine stands on turf rather than sky.
- Tower heights 34–50 units — hubs sit far above the ~8-unit hills.

Two consequences, both wanted:

- The hills are opaque domes, so a turbine behind or on one has its tower base occluded and reads as standing on the ridge.
- At 130–150 units from the camera the fog renders them as pale, hazy silhouettes with blades that are just resolvable in motion.

## Geometry and draw calls

- Tower: tapered cylinder. Nacelle: small box. Hub: short cone. Blades: three tapered, slightly twisted boxes merged into **one rotor geometry**.
- All towers + nacelles merge into a **single static mesh** (one draw call), the way `addTrees` merges trunks and canopies.
- Each rotor is its **own mesh** (it must spin independently) but shares one geometry and one material — 11 cheap draw calls plus the merged static one.
- `MeshStandardMaterial`, flat-shaded, using new palette entries `FARM.turbine` (near-white) and `FARM.turbineHub` (slightly darker). Near-white lets the fog tint them toward the haze colour instead of fighting it.
- No blob shadows. They stand past the hills, which have none either.

Rotor facing: every rotor faces into the established +x wind, with ±10° of per-turbine yaw jitter so they don't look stamped from a template.

## Motion

- **Idle:** each rotor spins on its own axis at its `rate` (0.35–0.6 rad/s) from its own starting `phase`, so blades never look synchronised.
- **Gust on block:** a `block` event sets each turbine's `boost` toward 1; it decays exponentially back to 0 over ~2 s, scaling the spin rate to roughly 2.5× at peak. The gust is **staggered by x position** so it sweeps across the horizon in the same +x direction as the wind — the ridgeline ripples with each block rather than snapping in unison.
- **Reduced motion:** base rate drops to a slow crawl and the gust boost is disabled.

## Wiring

In `web/src/themes/farm/index.ts`:

- Construct `const turbines = new Turbines(scene, reducedMotion);` beside the other props.
- Call `turbines.update(dt, t)` in the frame loop.
- Call `turbines.gust(clockT)` inside the existing `case "block":` arm.

No changes to the legend, to `layout.ts`, or to any event type.

## Tests

`turbineLayout()` is pure, so it is unit-tested the way `board/rows.ts` and `farm/layout.ts` are — a new `web/test/farm-turbines.test.ts`:

- **Determinism:** two calls return identical layouts.
- **On the turf:** every turbine's distance from the origin is ≤ 132 (inside the turf disc).
- **In the distance:** every turbine has `z ≤ −85`, i.e. beyond the barn and clear of the field and the camera drift path.
- **Grouped:** the turbines form distinct clusters rather than a uniform scatter — turbines are not all equidistant; each has at least one neighbour within cluster range.
- **Varied:** heights and idle rates span their intended ranges rather than collapsing to a constant.
