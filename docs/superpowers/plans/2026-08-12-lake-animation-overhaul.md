# Lake Animation Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the lake theme's blocky creatures and mechanical motion with smooth procedural bodies animated by vertex shaders, plus smooth block-to-block sinking.

**Architecture:** Geometry becomes procedural swept bodies (new `bodies.ts`); all body animation moves into vertex shaders via the `onBeforeCompile` pattern `bed.ts` already uses; path motion (wander, banking, stroke-surge, pulse-coast) is pure math in a new `motion.ts`; `lake.ts` eases a float block counter so sinking glides instead of snapping.

**Tech Stack:** Three.js r170+, TypeScript, vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-12-lake-animation-overhaul-design.md`

## Global Constraints

- Determinism: everything visual derives from coin id / slot index / elapsed time — never `Math.random` (snapshot replays must rebuild the same lake).
- Per-frame CPU budget stays where it is: body animation is GPU-only; CPU work is O(active creatures) simple math, as today.
- Unchanged code paths: pooling/wrapping, `clearAbove` reorg culling (incl. draw-count shrink), picking (`metaAt`/`metaFor`/`setHighlight`), pinned bounding spheres, jelly media pipeline (LoadPool, `stillWanted`, `resolveMedia`, launcher dedupe, `markSensitive`).
- Out of scope: water surface, god rays, bubbles, beacons, bed, palette, camera.
- Run tests from the repo root: `npx vitest run web/test/<file>.test.ts`. Full gate: `npm test && npm run typecheck && npm run lint`.
- Node ≥ 24; no build step needed for dev.

---

### Task 1: Float-age `bandDepth` + wander fields on `Seat`

**Files:**
- Modify: `web/src/themes/lake/layout.ts`
- Test: `web/test/lake-layout.test.ts`

**Interfaces:**
- Produces: `Seat` gains `wanderPhase: number` (0..2π) and `wanderRate: number` (0.1..0.35). `bandDepth(age: number)` explicitly supports fractional ages (implementation already does; tests pin it). New `easeBlocks(current: number, target: number, dt: number): number`.

- [ ] **Step 1: Write the failing tests** — append to `web/test/lake-layout.test.ts`:

```ts
import { easeBlocks } from "../src/themes/lake/layout.js";

test("fractional ages sit between bands, so sinking can glide", () => {
  expect(bandDepth(0.5)).toBeCloseTo(TOP_BAND_Y - 0.5 * BAND_STEP, 5);
  expect(bandDepth(0.5)).toBeLessThan(bandDepth(0));
  expect(bandDepth(0.5)).toBeGreaterThan(bandDepth(1));
});

test("seats carry deterministic wander parameters", () => {
  const seat = seatOffset("a1b2c3d4" + "00".repeat(28));
  expect(seat).toEqual(seatOffset("a1b2c3d4" + "00".repeat(28)));
  expect(seat.wanderPhase).toBeGreaterThanOrEqual(0);
  expect(seat.wanderPhase).toBeLessThan(Math.PI * 2);
  expect(seat.wanderRate).toBeGreaterThanOrEqual(0.1);
  expect(seat.wanderRate).toBeLessThanOrEqual(0.35);
});

test("adding wander draws did not reshuffle existing circuits", () => {
  // the wander fields are drawn AFTER the original four, so radius/angle/bob/
  // speed for a given coin id must not change from the shipped lake
  const seat = seatOffset("a1b2c3d4" + "00".repeat(28));
  expect(seat.radius).toBeGreaterThanOrEqual(BAND_RADIUS_MIN);
  expect(seat.speed).toBeGreaterThan(0.05 - 1e-9);
  expect(seat.speed).toBeLessThan(0.14);
});

