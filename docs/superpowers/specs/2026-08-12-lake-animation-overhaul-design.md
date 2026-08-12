# Lake Animation Overhaul — Design

**Date:** 2026-08-12
**Status:** Approved direction: stylized naturalism, approach A (organic geometry + GPU animation)

## Problem

The lake theme's creatures read as blocky and mechanical:

- Fish are 9 hand-placed triangles; the only "swimming" is a rigid whole-body
  z-tilt on a perfect circle.
- Turtles are a squashed sphere with box flippers that never paddle.
- Jellyfish tentacles are rigid boxes; the bell pulse is disconnected from any
  propulsion.
- The reorg predator is a plain cone.
- Every path is a perfect circle with a symmetric sine bob.
- `bandDepth` takes an integer age, so every creature snaps down 1.5 units the
  instant a block lands — literal blockiness in the sinking motion.

## Direction

Stylized naturalism: smooth organic silhouettes, believable swimming motion,
evolving the existing calm/cool palette and meditative pace rather than
replacing them. All body animation moves to vertex shaders using the
`onBeforeCompile` displacement pattern `bed.ts` already uses for weed sway, so
per-frame CPU cost stays where it is today.

Out of scope: water surface, god rays, bubbles, beacons, bed, palette, camera.

## 1. Fish (`shoal.ts`)

**Geometry.** Replace the triangle dart with a procedural swept body: an
elliptical cross-section swept along the spine (~14 segments nose→tail, 8
radial), tapering smoothly at both ends, plus a forked caudal fin and a small
dorsal fin. Still a single `BufferGeometry` on a single `InstancedMesh`
(~250 triangles per fish, trivial under instancing). Smooth shading — drop
`flatShading`. Keeps pointing +X with nose near +0.6 and tail near −0.6 so the
existing heading math and size scale carry over.

**Swimming (vertex shader).** Spine undulation: lateral displacement
`z += sin(t·freq − x·waveLen + phase) · amp(x)` where `amp(x)` grows toward
the tail (near-zero at the head). Per-instance phase derives from the
instance matrix translation (the weed trick). Beat frequency divides by the
instance scale (length of an instance-matrix basis vector), so big fish beat
slowly and minnows flutter. The CPU z-wiggle in `Shoal.update` is removed —
the shader owns body motion.

**Path (CPU).** The circular circuit stays but gains:

- Slow radius and angle wander, deterministic from the coin id (extend
  `seatOffset` with wander phase/rate fields) so paths stop being perfect
  circles and replays rebuild identically.
- A banking roll into turns proportional to angular speed (replacing part of
  what the removed wiggle did).

## 2. Turtles (`turtles.ts`)

**Geometry.** A proper carapace (lathe-style profile: domed top with a slight
ridge, flat plastron underneath), head on a short neck, and four tapered
flippers — front pair large, rear pair small.

**Animation (CPU — 30 turtles is nothing).** A paddle stroke cycle: front
flippers sweep through a power stroke and recovery; the turtle's angular
advance is modulated by stroke phase so it surges on the power stroke and
glides between, with a slight nose-up pitch during the glide. Stroke math is a
pure function so it is testable. Angular advance changes from
`angle + t·speed` to an integrated angle updated per frame with `dt`.

## 3. Jellyfish (`jellies.ts`)

**Bell.** Higher-resolution dome; a contraction wave in the vertex shader — a
radial squeeze traveling apex→rim, strongest at the rim so the margin flares.
Replaces (or drives) the current CPU whole-bell scale pulse.

**Tentacles.** The five rigid boxes become segmented ribbon tentacles (plane
geometry with vertical segments, like the weed blades) displaced in a vertex
shader: displacement grows with distance from the bell and lags the bell's
pulse phase (whip follow-through).

**Propulsion.** Vertical motion becomes pulse-and-coast: a quick rise synced
to the bell contraction, then a slow sink — an asymmetric wave replacing the
symmetric sine bob. The wave is a pure function shared between the CPU
position update and the shader phase so bell and motion stay in sync.

**Untouched:** art panel billboarding, media pipeline (LoadPool,
`stillWanted`, `resolveMedia`), launcher dedupe, `markSensitive`, picking.

## 4. Predator (`vfx.ts`)

The cone becomes a pike silhouette built with the same swept-body builder as
the fish (stretched proportions, larger tail), with stronger shader
undulation. The strike path becomes an S-curve with banking instead of a
straight fade-across. Fade-in/out envelope, `STRIKE_SECONDS`, and trigger
logic stay. Bubbles and beacons unchanged.

## 5. Smooth sinking (`lake.ts` + `layout.ts`)

`lake.ts` keeps a `blocksSeenSmooth` float that eases toward `blocksSeen`
over roughly 2 seconds and passes it to every `update()`. `bandDepth`
accepts a float age (its clamp already works for floats). The whole lake then
glides down one band per block instead of snapping. Event handlers
(`plant(event, blocksSeen)`) keep receiving the integer counter for
`bornBlock`.

## Architecture notes

- Shared swept-body geometry builder (fish + predator) lives in a new
  `lake/bodies.ts` (or similar) as exported pure functions, unit-testable
  without a renderer.
- Each animated material does its own `onBeforeCompile`, following `bed.ts`
  precedent; one `uTime` uniform write per material per frame.
- Pool/recycle, reorg culling (`clearAbove` + draw-count shrink), picking
  (`metaAt`/`metaFor`/`setHighlight`), and the pinned bounding spheres all
  keep their current shapes.
- Determinism invariant: everything visual derives from coin id / slot index /
  elapsed time, never `Math.random`, so snapshot replays rebuild the same lake.

## Testing

- Geometry builders: vertex counts, bounds, orientation (nose at +X),
  fin presence — extending `lake-geometry.test.ts`.
- Wander/stroke/pulse math as pure functions: deterministic-replay tests
  (same coin id ⇒ same path), surge ≥ 0, pulse asymmetry.
- `bandDepth` float behavior: monotonic in age, clamps at 0 and `MAX_BANDS`.
- Existing tests for pooling, reorg culling, media pipeline, picking continue
  to cover the unchanged code paths; update any that assert on old geometry
  specifics.

## Risks

- Shader edits via `onBeforeCompile` are string surgery — kept small and
  mirrored on the proven `bed.ts` pattern.
- More vertices per creature is negligible under instancing; the jellyfish
  tentacle ribbons add a few hundred triangles per jelly across a 40 cap,
  also negligible.