test("easeBlocks glides toward the target and settles exactly on it", () => {
  let v = 0;
  v = easeBlocks(v, 1, 0.016);
  expect(v).toBeGreaterThan(0);
  expect(v).toBeLessThan(1);
  for (let i = 0; i < 600; i++) v = easeBlocks(v, 1, 0.016);
  expect(v).toBe(1);
  expect(easeBlocks(5, 5, 0.016)).toBe(5);
  expect(easeBlocks(3, 7, 0)).toBe(3);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run web/test/lake-layout.test.ts`
Expected: FAIL — `wanderPhase` undefined, `easeBlocks` not exported.

- [ ] **Step 3: Implement** in `web/src/themes/lake/layout.ts`:

Extend `Seat` and `seatOffset` (the two new draws come **after** the existing four so shipped circuits don't reshuffle):

```ts
export interface Seat {
  radius: number;
  angle: number;
  bob: number;
  speed: number;
  /** phase/rate of the slow path wander that keeps circuits from being perfect circles */
  wanderPhase: number;
  wanderRate: number;
}

export function seatOffset(coinIdHex: string): Seat {
  const rand = mulberry32(parseInt(coinIdHex.slice(0, 8), 16));
  return {
    radius: BAND_RADIUS_MIN + Math.sqrt(rand()) * (BAND_RADIUS_MAX - BAND_RADIUS_MIN),
    angle: rand() * Math.PI * 2,
    bob: rand() * Math.PI * 2,
    speed: 0.05 + rand() * 0.09,
    wanderPhase: rand() * Math.PI * 2,
    wanderRate: 0.1 + rand() * 0.25,
  };
}
```

Add below `bandDepth` (whose float support needs no code change — the clamp and multiply already work on fractions; the tests pin it):

```ts
/**
 * Exponential ease of the smooth block counter toward the integer target, so
 * the whole lake glides down a band on each block instead of snapping 1.5
 * units. Rate 2.2/s closes ~97% of a one-band step in ~1.6 s. Snaps exactly
 * onto the target below 1e-3 so a settled lake stops writing new depths.
 */
export function easeBlocks(current: number, target: number, dt: number): number {
  const next = current + (target - current) * (1 - Math.exp(-dt * 2.2));
  return Math.abs(target - next) < 1e-3 ? target : next;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run web/test/lake-layout.test.ts`
Expected: PASS (all, including the pre-existing tests — nothing reshuffled).

- [ ] **Step 5: Commit**

```bash
git add web/src/themes/lake/layout.ts web/test/lake-layout.test.ts
git commit -m "feat(lake): wander seat params, float band depth, easeBlocks"
```

---

### Task 2: Pure motion math — `motion.ts`

**Files:**
- Create: `web/src/themes/lake/motion.ts`
- Test: `web/test/lake-motion.test.ts` (new)

**Interfaces:**
- Consumes: `Seat` from Task 1.
- Produces:
  - `wanderedRadius(seat: Seat, t: number): number`
  - `wanderedAngle(seat: Seat, t: number): number`
  - `bankRoll(seat: Seat, t: number): number` — roll in radians, |value| ≤ 0.5
  - `turtleStroke(p: number): { sweep: number; surge: number; pitch: number }` — `surge > 0` always
  - `jellyPulse(p: number): { squeeze: number; lift: number }` — asymmetric (fast rise, slow fall); `squeeze` ∈ [0, 1]
  - `PULSE_SKEW = 0.65` (shared with the GLSL copy in Task 6 — keep them identical)

- [ ] **Step 1: Write the failing tests** — `web/test/lake-motion.test.ts`:

```ts
import { expect, test } from "vitest";
import { seatOffset, BAND_RADIUS_MIN, BAND_RADIUS_MAX } from "../src/themes/lake/layout.js";
import {
  wanderedRadius,
  wanderedAngle,
  bankRoll,
  turtleStroke,
  jellyPulse,
} from "../src/themes/lake/motion.js";

const seat = seatOffset("a1b2c3d4" + "00".repeat(28));

test("wander is deterministic and keeps the circuit inside the column", () => {
  for (let t = 0; t < 120; t += 0.7) {
    expect(wanderedRadius(seat, t)).toBe(wanderedRadius(seat, t));
    expect(wanderedRadius(seat, t)).toBeGreaterThanOrEqual(BAND_RADIUS_MIN - 2);
    expect(wanderedRadius(seat, t)).toBeLessThanOrEqual(BAND_RADIUS_MAX + 2);
  }
});

test("a wandered path is not a perfect circle", () => {
  const radii = new Set<number>();
  for (let t = 0; t < 60; t += 1) radii.add(Math.round(wanderedRadius(seat, t) * 100));
  expect(radii.size).toBeGreaterThan(3);
});

test("the angle still advances monotonically on average", () => {
  // wander sways the heading but must never stall the circuit for long
  expect(wanderedAngle(seat, 100) - wanderedAngle(seat, 0)).toBeGreaterThan(
    seat.speed * 100 * 0.5
  );
});

test("banking stays subtle and finite", () => {
  for (let t = 0; t < 60; t += 0.3) {
    const roll = bankRoll(seat, t);
    expect(Number.isFinite(roll)).toBe(true);
    expect(Math.abs(roll)).toBeLessThanOrEqual(0.5);
  }
});

test("the turtle stroke surges but never reverses", () => {
  let min = Infinity;
  let max = -Infinity;
  for (let p = 0; p < Math.PI * 2; p += 0.05) {
    const s = turtleStroke(p);
    expect(s.surge).toBeGreaterThan(0);
    min = Math.min(min, s.surge);
    max = Math.max(max, s.surge);
  }
  expect(max).toBeGreaterThan(min * 2); // a real surge, not a constant
});

test("the stroke cycle is periodic", () => {
  const a = turtleStroke(1.3);
  const b = turtleStroke(1.3 + Math.PI * 2);
  expect(a.sweep).toBeCloseTo(b.sweep, 10);
  expect(a.surge).toBeCloseTo(b.surge, 10);
});

test("the jelly pulse rises fast and falls slow", () => {
  // finite-difference slope at the rise (p=0) vs the fall (p=π)
  const d = 1e-4;
  const rise = (jellyPulse(d).lift - jellyPulse(-d).lift) / (2 * d);
  const fall = (jellyPulse(Math.PI + d).lift - jellyPulse(Math.PI - d).lift) / (2 * d);
  expect(rise).toBeGreaterThan(Math.abs(fall) * 2);
});

test("squeeze is a normalized contraction", () => {
  for (let p = 0; p < Math.PI * 2; p += 0.05) {
    const { squeeze } = jellyPulse(p);
    expect(squeeze).toBeGreaterThanOrEqual(0);
    expect(squeeze).toBeLessThanOrEqual(1);
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run web/test/lake-motion.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `web/src/themes/lake/motion.ts`:

```ts
import type { Seat } from "./layout.js";
import { BAND_RADIUS_MIN, BAND_RADIUS_MAX } from "./layout.js";

const WANDER_RADIUS = 1.8;
const WANDER_SWAY = 0.3;
const SWAY_RATE = 0.63; // sway runs slower than the radial wander so paths never loop

/**
 * Skew of the jelly pulse wave. The GLSL in jellies.ts repeats this constant —
 * keep the two identical or the bell contraction and the vertical coast drift
 * out of sync.
 */
export const PULSE_SKEW = 0.65;

/** Circuit radius with a slow deterministic breathing, clamped to the column. */
export function wanderedRadius(seat: Seat, t: number): number {
  const r = seat.radius + Math.sin(t * seat.wanderRate + seat.wanderPhase) * WANDER_RADIUS;
  return Math.max(BAND_RADIUS_MIN - 2, Math.min(BAND_RADIUS_MAX + 2, r));
}

/** Circuit angle: steady advance plus a heading sway. */
export function wanderedAngle(seat: Seat, t: number): number {
  return (
    seat.angle +
    t * seat.speed +
    Math.sin(t * seat.wanderRate * SWAY_RATE + seat.wanderPhase * 1.7) * WANDER_SWAY
  );
}

/**
 * Roll into the turn, proportional to how fast the heading is changing —
 * the analytic d/dt of wanderedAngle, so it needs no per-frame state.
 */
export function bankRoll(seat: Seat, t: number): number {
  const swayRate = seat.wanderRate * SWAY_RATE;
  const headingRate =
    seat.speed + Math.cos(t * swayRate + seat.wanderPhase * 1.7) * WANDER_SWAY * swayRate;
  return Math.max(-0.5, Math.min(0.5, headingRate * 3.5));
}

export interface Stroke {
  /** flipper sweep angle (radians), symmetric around the rest pose */
  sweep: number;
  /** speed multiplier: >1 during the power stroke, <1 while gliding; never 0 */
  surge: number;
  /** body pitch (radians): slight nose-up during the glide */
  pitch: number;
}

/** One paddle cycle: power stroke → surge, recovery → glide. p in radians. */
export function turtleStroke(p: number): Stroke {
  const push = Math.max(0, Math.sin(p - 0.7)); // thrust trails the sweep slightly
  return {
    sweep: Math.sin(p) * 0.9,
    surge: 0.35 + 1.5 * push * push,
    pitch: 0.08 - 0.12 * push,
  };
}

/**
 * Asymmetric pulse: sin(p + k·sin(p)) rises steeply and relaxes slowly — the
 * medusa beat. `lift` drives the vertical coast (rise on contraction, slow
 * sink after); `squeeze` is the 0..1 contraction envelope for the bell.
 */
export function jellyPulse(p: number): { squeeze: number; lift: number } {
  const w = Math.sin(p + PULSE_SKEW * Math.sin(p));
  return { squeeze: Math.max(0, w), lift: w };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run web/test/lake-motion.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/themes/lake/motion.ts web/test/lake-motion.test.ts
git commit -m "feat(lake): pure motion math — wander, banking, stroke, pulse"
```

---

### Task 3: Swept-body geometry + swim shader — `bodies.ts`

**Files:**
- Create: `web/src/themes/lake/bodies.ts`
- Modify: `web/test/lake-geometry.test.ts` (import `fishGeometry` from `bodies.js` instead of `shoal.js`)
- Test: `web/test/lake-bodies.test.ts` (new)

**Interfaces:**
- Produces:
  - `sweptBody(spec: BodySpec): THREE.BufferGeometry` — smooth body pointing +X, indexed, with caudal + dorsal fins, normals computed
  - `fishGeometry(): THREE.BufferGeometry` — nose ≈ +0.6, tail fin tip ≈ −0.61 (same envelope as the old dart, so `fishSize` scales carry over)
  - `pikeGeometry(): THREE.BufferGeometry` — the predator: ~5.2 units nose-to-tail before scaling
  - `applySwimShader(material: THREE.Material, opts: SwimOpts): { uniforms: { uTime: { value: number } } }` — injects spine undulation; `opts = { instanced, amp, freq, waveLen, nose, span }`
- Consumers: Task 4 (`shoal.ts`) and Task 7 (`vfx.ts`).

- [ ] **Step 1: Write the failing tests** — `web/test/lake-bodies.test.ts`:

```ts
import * as THREE from "three";
import { expect, test } from "vitest";
import * as motion from "../src/themes/lake/motion.js";
import { fishGeometry, pikeGeometry, applySwimShader } from "../src/themes/lake/bodies.js";

function bounds(g: THREE.BufferGeometry): THREE.Box3 {
  g.computeBoundingBox();
  return g.boundingBox!;
}

test("the fish is a smooth body, not a 9-triangle dart", () => {
  const g = fishGeometry();
  expect(g.getAttribute("position").count).toBeGreaterThan(100);
  expect(g.getIndex()).not.toBeNull();
  expect(g.getAttribute("normal")).toBeDefined();
});

test("the fish keeps the old envelope: nose at +X, tail fin behind", () => {
  const b = bounds(fishGeometry());
  expect(b.max.x).toBeCloseTo(0.6, 1);
  expect(b.min.x).toBeLessThan(-0.55); // caudal fin extends past the tail
  expect(b.max.y).toBeLessThan(0.45); // dorsal + body stay in the old height class
  expect(Math.abs(b.max.z)).toBeLessThan(0.2); // slimmer than it is tall
});

test("the pike is a stretched predator body", () => {
  const b = bounds(pikeGeometry());
  expect(b.max.x - b.min.x).toBeGreaterThan(4.5);
  expect(b.max.x).toBeGreaterThan(2.5); // nose forward, same +X convention
});

test("the swim shader injects undulation and wires uTime", () => {
  const material = new THREE.MeshStandardMaterial();
  const swim = applySwimShader(material, {
    instanced: true,
    amp: 0.1,
    freq: 6.5,
    waveLen: 3.2,
    nose: 0.6,
    span: 1.2,
  });
  const fake = { uniforms: {} as Record<string, unknown>, vertexShader: "#include <begin_vertex>" };
  material.onBeforeCompile!(fake as never, null as never);
  expect(fake.uniforms.uTime).toBe(swim.uniforms.uTime);
  expect(fake.vertexShader).toContain("transformed.z +=");
  expect(fake.vertexShader).toContain("instanceMatrix");
  swim.uniforms.uTime.value = 42; // the returned holder is live
  expect((fake.uniforms.uTime as { value: number }).value).toBe(42);
});

test("a non-instanced swim shader never references instanceMatrix", () => {
  const material = new THREE.MeshStandardMaterial();
  applySwimShader(material, {
    instanced: false,
    amp: 0.5,
    freq: 5,
    waveLen: 1.1,
    nose: 2.8,
    span: 5.2,
  });
  const fake = { uniforms: {} as Record<string, unknown>, vertexShader: "#include <begin_vertex>" };
  material.onBeforeCompile!(fake as never, null as never);
  expect(fake.vertexShader).not.toContain("instanceMatrix");
});

test("PULSE_SKEW is exported for the GLSL copy to mirror", () => {
  expect(motion.PULSE_SKEW).toBeCloseTo(0.65, 10);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run web/test/lake-bodies.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `web/src/themes/lake/bodies.ts`:

```ts
import * as THREE from "three";

/**
 * Procedural swept bodies for the swimmers. One indexed BufferGeometry per
 * body: elliptical cross-sections swept along the +X spine with a smooth
 * width/height profile, plus flat caudal and dorsal fins. Everything points
 * +X (the swimming direction), matching the old dart's convention so the
 * heading math in shoal.ts and vfx.ts carries over unchanged.
 */
export interface BodySpec {
  /** spine extents; nose > tail, body points +X */
  nose: number;
  tail: number;
  /** peak half-height / half-width of the body */
  height: number;
  width: number;
  /** where along the spine (0 = tail, 1 = nose) the body is fattest */
  peak: number;
  /** rings along the spine / vertices per ring */
  segments: number;
  radial: number;
  /** caudal fin: half-height of the fork and how far it trails the tail */
  finHeight: number;
  finLength: number;
  /** dorsal fin height above the back (0 = none) */
  dorsal: number;
}

/** Smooth 0→1→0 profile along the spine, eased so the taper has no corners. */
export function bodyProfile(u: number, peak: number): number {
  const x = u <= peak ? u / peak : (1 - u) / (1 - peak);
  return Math.sin((Math.PI / 2) * Math.max(0, Math.min(1, x))) ** 0.8;
}

export function sweptBody(spec: BodySpec): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];

  for (let s = 0; s <= spec.segments; s++) {
    const u = s / spec.segments; // 0 at tail, 1 at nose
    const x = spec.tail + u * (spec.nose - spec.tail);
    const p = bodyProfile(u, spec.peak);
    // the epsilon keeps the end rings from collapsing to coincident points,
    // which would give computeVertexNormals zero-area triangles
    const ry = spec.height * p + 0.004;
    const rz = spec.width * p + 0.004;
    for (let r = 0; r < spec.radial; r++) {
      const a = (r / spec.radial) * Math.PI * 2;
      positions.push(x, Math.sin(a) * ry, Math.cos(a) * rz);
    }
  }
  for (let s = 0; s < spec.segments; s++) {
    for (let r = 0; r < spec.radial; r++) {
      const a = s * spec.radial + r;
      const b = s * spec.radial + ((r + 1) % spec.radial);
      indices.push(a, a + spec.radial, b, b, a + spec.radial, b + spec.radial);
    }
  }

  // caudal fin: a forked flat blade trailing off the tail tip (DoubleSide
  // material required, which the fish material already is)
  const f = positions.length / 3;
  positions.push(
    spec.tail + 0.06, 0, 0, // root, tucked just inside the tail
    spec.tail - spec.finLength, spec.finHeight, 0, // upper tip
    spec.tail - spec.finLength * 0.55, 0, 0, // fork notch
    spec.tail - spec.finLength, -spec.finHeight, 0 // lower tip
  );
  indices.push(f, f + 1, f + 2, f, f + 2, f + 3);

  if (spec.dorsal > 0) {
    const d = positions.length / 3;
    const mid = spec.tail + (spec.nose - spec.tail) * spec.peak;
    const back = spec.height * 0.9;
    positions.push(mid + 0.12, back, 0, mid - 0.18, back + spec.dorsal, 0, mid - 0.22, back, 0);
    indices.push(d, d + 1, d + 2);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/** XCH/CAT fish. Same envelope as the retired 9-triangle dart. */
export function fishGeometry(): THREE.BufferGeometry {
  return sweptBody({
    nose: 0.6,
    tail: -0.35,
    height: 0.17,
    width: 0.11,
    peak: 0.62,
    segments: 14,
    radial: 8,
    finHeight: 0.26,
    finLength: 0.26,
    dorsal: 0.1,
  });
}

/** The reorg predator: a stretched pike silhouette. */
export function pikeGeometry(): THREE.BufferGeometry {
  return sweptBody({
    nose: 2.8,
    tail: -2.4,
    height: 0.55,
    width: 0.42,
    peak: 0.55,
    segments: 18,
    radial: 10,
    finHeight: 0.9,
    finLength: 0.8,
    dorsal: 0.3,
  });
}

export interface SwimOpts {
  /** instanced meshes phase by instance position and slow the beat by scale */
  instanced: boolean;
  /** lateral displacement at the tail, in object units */
  amp: number;
  /** tail beats per second-ish (radians/s before the scale divide) */
  freq: number;
  /** spatial wavelength factor along the spine */
  waveLen: number;
  /** nose x and nose-to-tail span, for the amplitude ramp */
  nose: number;
  span: number;
}

/**
 * Spine undulation in the vertex shader — the weed-sway onBeforeCompile
 * pattern. Displacement is lateral (z), ramping from zero at the nose to full
 * at the tail. Instanced bodies read a per-instance phase from the instance
 * matrix translation (the trick bed.ts uses) and divide the beat frequency by
 * the instance scale, so big fish beat slowly and minnows flutter. Returns a
 * live uniforms holder; write holder.uniforms.uTime.value once per frame.
 */
export function applySwimShader(
  material: THREE.Material,
  opts: SwimOpts
): { uniforms: { uTime: { value: number } } } {
  const holder = { uniforms: { uTime: { value: 0 } } };
  const f = (n: number) => n.toFixed(4);
  const perInstance = opts.instanced
    ? `float swimPhase = instanceMatrix[3][0] * 1.7 + instanceMatrix[3][2] * 2.3;
        float bodyScale = length(vec3(instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2]));`
    : `float swimPhase = 0.0;
        float bodyScale = 1.0;`;
  material.onBeforeCompile = (s) => {
    s.uniforms.uTime = holder.uniforms.uTime;
    s.vertexShader =
      "uniform float uTime;\n" +
      s.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        ${perInstance}
        float ramp = clamp((${f(opts.nose)} - position.x) / ${f(opts.span)}, 0.0, 1.15);
        transformed.z += sin(uTime * ${f(opts.freq)} / max(bodyScale, 0.4)
                             + swimPhase - position.x * ${f(opts.waveLen)})
                         * ${f(opts.amp)} * ramp * ramp;`
      );
  };
  return holder;
}
```

- [ ] **Step 4: Update the geometry test import** — in `web/test/lake-geometry.test.ts` change:

```ts
import { fishGeometry } from "../src/themes/lake/shoal.js";
```

to:

```ts
import { fishGeometry } from "../src/themes/lake/bodies.js";
```

(`shoal.ts` still exports its own `fishGeometry` until Task 4 removes it; the test now points at the new home.)

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run web/test/lake-bodies.test.ts web/test/lake-geometry.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/themes/lake/bodies.ts web/test/lake-bodies.test.ts web/test/lake-geometry.test.ts
git commit -m "feat(lake): procedural swept bodies and GPU swim shader"
```

---

### Task 4: Fish — new body, shader swimming, wandering banked paths

**Files:**
- Modify: `web/src/themes/lake/shoal.ts`
- Test: `web/test/lake-shoal.test.ts` (existing tests must keep passing; add one)

**Interfaces:**
- Consumes: `fishGeometry`, `applySwimShader` (Task 3); `wanderedRadius`, `wanderedAngle`, `bankRoll` (Task 2); `Seat` wander fields (Task 1).
- Produces: `Shoal` public API unchanged (`plant`, `update(t, blocksSeen)`, `clearAbove`, `metaAt`, `pickables`, `metaFor`, `setHighlight`, `mesh`). `blocksSeen` may now be fractional.

- [ ] **Step 1: Add a failing test** — append to `web/test/lake-shoal.test.ts`:

```ts
test("a fractional block counter puts the fish between bands", () => {
  const shoal = new Shoal(new THREE.Scene(), 0xffffff);
  shoal.plant(xch(id(7)), 0, 1, null);
  shoal.update(0, 0.5);
  const y = yOf(shoal, 0);
  expect(y).toBeLessThan(bandDepth(0) + 0.4);
  expect(y).toBeGreaterThan(bandDepth(1) - 0.4);
});

test("fish paths wander rather than tracing a fixed circle", () => {
  const shoal = new Shoal(new THREE.Scene(), 0xffffff);
  shoal.plant(xch(id(7)), 0, 1, null);
  const radii = new Set<number>();
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  for (let t = 0; t < 60; t += 1) {
    shoal.update(t, 0);
    shoal.mesh.getMatrixAt(0, m);
    v.setFromMatrixPosition(m);
    radii.add(Math.round(Math.hypot(v.x, v.z) * 100));
  }
  expect(radii.size).toBeGreaterThan(3);
});
```

- [ ] **Step 2: Run to verify the wander test fails**

Run: `npx vitest run web/test/lake-shoal.test.ts`
Expected: the fractional test passes already (bandDepth handles floats); "paths wander" FAILS (radius is constant today).

- [ ] **Step 3: Implement** in `web/src/themes/lake/shoal.ts`:

1. Delete the local `fishGeometry` (lines 10–71) and import instead:

```ts
import { fishGeometry, applySwimShader } from "./bodies.js";
import { wanderedRadius, wanderedAngle, bankRoll } from "./motion.js";
import type { Seat } from "./layout.js";
```

2. `FishSlot` replaces `radius`/`angle`/`speed`/`bob` with a `seat` (member offsets baked in at plant):

```ts
interface FishSlot {
  meta: SproutEvent | null;
  bornBlock: number;
  seat: Seat;
  size: number;
  baseColor: THREE.Color;
}
```

3. Constructor: smooth shading and the swim shader (store the holder on a private field `swim`):

```ts
const material = new THREE.MeshStandardMaterial({
  color,
  roughness: 0.55,
  metalness: 0.15,
  side: THREE.DoubleSide, // the fins are single-sided blades
});
this.swim = applySwimShader(material, {
  instanced: true,
  amp: 0.1,
  freq: 6.5,
  waveLen: 3.2,
  nose: 0.6,
  span: 1.2,
});
this.mesh = new THREE.InstancedMesh(fishGeometry(), material, cap);
```

(field: `private readonly swim: { uniforms: { uTime: { value: number } } };` — declare before the constructor. Slot init: `seat: { radius: 0, angle: 0, bob: 0, speed: 0, wanderPhase: 0, wanderRate: 0.2 }`.)

4. `plant()` bakes the member offsets into a seat copy:

```ts
const seat = seatOffset(event.coinId);
slot.seat = {
  ...seat,
  radius: seat.radius + member * 0.4,
  angle: seat.angle + member * 0.07,
  bob: seat.bob + member * 0.5,
};
```

5. `update()` — wander, bank, no CPU wiggle (the shader owns body motion), and pass `t` to the GPU:

```ts
update(t: number, blocksSeen: number): void {
  this.swim.uniforms.uTime.value = t;
  for (let i = 0; i < this.slots.length; i++) {
    const slot = this.slots[i];
    if (!slot.meta) continue;
    const seat = slot.seat;
    const angle = wanderedAngle(seat, t);
    const radius = wanderedRadius(seat, t);
    const y =
      bandDepth(blocksSeen - slot.bornBlock) + Math.sin(t * 0.8 + seat.bob) * BOB_AMPLITUDE;
    // Heading: the fish points +X; the circuit tangent at `angle` is
    // (-sin a, cos a) in XZ, and a Y-rotation by θ sends +X to (cos θ, -sin θ),
    // so θ = -(a + π/2) lines the nose up with the tangent.
    const heading = -(angle + Math.PI / 2);
    this.euler.set(0, heading, bankRoll(seat, t));
    this.quaternion.setFromEuler(this.euler);
    this.matrix.compose(
      this.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius),
      this.quaternion,
      this.scale.setScalar(slot.size)
    );
    this.mesh.setMatrixAt(i, this.matrix);
  }
  this.mesh.instanceMatrix.needsUpdate = true;
}
```

Update the class doc comment: body motion (tail beat, spine wave) is GPU-side via `applySwimShader`; the CPU owns only the path.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run web/test/lake-shoal.test.ts web/test/lake-geometry.test.ts`
Expected: PASS — including the pre-existing school-proximity test (wander is identical for schoolmates sharing a coin id, so relative distance is preserved).

- [ ] **Step 5: Commit**

```bash
git add web/src/themes/lake/shoal.ts web/test/lake-shoal.test.ts
git commit -m "feat(lake): fish get swept bodies, GPU undulation, wandering banked paths"
```

---

### Task 5: Turtles — carapace, paddling flippers, stroke-surge

**Files:**
- Modify: `web/src/themes/lake/turtles.ts`, `web/src/themes/lake/index.ts` (update call site), `web/test/lake-geometry.test.ts` (shellGeometry return type is now BufferGeometry — assertion already generic, no change needed unless it names SphereGeometry)
- Test: `web/test/lake-turtles.test.ts`

**Interfaces:**
- Consumes: `turtleStroke` (Task 2).
- Produces: `Turtles.update(dt: number, t: number, blocksSeen: number)` — **signature change** (needs `dt` to integrate the surging angle). `plant`/`clearAbove`/`pickables`/`metaFor` unchanged. `shellGeometry(): THREE.BufferGeometry` (was SphereGeometry). New export `flipperGeometry(length?: number): THREE.BufferGeometry`.

- [ ] **Step 1: Update/extend the tests** — in `web/test/lake-turtles.test.ts`, change the two `update` calls to the new signature and add stroke coverage:

```ts
// in "turtles sink with age":
turtles.update(0.016, 0, 0);
const fresh = (shell.parent as THREE.Object3D).position.y;
turtles.update(0.016, 0, 10);
expect((shell.parent as THREE.Object3D).position.y).toBeLessThan(fresh);
```

Append:

```ts
test("a turtle advances around its circuit by integrating surge", () => {
  const turtles = new Turtles(new THREE.Scene());
  turtles.plant(did("aa".repeat(32)), 0);
  const g = turtles.pickables()[0].parent as THREE.Object3D;
  turtles.update(0.016, 0, 0);
  const a = Math.atan2(g.position.z, g.position.x);
  for (let i = 1; i <= 600; i++) turtles.update(0.016, i * 0.016, 0);
  const b = Math.atan2(g.position.z, g.position.x);
  // ~10 s at a slow surging pace: it moved, and not by a full lap
  expect(Math.abs(b - a)).toBeGreaterThan(0.01);
});

test("flippers paddle as time advances", () => {
  const turtles = new Turtles(new THREE.Scene());
  turtles.plant(did("aa".repeat(32)), 0);
  const g = turtles.pickables()[0].parent as THREE.Object3D;
  // children: [shell, head, frontL, frontR, rearL, rearR]
  const flipper = g.children[2];
  turtles.update(0.016, 0.2, 0);
  const early = flipper.rotation.z;
  turtles.update(0.016, 1.4, 0);
  expect(flipper.rotation.z).not.toBeCloseTo(early, 3);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run web/test/lake-turtles.test.ts`
Expected: FAIL — update arity / flipper rotation static.

- [ ] **Step 3: Implement** in `web/src/themes/lake/turtles.ts`:

Geometry:

```ts
import { turtleStroke } from "./motion.js";

/** The carapace: a lathe profile — domed top with a ridge, flat rim below. */
export function shellGeometry(): THREE.BufferGeometry {
  const profile = [
    new THREE.Vector2(0.001, 0.3),
    new THREE.Vector2(0.2, 0.27),
    new THREE.Vector2(0.38, 0.18),
    new THREE.Vector2(0.5, 0.05),
    new THREE.Vector2(0.55, -0.03),
    new THREE.Vector2(0.44, -0.07),
    new THREE.Vector2(0.001, -0.07),
  ];
  const g = new THREE.LatheGeometry(profile, 18);
  g.scale(1, 1, 1.25); // oval in plan view: longer nose-to-tail
  return g;
}

/** A tapered flat paddle, origin at the shoulder so it sweeps from its root. */
export function flipperGeometry(length = 0.5): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(0.16, length, 6);
  g.rotateZ(-Math.PI / 2); // apex points +X (outward from the body)
  g.scale(1, 0.22, 0.7); // flatten into a blade
  g.translate(length / 2, 0, 0); // root at the origin
  return g;
}
```

Assembly (in the constructor pool loop; child order is part of the test contract — shell, head, frontL, frontR, rearL, rearR):

```ts
const shellGeo = shellGeometry();
const headGeo = new THREE.SphereGeometry(0.15, 10, 8);
const neckGeo = new THREE.CylinderGeometry(0.08, 0.11, 0.3, 8);
neckGeo.rotateX(Math.PI / 2); // along +Z, toward the head
const frontGeo = flipperGeometry(0.55);
const rearGeo = flipperGeometry(0.32);
```

```ts
const group = new THREE.Group();
const shell = new THREE.Mesh(shellGeo, material);
const head = new THREE.Mesh(headGeo, material);
head.position.set(0, 0.02, 0.85);
const neck = new THREE.Mesh(neckGeo, material);
neck.position.set(0, 0, 0.62);
const flippers: THREE.Mesh[] = [];
for (const [x, z] of [
  [-0.5, 0.3],
  [0.5, 0.3],
  [-0.42, -0.42],
  [0.42, -0.42],
] as const) {
  const mesh = new THREE.Mesh(z > 0 ? frontGeo : rearGeo, material);
  mesh.position.set(x, -0.02, z);
  // the blade points +X; yaw θ sends +X to (cos θ, -sin θ) in XZ, so these
  // angle each blade outward from its side and slightly forward (+Z)
  mesh.rotation.y = x < 0 ? Math.PI + 0.5 : -0.5;
  flippers.push(mesh);
}
group.add(shell, head, flippers[0], flippers[1], flippers[2], flippers[3], neck);
```

Slot state: replace the fixed `angle` with a mutable integrated one and keep the flipper refs:

```ts
interface Turtle {
  group: THREE.Group;
  shell: THREE.Mesh;
  flippers: THREE.Mesh[];
  meta: SproutEvent | null;
  bornBlock: number;
  radius: number;
  angle: number; // integrated per frame — surge speeds it up mid-stroke
  speed: number;
  bob: number;
}
```

Update — stroke drives flippers, surge, and pitch (rear flippers run in counter-phase):

```ts
update(dt: number, t: number, blocksSeen: number): void {
  for (const turtle of this.pool) {
    if (!turtle.meta) continue;
    const stroke = turtleStroke(t * 1.6 + turtle.bob);
    turtle.angle += turtle.speed * stroke.surge * dt;
    turtle.group.position.set(
      Math.cos(turtle.angle) * turtle.radius,
      bandDepth(blocksSeen - turtle.bornBlock) + Math.sin(t * 0.35 + turtle.bob) * 0.4,
      Math.sin(turtle.angle) * turtle.radius
    );
    // the head points +Z, so yaw by -angle lines it up with the tangent
    turtle.group.rotation.y = -turtle.angle;
    turtle.group.rotation.x = -stroke.pitch; // nose-up during the glide
    turtle.group.rotation.z = Math.sin(t * 1.1 + turtle.bob) * 0.06;
    const rear = turtleStroke(t * 1.6 + turtle.bob + Math.PI);
    for (let i = 0; i < turtle.flippers.length; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const s = i < 2 ? stroke : rear;
      turtle.flippers[i].rotation.z = side * (0.15 + s.sweep * 0.55);
    }
  }
}
```

`plant()` sets `turtle.angle = seat.angle` (the rest as today). Update the class doc comment: stroke-glide from `turtleStroke`, angle integrated (path phase depends on frame timing; the seat stays deterministic).

- [ ] **Step 4: Update the call site** — `web/src/themes/lake/index.ts` line 79:

```ts
turtles.update(dt, t, blocksSeen);
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run web/test/lake-turtles.test.ts web/test/lake-geometry.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/themes/lake/turtles.ts web/src/themes/lake/index.ts web/test/lake-turtles.test.ts
git commit -m "feat(lake): turtles get a carapace, paddling flippers and stroke-surge"
```

---

### Task 6: Jellyfish — bell contraction wave, ribbon tentacles, pulse-and-coast

**Files:**
- Modify: `web/src/themes/lake/jellies.ts`
- Test: `web/test/lake-jellies.test.ts` (existing tests keep passing; add one)

**Interfaces:**
- Consumes: `jellyPulse`, `PULSE_SKEW` (Task 2).
- Produces: `Jellies` public API unchanged. `bellGeometry()` return type widens to `THREE.SphereGeometry` (unchanged) with more segments. New export `tentacleGeometry(): THREE.BufferGeometry`.

- [ ] **Step 1: Add failing tests** — append to `web/test/lake-jellies.test.ts` (match the file's existing event helper; if it lacks one, mirror the `did`/`xch` helpers from the other lake tests with `kind: "nft"` and a `launcherId`):

```ts
import { tentacleGeometry } from "../src/themes/lake/jellies.js";

test("tentacles are segmented ribbons, not rigid boxes", () => {
  const g = tentacleGeometry();
  // a 1×8-segment plane has 18 vertices; a box has 24 — assert on segmentation
  const pos = g.getAttribute("position");
  expect(pos.count).toBeGreaterThanOrEqual(18);
  g.computeBoundingBox();
  expect(g.boundingBox!.max.y).toBeLessThanOrEqual(0.001); // hangs downward from its root
});

test("a jelly pulses vertically around its band depth", () => {
  const jellies = new Jellies(new THREE.Scene(), 2);
  jellies.plant(nft("aa".repeat(32)), 0);
  const camera = new THREE.PerspectiveCamera();
  const ys = new Set<number>();
  for (let t = 0; t < 8; t += 0.25) {
    jellies.update(camera, t, 0);
    ys.add(Math.round(jellies.pickables()[0].parent!.position.y * 100));
  }
  expect(ys.size).toBeGreaterThan(3);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run web/test/lake-jellies.test.ts`
Expected: FAIL — `tentacleGeometry` not exported.

- [ ] **Step 3: Implement** in `web/src/themes/lake/jellies.ts`:

Geometry:

```ts
import { jellyPulse, PULSE_SKEW } from "./motion.js";

/** The bell: a dome, open underneath, finely segmented so the rim can flare. */
export function bellGeometry(): THREE.SphereGeometry {
  return new THREE.SphereGeometry(0.95, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.6);
}

/** One tentacle: a segmented ribbon hanging from its root at the origin. */
export function tentacleGeometry(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(0.09, 1.5, 1, 8);
  g.translate(0, -0.75, 0);
  return g;
}
```

Pulse shader helper (module-private; per-jelly uniforms — each jelly already owns its own materials). The GLSL asymmetric wave **must mirror `jellyPulse`** — same `sin(p + PULSE_SKEW * sin(p))`:

```ts
const PULSE_FREQ = 2.2;

interface PulseUniforms {
  uTime: { value: number };
  uPhase: { value: number };
}

/** Shared preamble: the asymmetric medusa beat, mirroring motion.ts jellyPulse. */
const PULSE_GLSL = `
  float pulseP = uTime * ${PULSE_FREQ.toFixed(4)} + uPhase;
  float pulse = sin(pulseP + ${PULSE_SKEW.toFixed(4)} * sin(pulseP));`;

function applyPulseShader(
  material: THREE.Material,
  phase: number,
  displacement: string
): PulseUniforms {
  const uniforms: PulseUniforms = { uTime: { value: 0 }, uPhase: { value: phase } };
  material.onBeforeCompile = (s) => {
    s.uniforms.uTime = uniforms.uTime;
    s.uniforms.uPhase = uniforms.uPhase;
    s.vertexShader =
      "uniform float uTime;\nuniform float uPhase;\n" +
      s.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\n${PULSE_GLSL}\n${displacement}`
      );
  };
  return uniforms;
}
```

In the constructor pool loop (per jelly, using the pool index `idx` for a deterministic per-slot phase — change the `Array.from` callback to `(_, idx) => {...}`):

```ts
const phase = idx * 2.399; // golden-angle spacing keeps neighbours out of sync

const bellMat = new THREE.MeshStandardMaterial({
  color: LAKE.jelly,
  transparent: true,
  opacity: 0.42,
  roughness: 0.25,
  emissive: new THREE.Color(LAKE.jelly),
  emissiveIntensity: 0.35,
  side: THREE.DoubleSide,
  depthWrite: false,
});
// radial squeeze traveling apex→rim: zero at the apex (y≈0.95), full at the rim
const bellUniforms = applyPulseShader(
  bellMat,
  phase,
  `float rim = clamp(1.0 - position.y / 0.95, 0.0, 1.2);
   float squeeze = max(pulse, 0.0);
   transformed.x *= 1.0 - squeeze * 0.16 * rim;
   transformed.z *= 1.0 - squeeze * 0.16 * rim;
   transformed.y += squeeze * 0.10 * rim;`
);
const bell = new THREE.Mesh(bellGeo, bellMat);

const tentacleMat = new THREE.MeshStandardMaterial({
  color: LAKE.jelly,
  transparent: true,
  opacity: 0.3,
  depthWrite: false,
  side: THREE.DoubleSide, // ribbons are planes, visible from both sides
});
// whip follow-through: displacement grows with droop², lagging the bell by 1.1 rad
const tentacleUniforms = applyPulseShader(
  tentacleMat,
  phase,
  `float droop = clamp(-position.y / 1.5, 0.0, 1.0);
   float lagP = pulseP - 1.1 - droop * 1.6;
   float lag = sin(lagP + ${PULSE_SKEW.toFixed(4)} * sin(lagP));
   transformed.x += lag * droop * droop * 0.45;
   transformed.z += sin(uTime * 1.7 + uPhase - droop * 2.1) * droop * droop * 0.25;`
);
```

- Replace `tentacleGeo` (the translated box) with `tentacleGeometry()`; keep 5 tentacles ringed at radius 0.55, plus one at the center.
- `Jelly` interface gains `bellUniforms: PulseUniforms; tentacleUniforms: PulseUniforms; phase: number;` and **drops `bob`** (the per-slot `phase` replaces it everywhere; delete the `j.bob = seat.bob` assignment in `plant` and the field initializer).
- `update()` — pulse-and-coast replaces the sine bob, the CPU bell-scale pulse is **deleted** (the shader owns the bell now; leave `j.bell.scale` at 1):

```ts
update(camera: THREE.Camera, t: number, blocksSeen: number): void {
  for (const j of this.pool) {
    if (!j.meta) continue;
    j.bellUniforms.uTime.value = t;
    j.tentacleUniforms.uTime.value = t;
    const angle = j.angle + t * j.speed;
    const { lift } = jellyPulse(t * PULSE_FREQ + j.phase);
    j.group.position.set(
      Math.cos(angle) * j.radius,
      bandDepth(blocksSeen - j.bornBlock) + lift * 0.55,
      Math.sin(angle) * j.radius
    );
    j.group.lookAt(camera.position.x, j.group.position.y, camera.position.z);
  }
}
```

- Everything else in `plant` (dedupe, LoadPool, placeholder reset) is unchanged.
- Update the class doc comment: bell contraction and tentacle whip are GPU-side, synced to the CPU coast through the shared `jellyPulse` waveform.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run web/test/lake-jellies.test.ts`
Expected: PASS — including all pre-existing dedupe/media/reorg tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/themes/lake/jellies.ts web/test/lake-jellies.test.ts
git commit -m "feat(lake): jellyfish bell wave, ribbon tentacles, pulse-and-coast"
```

---

### Task 7: Predator — pike body, S-curve strike

**Files:**
- Modify: `web/src/themes/lake/vfx.ts`
- Test: `web/test/lake-vfx.test.ts` (existing tests keep passing; add one)

**Interfaces:**
- Consumes: `pikeGeometry`, `applySwimShader` (Task 3).
- Produces: `Vfx` public API unchanged (`strike(t)`, `update(dt, t)`, etc.).

- [ ] **Step 1: Add a failing test** — append to `web/test/lake-vfx.test.ts`:

```ts
test("the strike sweeps an S-curve from the centerline", () => {
  const vfx = new Vfx(new THREE.Scene());
  vfx.strike(0);
  const zs: number[] = [];
  for (let i = 0; i < 140; i++) {
    vfx.update(0.016, i * 0.016);
    zs.push(vfx.predatorZ());
  }
  // an S-curve enters on the centerline and swings to both sides;
  // the old path entered at z ≈ +5 (cos starts at 1)
  expect(Math.abs(zs[0])).toBeLessThan(1.5);
  expect(Math.min(...zs)).toBeLessThan(-2);
  expect(Math.max(...zs)).toBeGreaterThan(2);
});
```

`predatorZ` is a new test seam on `Vfx`, matching the file's existing seam convention (`bubbleCount`, `highestBubbleY`, `activeBeacons`):

```ts
/** The predator's lateral position. Test seam. */
predatorZ(): number {
  return this.predator.position.z;
}
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run web/test/lake-vfx.test.ts`
Expected: FAIL — `predatorZ` does not exist yet; and today's path enters at z = cos(0)·5 = +5, tripping the centerline assertion.

- [ ] **Step 3: Implement** in `web/src/themes/lake/vfx.ts`:

Constructor — replace the cone with the pike and attach the swim shader (non-instanced):

```ts
import { pikeGeometry, applySwimShader } from "./bodies.js";
```

```ts
// the predator: a pike silhouette that sweeps the column on a reorg
const predatorMat = new THREE.MeshStandardMaterial({
  color: LAKE.predator,
  roughness: 0.7,
  transparent: true,
  opacity: 0,
  side: THREE.DoubleSide, // the fins are single-sided blades
});
this.predatorSwim = applySwimShader(predatorMat, {
  instanced: false,
  amp: 0.5,
  freq: 5.0,
  waveLen: 1.1,
  nose: 2.8,
  span: 5.2,
});
this.predator = new THREE.Mesh(pikeGeometry(), predatorMat);
```

(field: `private readonly predatorSwim: { uniforms: { uTime: { value: number } } };`)

`update()` — feed the shader clock and replace the strike path with an S-curve whose heading follows the path tangent and banks into the turns:

```ts
this.predatorSwim.uniforms.uTime.value = t;

if (this.strikeStart >= 0) {
  const age = t - this.strikeStart;
  const progress = age / STRIKE_SECONDS;
  if (progress >= 1) {
    this.predator.visible = false;
    this.strikeStart = -1;
  } else {
    // an S-curve across the column: one full sine period in z while x sweeps
    const span = BAND_RADIUS_MAX + 22;
    const zAmp = 9;
    this.predator.position.set(
      -span + progress * span * 2,
      TOP_BAND_Y - 6 + Math.sin(progress * Math.PI) * 3,
      Math.sin(progress * Math.PI * 2) * zAmp
    );
    // heading = path tangent; the body points +X, and a yaw θ sends +X to
    // (cos θ, -sin θ), so θ = -atan2(dz, dx) along the parametric velocity
    const dx = span * 2;
    const dz = Math.cos(progress * Math.PI * 2) * Math.PI * 2 * zAmp;
    const heading = -Math.atan2(dz, dx);
    this.predator.rotation.y = heading;
    this.predator.rotation.z = heading * 0.5; // bank into the curve
    (this.predator.material as THREE.MeshStandardMaterial).opacity =
      Math.sin(progress * Math.PI) * 0.9;
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run web/test/lake-vfx.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/themes/lake/vfx.ts web/test/lake-vfx.test.ts
git commit -m "feat(lake): predator becomes an undulating pike on an S-curve strike"
```

---

### Task 8: Smooth sinking — ease the block counter in `lake.ts`

**Files:**
- Modify: `web/src/themes/lake/lake.ts`

**Interfaces:**
- Consumes: `easeBlocks` (Task 1).
- Produces: `extraUpdate` (and therefore every system's `update`) receives the **smoothed float** counter; sprout handlers still receive the integer `blocksSeen` for `bornBlock`. No signature changes.

- [ ] **Step 1: Implement** in `web/src/themes/lake/lake.ts`:

```ts
import { BED_Y, TOP_BAND_Y, easeBlocks } from "./layout.js";
```

Below the `blocksSeen` declaration:

```ts
// Smoothed copy of the counter handed to per-frame updates: the lake glides
// down a band over ~1.6 s per block instead of snapping 1.5 units. Planting
// still uses the integer counter, so bornBlock stays exact.
let blocksSmooth = 0;
```

In `frame()`, before `extraUpdate`:

```ts
blocksSmooth = easeBlocks(blocksSmooth, blocksSeen, dt);
extraUpdate(dt, t, blocksSmooth);
```

Also update the comment above `let blocksSeen = 0;` to mention the smoothed copy.

- [ ] **Step 2: Verify** (lake.ts has no direct unit tests — it needs a DOM; the gate is types + the full suite)

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add web/src/themes/lake/lake.ts
git commit -m "feat(lake): sinking glides — smoothed block counter drives band depth"
```

---

### Task 9: Docs, full gate, visual check

**Files:**
- Modify: `web/CLAUDE.md` (lake section), `docs/superpowers/specs/2026-08-12-lake-animation-overhaul-design.md` (status line)

- [ ] **Step 1: Update `web/CLAUDE.md`** — in the lake section, amend the last paragraph to record the new architecture (keep it tight, e.g.):

> Creature bodies are procedural swept geometry (`bodies.ts`); all body animation (fish/pike spine undulation, jelly bell contraction and tentacle whip) runs in vertex shaders via `onBeforeCompile`, phased per instance from the instance matrix so big fish beat slower. Path motion (wander, banking, turtle stroke-surge, jelly pulse-and-coast) is pure math in `motion.ts`. `lake.ts` eases a float block counter (`easeBlocks`) so sinking glides instead of snapping a band per block.

Also update the `shoal.ts` sentence if it still describes the 9-triangle dart.

- [ ] **Step 2: Mark the spec** — change its `**Status:**` line to `Implemented`.

- [ ] **Step 3: Full gate**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all PASS. Fix anything that surfaces before committing.

- [ ] **Step 4: Visual smoke test** — `npm run dev:web`, open `http://localhost:5173/?demo=1&theme=lake`, confirm: fish undulate and wander with banking; whale-size fish beat visibly slower; turtles paddle with surge-glide; jellies pulse with tentacle follow-through; a reorg (if demo triggers one) shows the pike S-curve; the lake glides down on each block. No console errors.

- [ ] **Step 5: Commit**

```bash
git add web/CLAUDE.md docs/superpowers/specs/2026-08-12-lake-animation-overhaul-design.md
git commit -m "docs: record the lake animation architecture"
```
