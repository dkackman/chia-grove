# Lake Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sixth visualization, `lake`, that renders the Chia chain as a submerged lake where blocks are depth strata, XCH/CAT spends are fish, NFT mints are jellyfish carrying their art, and DIDs are turtles.

**Architecture:** A self-contained `web/src/themes/lake/` folder implementing the existing `Visualization` interface, structured the way `themes/mine/` is: a `lake.ts` runtime owning renderer/camera/feed-dispatch and exposing setter hooks, and an `index.ts` declaring the theme and wiring systems to those hooks. Depth is the history axis — every planted object stores the global block counter at plant time and its Y is recomputed each frame as `bandDepth(blocksSeen - bornBlock)`.

**Tech Stack:** TypeScript, Three.js, Vite, vitest. No new dependencies. No server or `@grove/shared` changes.

## Global Constraints

- Node ≥ 24. npm workspaces monorepo; all commands run from the repo root.
- No new npm dependencies. No changes to `shared/`, `server/`, or `PROTOCOL_VERSION` (currently 5).
- Theme id is exactly `lake`; label is exactly `lake`.
- All new source files live under `web/src/themes/lake/`; all new tests under `web/test/` named `lake-*.test.ts`.
- Import style: relative paths with explicit `.js` extensions (e.g. `../shared/util.js`), matching every existing theme file.
- `npm run typecheck`, `npm run lint`, and `npm test` must pass at the end of every task.
- Run `npm run format` before each commit; the repo uses Prettier 3 and CI checks formatting.
- Do not use `InstancedKind` anywhere in this theme. See the spec's "Reuse boundary" section for why.
- Test scene-graph classes against a real `new THREE.Scene()` in Node (no renderer, no DOM), the way `web/test/mine-structures.test.ts` does.

**Reference spec:** `docs/superpowers/specs/2026-08-12-lake-theme-design.md`

---

### Task 1: Pure layout — depth bands and swim circuits

**Files:**

- Create: `web/src/themes/lake/layout.ts`
- Test: `web/test/lake-layout.test.ts`

**Interfaces:**

- Consumes: `mulberry32` from `web/src/themes/shared/util.ts` (signature: `mulberry32(seed: number): () => number`).
- Produces: `MAX_BANDS`, `BAND_STEP`, `TOP_BAND_Y`, `BED_Y`, `BAND_RADIUS_MIN`, `BAND_RADIUS_MAX`, `bandDepth(age: number): number`, `interface Seat { radius: number; angle: number; bob: number; speed: number }`, `seatOffset(coinIdHex: string): Seat`.

- [ ] **Step 1: Write the failing test**

Create `web/test/lake-layout.test.ts`:

```ts
import { expect, test } from "vitest";
import {
  MAX_BANDS,
  BAND_STEP,
  TOP_BAND_Y,
  BED_Y,
  BAND_RADIUS_MIN,
  BAND_RADIUS_MAX,
  bandDepth,
  seatOffset,
} from "../src/themes/lake/layout.js";

test("the newest band sits at the top of the column", () => {
  expect(bandDepth(0)).toBeCloseTo(TOP_BAND_Y, 5);
});

test("each older band sits one step deeper", () => {
  expect(bandDepth(1)).toBeCloseTo(TOP_BAND_Y - BAND_STEP, 5);
  expect(bandDepth(5)).toBeCloseTo(TOP_BAND_Y - 5 * BAND_STEP, 5);
});

test("bands sink monotonically as they age", () => {
  for (let age = 1; age < MAX_BANDS; age++) {
    expect(bandDepth(age)).toBeLessThan(bandDepth(age - 1));
  }
});

test("sinking clamps at the bed so old bands pile up instead of falling forever", () => {
  expect(bandDepth(MAX_BANDS)).toBeCloseTo(BED_Y, 5);
  expect(bandDepth(MAX_BANDS + 500)).toBeCloseTo(BED_Y, 5);
});

test("a negative age (clock skew, replay) never floats above the top band", () => {
  expect(bandDepth(-3)).toBeCloseTo(TOP_BAND_Y, 5);
});

test("the whole column fits in a viewable depth", () => {
  // 40 bands at 1.5 units is a 60-unit descent — framable from mid-column.
  expect(TOP_BAND_Y - BED_Y).toBeLessThanOrEqual(70);
});

test("a coin always gets the same swim circuit", () => {
  const id = "a1b2c3d4" + "00".repeat(28);
  expect(seatOffset(id)).toEqual(seatOffset(id));
});

test("different coins get different circuits", () => {
  const a = seatOffset("a1b2c3d4" + "00".repeat(28));
  const b = seatOffset("99887766" + "00".repeat(28));
  expect(a.angle).not.toBeCloseTo(b.angle, 5);
});

test("circuits stay inside the band's radius range and move at a sane speed", () => {
  for (let i = 0; i < 200; i++) {
    const seat = seatOffset(i.toString(16).padStart(8, "0") + "00".repeat(28));
    expect(seat.radius).toBeGreaterThanOrEqual(BAND_RADIUS_MIN);
    expect(seat.radius).toBeLessThanOrEqual(BAND_RADIUS_MAX);
    expect(seat.angle).toBeGreaterThanOrEqual(0);
    expect(seat.angle).toBeLessThan(Math.PI * 2);
    expect(seat.speed).toBeGreaterThan(0);
    expect(seat.speed).toBeLessThan(0.2);
  }
});

test("a malformed coin id still yields a usable circuit", () => {
  const seat = seatOffset("");
  expect(Number.isFinite(seat.radius)).toBe(true);
  expect(Number.isFinite(seat.angle)).toBe(true);
  expect(Number.isFinite(seat.speed)).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run web/test/lake-layout.test.ts`
Expected: FAIL — cannot resolve `../src/themes/lake/layout.js`.

- [ ] **Step 3: Write the implementation**

Create `web/src/themes/lake/layout.ts`:

```ts
import { mulberry32 } from "../shared/util.js";

/**
 * Depth strata. One band per block: the newest sits just under the surface and
 * every older band is one step deeper, so history reads as depth.
 *
 * MAX_BANDS is 40 rather than the 200 block slots `mine` uses because this is a
 * clamp depth, not a slot ring — it has to be a column a submerged camera can
 * actually frame. At 1.5 units a band, 40 bands is a 60-unit descent (~12
 * minutes of chain at 18.75 s blocks); 200 would be a 300-unit shaft with most
 * of its history out of sight.
 */
export const MAX_BANDS = 40;
export const BAND_STEP = 1.5;
export const TOP_BAND_Y = -3;
export const BED_Y = TOP_BAND_Y - MAX_BANDS * BAND_STEP;

export const BAND_RADIUS_MIN = 6;
export const BAND_RADIUS_MAX = 26;

/**
 * Y of a band `age` blocks old, clamped at both ends. Objects older than
 * MAX_BANDS keep rendering at the bed until their pool slot is recycled.
 */
export function bandDepth(age: number): number {
  const clamped = Math.max(0, Math.min(MAX_BANDS, age));
  return TOP_BAND_Y - clamped * BAND_STEP;
}

/** A spend's swim circuit within its band: where it loops and how fast. */
export interface Seat {
  radius: number;
  angle: number;
  bob: number;
  speed: number;
}

/**
 * Deterministic circuit derived from the coin id, the same way
 * `grove/layout.ts` derives its scatter. Determinism matters because the
 * WebSocket snapshot replays on every theme switch and reconnect — a seeded
 * seat rebuilds the same lake instead of reshuffling it.
 *
 * sqrt on the radius draw spreads fish evenly over the annulus rather than
 * bunching them at the inner edge.
 */
export function seatOffset(coinIdHex: string): Seat {
  const rand = mulberry32(parseInt(coinIdHex.slice(0, 8), 16));
  return {
    radius: BAND_RADIUS_MIN + Math.sqrt(rand()) * (BAND_RADIUS_MAX - BAND_RADIUS_MIN),
    angle: rand() * Math.PI * 2,
    bob: rand() * Math.PI * 2,
    speed: 0.05 + rand() * 0.09,
  };
}
```

Note: `parseInt("", 16)` is `NaN`, and `mulberry32` coerces its seed with `>>> 0`, so `NaN` becomes seed 0 — a malformed id still produces finite, deterministic output. That is what the last test pins.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run web/test/lake-layout.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Format, typecheck, lint, commit**

```bash
npm run format
npm run typecheck
npm run lint
git add web/src/themes/lake/layout.ts web/test/lake-layout.test.ts
git commit -m "feat(lake): depth band layout and deterministic swim circuits"
```

---

### Task 2: Pure scales — amount and netspace mappings

**Files:**

- Create: `web/src/themes/lake/scales.ts`
- Test: `web/test/lake-scales.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `fishSize(amount: string): number`, `schoolSize(amount: string): number`, `clarityFromNetspace(bytes: string): number`.

Amounts arrive as decimal strings of mojos on `SproutEvent.amount`; netspace arrives as a decimal string of bytes on `AmbientEvent.netspace`. All three functions must survive `""`, `"0"`, and non-numeric input, because a malformed field must never produce a `NaN` matrix (which makes an instance vanish silently).

- [ ] **Step 1: Write the failing test**

Create `web/test/lake-scales.test.ts`:

```ts
import { expect, test } from "vitest";
import { fishSize, schoolSize, clarityFromNetspace } from "../src/themes/lake/scales.js";

const XCH = (n: number) => String(n * 1e12); // 1 XCH = 1e12 mojos

test("fish grow with the amount spent", () => {
  expect(fishSize(XCH(1000))).toBeGreaterThan(fishSize(XCH(1)));
  expect(fishSize(XCH(1))).toBeGreaterThan(fishSize("1"));
});

test("fish size is bounded at both ends so nothing fills the screen or vanishes", () => {
  for (const amount of ["1", XCH(0.001), XCH(1), XCH(1e6), XCH(1e12)]) {
    expect(fishSize(amount)).toBeGreaterThanOrEqual(0.45);
    expect(fishSize(amount)).toBeLessThanOrEqual(2.6);
  }
});

test("a whale spend is visibly bigger than a typical one", () => {
  expect(fishSize(XCH(1e6))).toBeGreaterThan(fishSize(XCH(1)) * 2);
});

test("fish size survives malformed amounts", () => {
  for (const amount of ["", "0", "-5", "not-a-number"]) {
    expect(Number.isFinite(fishSize(amount))).toBe(true);
    expect(fishSize(amount)).toBe(0.45);
  }
});

test("school size is a positive integer that grows with the amount", () => {
  const small = schoolSize("1000"); // 1 token
  const large = schoolSize("1000000000"); // 1e6 tokens
  expect(Number.isInteger(small)).toBe(true);
  expect(small).toBeGreaterThanOrEqual(1);
  expect(large).toBeGreaterThan(small);
  expect(large).toBeLessThanOrEqual(5);
});

test("school size survives malformed amounts", () => {
  for (const amount of ["", "0", "-5", "not-a-number"]) {
    expect(schoolSize(amount)).toBe(1);
  }
});

test("clarity rises with netspace and stays in 0..1", () => {
  const eib = (n: number) => String(Math.round(n * 1.152921504606847e18));
  expect(clarityFromNetspace(eib(30))).toBeGreaterThan(clarityFromNetspace(eib(5)));
  for (const n of [0.001, 1, 25, 1000]) {
    expect(clarityFromNetspace(eib(n))).toBeGreaterThanOrEqual(0);
    expect(clarityFromNetspace(eib(n))).toBeLessThanOrEqual(1);
  }
});

test("clarity falls back to mid-range on malformed netspace", () => {
  for (const bytes of ["", "0", "not-a-number"]) {
    expect(clarityFromNetspace(bytes)).toBe(0.5);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run web/test/lake-scales.test.ts`
Expected: FAIL — cannot resolve `../src/themes/lake/scales.js`.

- [ ] **Step 3: Write the implementation**

Create `web/src/themes/lake/scales.ts`:

```ts
const MIN_FISH = 0.45;
const MAX_FISH = 2.6;
const EIB = 1.152921504606847e18;

/**
 * XCH amount (mojos) → fish length. Log scale, so dust is a minnow and a whale
 * spend is literally a whale — the payoff no other theme gives large amounts.
 * Clamped at both ends: a zero-length fish is invisible and an unbounded one
 * swallows the camera.
 */
export function fishSize(amount: string): number {
  const mojos = Number(amount);
  if (!Number.isFinite(mojos) || mojos <= 0) return MIN_FISH;
  return Math.min(MAX_FISH, MIN_FISH + 0.42 * Math.log10(1 + mojos / 1e9));
}

/**
 * CAT amount → how many fish swim in this spend's school (1..5). CATs carry 3
 * decimals (1 token = 1000 mojos), and per-token value varies wildly across
 * assets, so this conveys only relative magnitude — same caveat as `catWidth`
 * in `themes/shared/scales.ts`.
 */
export function schoolSize(amount: string): number {
  const tokens = Number(amount) / 1000;
  if (!Number.isFinite(tokens) || tokens <= 0) return 1;
  return Math.min(5, 1 + Math.floor(Math.log10(1 + tokens)));
}

/**
 * Netspace (bytes) → water clarity in 0..1, driving fog density and light-shaft
 * strength. This is the lake's version of the lever grove uses for moonlight and
 * farm for sun brightness. Divisor 1.7 puts today's ~25 EiB netspace near 0.83,
 * so the usual view is clear water and a shrinking chain visibly murks it up.
 */
export function clarityFromNetspace(bytes: string): number {
  const eib = Number(bytes) / EIB;
  if (!Number.isFinite(eib) || eib <= 0) return 0.5;
  return Math.max(0, Math.min(1, Math.log10(1 + eib) / 1.7));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run web/test/lake-scales.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Format, typecheck, lint, commit**

```bash
npm run format
npm run typecheck
npm run lint
git add web/src/themes/lake/scales.ts web/test/lake-scales.test.ts
git commit -m "feat(lake): amount and netspace scale mappings"
```

---

### Task 3: Palette and water surface

**Files:**

- Create: `web/src/themes/lake/palette.ts`
- Create: `web/src/themes/lake/water.ts`
- Test: `web/test/lake-geometry.test.ts`

**Interfaces:**

- Consumes: `clarityFromNetspace` from Task 2; `LAKE` from `palette.ts`.
- Produces: `LAKE` (color record), `SURFACE_Y`, `surfaceGeometry(): THREE.PlaneGeometry`, `interface LakeWater { update(t: number): void; setNetspace(bytes: string): void; ripple(t: number): void }`, `createLakeWater(scene: THREE.Scene): LakeWater`.

`createLakeWater` owns the scene's `FogExp2` and the sunlight above the surface, because both are driven by the same clarity value.

- [ ] **Step 1: Write the failing test**

Create `web/test/lake-geometry.test.ts`:

```ts
import * as THREE from "three";
import { expect, test } from "vitest";
import { surfaceGeometry, createLakeWater } from "../src/themes/lake/water.js";

test("surface geometry is a valid renderable plane", () => {
  const g = surfaceGeometry();
  expect(g).toBeInstanceOf(THREE.BufferGeometry);
  expect(g.getAttribute("position").count).toBeGreaterThan(0);
});

test("water installs depth fog on the scene", () => {
  const scene = new THREE.Scene();
  createLakeWater(scene);
  expect(scene.fog).toBeInstanceOf(THREE.FogExp2);
});

test("clearer water (more netspace) thins the fog", () => {
  const scene = new THREE.Scene();
  const water = createLakeWater(scene);
  const eib = (n: number) => String(Math.round(n * 1.152921504606847e18));

  water.setNetspace(eib(30));
  const clear = (scene.fog as THREE.FogExp2).density;
  water.setNetspace(eib(0.5));
  const murky = (scene.fog as THREE.FogExp2).density;

  expect(murky).toBeGreaterThan(clear);
});

test("update and ripple run without a renderer present", () => {
  const scene = new THREE.Scene();
  const water = createLakeWater(scene);
  expect(() => {
    water.update(1.5);
    water.ripple(1.5);
    water.update(2.0);
  }).not.toThrow();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run web/test/lake-geometry.test.ts`
Expected: FAIL — cannot resolve `../src/themes/lake/water.js`.

- [ ] **Step 3: Write the palette**

Create `web/src/themes/lake/palette.ts`:

```ts
/** Scene colors for the lake. Cool, desaturated, with warm light from above. */
export const LAKE = {
  deep: 0x04141f, // fog and the unlit far water
  surface: 0x2f86ad, // underside of the surface plane
  shaft: 0xa8e0f5, // god rays
  bed: 0x2b3a2a, // silty floor
  weed: 0x2f6b3f,
  xchFish: 0xd8e9a8, // pale green-gold — reads against blue at any depth
  jelly: 0xc9a6e8,
  turtle: 0x5d7a4a,
  bubble: 0xbfe8ff,
  predator: 0x0a1c26,
} as const;
```

- [ ] **Step 4: Write the water**

Create `web/src/themes/lake/water.ts`:

```ts
import * as THREE from "three";
import { LAKE } from "./palette.js";
import { clarityFromNetspace } from "./scales.js";

/** The waterline. The camera and every band live below this. */
export const SURFACE_Y = 0;

const SHAFT_COUNT = 7;

/**
 * The surface plane, rotated to face DOWN — this theme only ever views it from
 * underneath, so the winding is flipped relative to `mine/water.ts`.
 */
export function surfaceGeometry(): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(400, 400, 64, 64);
  g.rotateX(Math.PI / 2);
  return g;
}

export interface LakeWater {
  update(t: number): void;
  setNetspace(bytes: string): void;
  /** A new block — send a ripple ring out across the surface. */
  ripple(t: number): void;
}

/**
 * The surface seen from below, the sunlight coming through it, and the depth fog
 * that hides the far water. Netspace drives clarity, which sets fog density,
 * shaft opacity and light intensity together — one lever, the way grove scales
 * moonlight and farm scales the sun.
 *
 * The surface wave and the block ripple both live in the vertex shader (via
 * onBeforeCompile, the technique `mine/water.ts` uses) so they cost nothing on
 * the CPU regardless of how finely the plane is subdivided.
 */
export function createLakeWater(scene: THREE.Scene): LakeWater {
  const fog = new THREE.FogExp2(LAKE.deep, 0.02);
  scene.fog = fog;

  const material = new THREE.MeshStandardMaterial({
    color: LAKE.surface,
    transparent: true,
    opacity: 0.85,
    roughness: 0.15,
    metalness: 0.2,
    side: THREE.DoubleSide,
    fog: true,
  });

  let shader: { uniforms: Record<string, { value: number }> } | null = null;
  material.onBeforeCompile = (s) => {
    s.uniforms.uTime = { value: 0 };
    // -1e9 parks the ripple far in the past so none is showing at startup.
    s.uniforms.uRippleStart = { value: -1e9 };
    s.vertexShader =
      "uniform float uTime;\nuniform float uRippleStart;\n" +
      s.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        transformed.y += sin(position.x * 0.18 + uTime * 0.9) * 0.22
                       + cos(position.z * 0.15 + uTime * 0.7) * 0.22;
        float age = uTime - uRippleStart;
        if (age > 0.0 && age < 4.0) {
          float d = length(position.xz);
          // a ring travelling outward at 26 units/s, fading as it goes
          float ring = exp(-pow(d - age * 26.0, 2.0) * 0.004);
          transformed.y += ring * 0.9 * (1.0 - age / 4.0);
        }`
      );
    shader = s as unknown as typeof shader;
  };

  const mesh = new THREE.Mesh(surfaceGeometry(), material);
  mesh.position.y = SURFACE_Y;
  scene.add(mesh);

  // Sunlight punching down through the surface.
  const sun = new THREE.DirectionalLight(0xfff0d0, 1.1);
  sun.position.set(18, 60, 10);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x9fd8f0, 0x14202a, 0.5));

  // God rays: wide, near-invisible additive cones hanging from the surface.
  // fog:false keeps them from being eaten by their own depth fog.
  const shaftGeo = new THREE.ConeGeometry(3.4, 70, 6, 1, true);
  shaftGeo.translate(0, -35, 0);
  const shafts: THREE.Mesh[] = [];
  for (let i = 0; i < SHAFT_COUNT; i++) {
    const angle = (i / SHAFT_COUNT) * Math.PI * 2;
    const radius = 10 + (i % 3) * 9;
    const shaft = new THREE.Mesh(
      shaftGeo,
      new THREE.MeshBasicMaterial({
        color: LAKE.shaft,
        transparent: true,
        opacity: 0.05,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
      })
    );
    shaft.position.set(Math.cos(angle) * radius, SURFACE_Y, Math.sin(angle) * radius);
    shaft.rotation.z = (i % 2 ? 1 : -1) * 0.06;
    scene.add(shaft);
    shafts.push(shaft);
  }

  let clarity = 0.5;

  return {
    update(t) {
      if (shader) shader.uniforms.uTime.value = t;
      for (let i = 0; i < shafts.length; i++) {
        const mat = shafts[i].material as THREE.MeshBasicMaterial;
        // slow independent breathing so the rays never pulse in lockstep
        mat.opacity = (0.03 + clarity * 0.06) * (0.7 + 0.3 * Math.sin(t * 0.25 + i));
      }
    },
    setNetspace(bytes) {
      clarity = clarityFromNetspace(bytes);
      // clear water → thin fog you can see across; murky → close horizon
      fog.density = 0.035 - clarity * 0.023;
      sun.intensity = 0.6 + clarity * 0.9;
    },
    ripple(t) {
      if (shader) shader.uniforms.uRippleStart.value = t;
    },
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run web/test/lake-geometry.test.ts`
Expected: PASS (4 tests).

Note: `onBeforeCompile` never fires without a renderer, so `shader` stays `null` in tests — every use of it is null-guarded, which the "runs without a renderer" test pins.

- [ ] **Step 6: Format, typecheck, lint, commit**

```bash
npm run format
npm run typecheck
npm run lint
git add web/src/themes/lake/palette.ts web/src/themes/lake/water.ts web/test/lake-geometry.test.ts
git commit -m "feat(lake): palette, surface shader, depth fog and god rays"
```

---

### Task 4: Lake bed and weeds

**Files:**

- Create: `web/src/themes/lake/bed.ts`
- Modify: `web/test/lake-geometry.test.ts` (append)

**Interfaces:**

- Consumes: `BED_Y` from `layout.ts`; `LAKE` from `palette.ts`; `mulberry32` from `../shared/util.js`.
- Produces: `weedGeometry(): THREE.BufferGeometry`, `interface Bed { update(t: number): void }`, `createBed(scene: THREE.Scene): Bed`.

Weeds are scenery, not events. Their matrices are written once at construction and never touched again; sway happens in the vertex shader. That is why they do not use `InstancedKind` — see the spec's "Reuse boundary".

- [ ] **Step 1: Write the failing test**

Append to `web/test/lake-geometry.test.ts`:

```ts
import { weedGeometry, createBed } from "../src/themes/lake/bed.js";
import { BED_Y } from "../src/themes/lake/layout.js";

test("weed geometry is a valid renderable blade", () => {
  const g = weedGeometry();
  expect(g).toBeInstanceOf(THREE.BufferGeometry);
  expect(g.getAttribute("position").count).toBeGreaterThan(0);
});

test("the bed adds a floor and a weed field at the bottom of the column", () => {
  const scene = new THREE.Scene();
  createBed(scene);
  const instanced = scene.children.find((c) => (c as THREE.InstancedMesh).isInstancedMesh);
  expect(instanced).toBeDefined();
  // every weed is planted, not left as a dead scale-0 slot
  expect((instanced as THREE.InstancedMesh).count).toBeGreaterThan(0);
  const floor = scene.children.find((c) => (c as THREE.Mesh).isMesh && c !== instanced);
  expect(floor).toBeDefined();
  expect((floor as THREE.Mesh).position.y).toBeCloseTo(BED_Y, 5);
});

test("bed update runs without a renderer present", () => {
  const bed = createBed(new THREE.Scene());
  expect(() => bed.update(3.0)).not.toThrow();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run web/test/lake-geometry.test.ts`
Expected: FAIL — cannot resolve `../src/themes/lake/bed.js`.

- [ ] **Step 3: Write the implementation**

Create `web/src/themes/lake/bed.ts`:

```ts
import * as THREE from "three";
import { mulberry32 } from "../shared/util.js";
import { BED_Y, BAND_RADIUS_MAX } from "./layout.js";
import { LAKE } from "./palette.js";

const WEED_COUNT = 700;
const FLOOR_RADIUS = 90;

/** One weed blade: a tall thin quad, origin at its base so it sways from root. */
export function weedGeometry(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(0.16, 2.4, 1, 4);
  g.translate(0, 1.2, 0);
  return g;
}

export interface Bed {
  update(t: number): void;
}

/**
 * The lake floor and its weed field. Both are static: the weed matrices are
 * written once here and never rewritten, and the sway is a vertex-shader
 * displacement scaled by height so the blades bend from their roots. The whole
 * bed therefore costs one uniform write per frame no matter how many blades.
 */
export function createBed(scene: THREE.Scene): Bed {
  const floorGeo = new THREE.CircleGeometry(FLOOR_RADIUS, 48);
  floorGeo.rotateX(-Math.PI / 2);
  const floor = new THREE.Mesh(
    floorGeo,
    new THREE.MeshStandardMaterial({ color: LAKE.bed, roughness: 1 })
  );
  floor.position.y = BED_Y;
  scene.add(floor);

  const material = new THREE.MeshStandardMaterial({
    color: LAKE.weed,
    roughness: 0.9,
    side: THREE.DoubleSide,
  });

  let shader: { uniforms: Record<string, { value: number }> } | null = null;
  material.onBeforeCompile = (s) => {
    s.uniforms.uTime = { value: 0 };
    s.vertexShader =
      "uniform float uTime;\n" +
      s.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        // instanceMatrix's translation column gives each blade a stable phase,
        // so neighbours lean together in a travelling wave instead of in unison
        float phase = instanceMatrix[3][0] * 0.28 + instanceMatrix[3][2] * 0.21;
        float lean = sin(uTime * 0.7 + phase) * 0.9 + sin(uTime * 1.3 + phase * 1.7) * 0.3;
        transformed.x += lean * transformed.y * 0.09;
        transformed.z += lean * transformed.y * 0.05;`
      );
    shader = s as unknown as typeof shader;
  };

  const weeds = new THREE.InstancedMesh(weedGeometry(), material, WEED_COUNT);
  const rand = mulberry32(0x1a2b3c4d);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler();
  for (let i = 0; i < WEED_COUNT; i++) {
    // sqrt keeps the scatter even across the disc instead of crowding the middle
    const radius = Math.sqrt(rand()) * (BAND_RADIUS_MAX + 14);
    const angle = rand() * Math.PI * 2;
    const height = 0.6 + rand() * 1.6;
    euler.set(0, rand() * Math.PI * 2, 0);
    quaternion.setFromEuler(euler);
    matrix.compose(
      position.set(Math.cos(angle) * radius, BED_Y, Math.sin(angle) * radius),
      quaternion,
      scale.set(1, height, 1)
    );
    weeds.setMatrixAt(i, matrix);
  }
  weeds.instanceMatrix.needsUpdate = true;
  // static geometry, so pin the bounds rather than letting a raycast cache a
  // stale sphere (the same trap InstancedKind documents)
  weeds.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, BED_Y, 0), BAND_RADIUS_MAX + 18);
  scene.add(weeds);

  return {
    update(t) {
      if (shader) shader.uniforms.uTime.value = t;
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run web/test/lake-geometry.test.ts`
Expected: PASS (7 tests — 4 from Task 3, 3 new).

- [ ] **Step 5: Format, typecheck, lint, commit**

```bash
npm run format
npm run typecheck
npm run lint
git add web/src/themes/lake/bed.ts web/test/lake-geometry.test.ts
git commit -m "feat(lake): lake bed floor and shader-swayed weed field"
```

---

### Task 5: Runtime, theme registration, and legend — first runnable milestone

**Files:**

- Create: `web/src/themes/lake/lake.ts`
- Create: `web/src/themes/lake/index.ts`
- Modify: `web/src/themes/index.ts`
- Modify: `web/src/style.css`
- Modify: `web/test/themes.test.ts` (append)

**Interfaces:**

- Consumes: `createLakeWater`/`SURFACE_Y` (Task 3), `createBed` (Task 4), `bandDepth`/`TOP_BAND_Y`/`BED_Y` (Task 1); `createOrbitControl` from `../shared/orbit.js`, `createPostFx` from `../shared/postfx.js`, `createFrameLimiter` from `../shared/frame-limiter.js`; `Visualization` from `../types.js`; `GroveFeed` from `../../net/feed.js`.
- Produces: `startLake(canvas: HTMLCanvasElement, feed: GroveFeed): LakeRuntime` with `setSproutHandler((event: SproutEvent, blocksSeen: number) => void)`, `setBlockHandler((blocksSeen: number) => void)`, `setReorgHandler((forkHeight: number) => void)`, `setAmbientHandler((mempoolSize: number) => void)`, `setContentFlagHandler((launcherId: string) => void)`, `setUpdateHandler((dt: number, t: number, blocksSeen: number) => void)`, `isDragging()`, plus `renderer`, `camera`, `scene`, `reducedMotion`; and the `lake` `Visualization`.

`blocksSeen` is the monotonic block counter every later system uses as `bornBlock`. It is passed to handlers rather than read from a shared mutable, so systems never disagree about the current block.

After this task the theme is selectable and renders an empty lake — surface, shafts, fog, bed, weeds — at `http://localhost:5173/?theme=lake&demo=1`.

- [ ] **Step 1: Write the failing test**

Append to `web/test/themes.test.ts`:

```ts
test("lake theme is registered and resolvable", () => {
  expect(THEMES.map((t) => t.id)).toContain("lake");
  expect(resolveTheme("?theme=lake", null).id).toBe("lake");
  expect(resolveTheme("", "lake").id).toBe("lake");
  expect(THEMES.find((t) => t.id === "lake")!.label).toBe("lake");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run web/test/themes.test.ts`
Expected: FAIL — `expect(received).toContain("lake")`, because `THEMES` has five entries.

- [ ] **Step 3: Write the runtime**

Create `web/src/themes/lake/lake.ts`:

```ts
import * as THREE from "three";
import type { GroveEvent, SproutEvent } from "@grove/shared";
import type { GroveFeed } from "../../net/feed.js";
import { createFrameLimiter } from "../shared/frame-limiter.js";
import { createOrbitControl } from "../shared/orbit.js";
import { createPostFx } from "../shared/postfx.js";
import { createBed } from "./bed.js";
import { BED_Y, TOP_BAND_Y } from "./layout.js";
import { LAKE } from "./palette.js";
import { createLakeWater } from "./water.js";

/** Where the camera hangs in the column — high enough to see the surface. */
const CAM_Y = TOP_BAND_Y - 11;
const CAM_RADIUS = 34;

export function startLake(canvas: HTMLCanvasElement, feed: GroveFeed) {
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.setSize(innerWidth, innerHeight);

  const orbit = createOrbitControl(canvas);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(LAKE.deep);
  const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 400);

  const water = createLakeWater(scene);
  const bed = createBed(scene);

  const postfx = createPostFx(renderer, scene, camera, {
    toneMapping: THREE.ACESFilmicToneMapping,
    exposure: 1.0,
    bloomStrength: 0.12,
    bloomRadius: 0.6,
    bloomThreshold: 0.75,
  });

  // wired up by index.ts once the systems exist
  let onSprout = (_event: SproutEvent, _blocksSeen: number) => {};
  let onBlockExtra = (_blocksSeen: number) => {};
  let onAmbientExtra = (_mempoolSize: number) => {};
  let onReorgExtra = (_forkHeight: number) => {};
  let onContentFlag = (_launcherId: string) => {};
  let extraUpdate = (_dt: number, _t: number, _blocksSeen: number) => {};

  // Monotonic block counter. Every planted object stores this value as its
  // bornBlock; its depth is bandDepth(blocksSeen - bornBlock). That subtraction
  // is the entire sinking mechanism — there is no per-band state to keep in sync.
  let blocksSeen = 0;

  feed.onEvent((event: GroveEvent) => {
    switch (event.type) {
      case "block":
        blocksSeen++;
        onBlockExtra(blocksSeen);
        break;
      case "sprout":
        onSprout(event, blocksSeen);
        break;
      case "ambient":
        water.setNetspace(event.netspace);
        onAmbientExtra(event.mempoolSize);
        break;
      case "reorg":
        onReorgExtra(event.forkHeight);
        break;
      case "content-flag":
        onContentFlag(event.launcherId);
        break;
    }
  });

  const timer = new THREE.Timer();
  const limiter = createFrameLimiter();
  function frame(): void {
    requestAnimationFrame(frame);
    if (!limiter.shouldRender(performance.now())) return;
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.1);
    const t = timer.getElapsed();

    const angle = (reducedMotion ? 0.6 : t * 0.02) + orbit.getOffset();
    const y = reducedMotion ? CAM_Y : CAM_Y + Math.sin(t * 0.05) * 2.2;
    camera.position.set(Math.cos(angle) * CAM_RADIUS, y, Math.sin(angle) * CAM_RADIUS);
    // look slightly upward so the surface and its shafts stay in frame — the
    // whole point of being submerged rather than looking down at a bed
    camera.lookAt(0, y + 5, 0);

    water.update(t);
    bed.update(t);
    extraUpdate(dt, t, blocksSeen);
    postfx.render();
  }
  frame();

  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    postfx.setSize(innerWidth, innerHeight);
  });

  return Object.assign(
    { renderer, camera, scene, water, bedDepth: BED_Y },
    {
      setSproutHandler: (fn: typeof onSprout) => (onSprout = fn),
      setBlockHandler: (fn: typeof onBlockExtra) => (onBlockExtra = fn),
      setAmbientHandler: (fn: typeof onAmbientExtra) => (onAmbientExtra = fn),
      setReorgHandler: (fn: typeof onReorgExtra) => (onReorgExtra = fn),
      setContentFlagHandler: (fn: typeof onContentFlag) => (onContentFlag = fn),
      setUpdateHandler: (fn: typeof extraUpdate) => (extraUpdate = fn),
      isDragging: () => orbit.isDragging(),
      reducedMotion,
    }
  );
}

export type LakeRuntime = ReturnType<typeof startLake>;
```

- [ ] **Step 4: Write the Visualization**

Create `web/src/themes/lake/index.ts`:

```ts
import type { Visualization } from "../types.js";
import { startLake } from "./lake.js";

export const lake: Visualization = {
  id: "lake",
  label: "lake",
  legend: [
    ["sw-fish", "fish — XCH spend (size = amount)"],
    ["sw-school", "school — CAT (color = asset)"],
    ["sw-jelly", "jellyfish — NFT (clickable)"],
    ["sw-turtle", "turtle — DID"],
    ["sw-ripple", "ripple — new block"],
    ["sw-bubble", "bubbles — mempool"],
    ["sw-shaft", "light shafts — netspace"],
    ["sw-reorg", "strike — reorg"],
  ],
  start(canvas, feed) {
    const runtime = startLake(canvas, feed);
    const frameCallbacks: Array<() => void> = [];
    runtime.setUpdateHandler(() => {
      for (const fn of frameCallbacks) fn();
    });
    return {
      camera: runtime.camera,
      onFrame: (fn) => frameCallbacks.push(fn),
      isDragging: () => runtime.isDragging(),
    };
  },
};
```

- [ ] **Step 5: Register the theme**

In `web/src/themes/index.ts`, add the import alongside the others and append `lake` to `THEMES`:

```ts
import { lake } from "./lake/index.js";
```

```ts
export const THEMES: readonly Visualization[] = [grove, farm, gallery, mine, board, lake];
```

Keep `grove` first — `resolveTheme` falls back to `THEMES[0]`.

- [ ] **Step 6: Add the legend swatches**

Append to `web/src/style.css`, after the existing `.sw-creeper` rule (the swatch classes are global; `.sw-ripple` and `.sw-reorg` already exist and are reused by the lake legend, so only these six are new):

```css
.sw-fish {
  width: 11px;
  height: 6px;
  border-radius: 50% 20% 20% 50%;
  background: #d8e9a8;
}
.sw-school {
  width: 11px;
  height: 6px;
  border-radius: 50% 20% 20% 50%;
  background: linear-gradient(90deg, #4fd0c0, #3a8fd0);
}
.sw-jelly {
  border-radius: 50% 50% 30% 30%;
  background: #c9a6e8;
  box-shadow: 0 0 6px rgba(201, 166, 232, 0.8);
}
.sw-turtle {
  border-radius: 50%;
  background: #5d7a4a;
  border: 1px solid #3d5230;
}
.sw-bubble {
  width: 6px;
  height: 6px;
  margin: 0 2px;
  border-radius: 50%;
  background: rgba(191, 232, 255, 0.5);
  border: 1px solid #bfe8ff;
}
.sw-shaft {
  width: 5px;
  height: 13px;
  background: linear-gradient(to bottom, #a8e0f5, rgba(168, 224, 245, 0));
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run web/test/themes.test.ts`
Expected: PASS, including the new lake registration test.

- [ ] **Step 8: Verify it renders**

Run: `npm run dev:web`, open `http://localhost:5173/?theme=lake&demo=1`.
Expected: a submerged view — dark blue-green water, a rippling surface overhead with light shafts hanging from it, and a weedy bed below. No fish yet. Confirm the camera orbits and that dragging turns the view.

- [ ] **Step 9: Format, typecheck, lint, commit**

```bash
npm run format
npm run typecheck
npm run lint
npm test
git add web/src/themes/lake/lake.ts web/src/themes/lake/index.ts web/src/themes/index.ts web/src/style.css web/test/themes.test.ts
git commit -m "feat(lake): runtime, theme registration and legend"
```

---

### Task 6: Shoal — XCH and CAT fish

**Files:**

- Create: `web/src/themes/lake/shoal.ts`
- Modify: `web/src/themes/lake/index.ts`
- Test: `web/test/lake-shoal.test.ts`
- Modify: `web/test/lake-geometry.test.ts` (append)

**Interfaces:**

- Consumes: `bandDepth`, `seatOffset` (Task 1); `fishSize`, `schoolSize` (Task 2); `LAKE` (Task 3); `catColor` from `../shared/cat-color.ts` (signature: `catColor(assetIdHex: string): { h: number; s: number; l: number }`).
- Produces: `fishGeometry(): THREE.BufferGeometry`; `class Shoal` with constructor `(scene: THREE.Scene, color: number, cap?: number)` and methods `plant(event: SproutEvent, bornBlock: number, size: number, color: THREE.Color | null, member?: number): void`, `update(t: number, blocksSeen: number): void`, `clearAbove(forkHeight: number): void`, `metaAt(index: number): SproutEvent | null`, `pickables(): THREE.Object3D[]`, `metaFor(object: THREE.Object3D, instanceId: number | undefined): SproutEvent | null`, `setHighlight(object: THREE.Object3D, index: number, on: boolean): boolean`.

`cap` defaults to 1200 and exists so tests can force pool wrapping, exactly as `Paintings` does in `mine/structures.ts`.

- [ ] **Step 1: Write the failing tests**

Create `web/test/lake-shoal.test.ts`:

```ts
import * as THREE from "three";
import { expect, test } from "vitest";
import type { SproutEvent } from "@grove/shared";
import { Shoal } from "../src/themes/lake/shoal.js";
import { bandDepth, TOP_BAND_Y } from "../src/themes/lake/layout.js";

const id = (n: number) => n.toString(16).padStart(8, "0") + "00".repeat(28);
const xch = (coinId: string, height = 1): SproutEvent => ({
  type: "sprout",
  kind: "xch",
  height,
  coinId,
  amount: "1000000000000",
});

const yOf = (shoal: Shoal, index: number): number => {
  const m = new THREE.Matrix4();
  shoal.mesh.getMatrixAt(index, m);
  return new THREE.Vector3().setFromMatrixPosition(m).y;
};

test("a planted fish is retrievable by instance index", () => {
  const shoal = new Shoal(new THREE.Scene(), 0xffffff);
  shoal.plant(xch(id(1)), 0, 1, null);
  expect(shoal.metaAt(0)?.coinId).toBe(id(1));
  expect(shoal.metaAt(1)).toBeNull();
});

test("the pool wraps at its cap, overwriting the oldest fish", () => {
  const shoal = new Shoal(new THREE.Scene(), 0xffffff, 2);
  shoal.plant(xch(id(1)), 0, 1, null);
  shoal.plant(xch(id(2)), 0, 1, null);
  shoal.plant(xch(id(3)), 0, 1, null); // wraps onto slot 0
  expect(shoal.metaAt(0)?.coinId).toBe(id(3));
  expect(shoal.metaAt(1)?.coinId).toBe(id(2));
});

test("only planted slots are drawn", () => {
  const shoal = new Shoal(new THREE.Scene(), 0xffffff, 100);
  expect(shoal.mesh.count).toBe(0);
  shoal.plant(xch(id(1)), 0, 1, null);
  expect(shoal.mesh.count).toBe(1);
});

test("clearAbove removes fish at or above the fork height and keeps the rest", () => {
  const shoal = new Shoal(new THREE.Scene(), 0xffffff);
  shoal.plant(xch(id(1), 10), 0, 1, null);
  shoal.plant(xch(id(2), 12), 0, 1, null);
  shoal.clearAbove(12);
  expect(shoal.metaAt(0)?.coinId).toBe(id(1));
  expect(shoal.metaAt(1)).toBeNull();
});

test("clearAbove shrinks the draw count so dead tail slots stop rendering", () => {
  const shoal = new Shoal(new THREE.Scene(), 0xffffff);
  shoal.plant(xch(id(1), 10), 0, 1, null);
  shoal.plant(xch(id(2), 20), 0, 1, null);
  expect(shoal.mesh.count).toBe(2);
  shoal.clearAbove(20);
  expect(shoal.mesh.count).toBe(1);
});

test("a fresh fish swims in the top band", () => {
  const shoal = new Shoal(new THREE.Scene(), 0xffffff);
  shoal.plant(xch(id(7)), 0, 1, null);
  shoal.update(0, 0);
  // bob is up to ±0.35 around the band depth
  expect(yOf(shoal, 0)).toBeGreaterThan(TOP_BAND_Y - 0.4);
  expect(yOf(shoal, 0)).toBeLessThan(TOP_BAND_Y + 0.4);
});

test("a fish sinks as blocks accumulate above it", () => {
  const shoal = new Shoal(new THREE.Scene(), 0xffffff);
  shoal.plant(xch(id(7)), 0, 1, null);
  shoal.update(0, 0);
  const fresh = yOf(shoal, 0);
  shoal.update(0, 10);
  const aged = yOf(shoal, 0);
  expect(aged).toBeLessThan(fresh);
  expect(aged - fresh).toBeCloseTo(bandDepth(10) - bandDepth(0), 5);
});

test("pickables are exposed only once something is planted", () => {
  const shoal = new Shoal(new THREE.Scene(), 0xffffff);
  expect(shoal.pickables()).toHaveLength(0);
  shoal.plant(xch(id(1)), 0, 1, null);
  expect(shoal.pickables()).toEqual([shoal.mesh]);
  expect(shoal.metaFor(shoal.mesh, 0)?.coinId).toBe(id(1));
  expect(shoal.metaFor(new THREE.Mesh(), 0)).toBeNull();
});

test("school members of one spend swim near each other", () => {
  const shoal = new Shoal(new THREE.Scene(), 0xffffff);
  shoal.plant(xch(id(4)), 0, 1, null, 0);
  shoal.plant(xch(id(4)), 0, 1, null, 1);
  shoal.update(0, 0);
  const m = new THREE.Matrix4();
  shoal.mesh.getMatrixAt(0, m);
  const a = new THREE.Vector3().setFromMatrixPosition(m);
  shoal.mesh.getMatrixAt(1, m);
  const b = new THREE.Vector3().setFromMatrixPosition(m);
  expect(a.distanceTo(b)).toBeLessThan(4);
  expect(a.distanceTo(b)).toBeGreaterThan(0);
});
```

Append to `web/test/lake-geometry.test.ts`:

```ts
import { fishGeometry } from "../src/themes/lake/shoal.js";

test("fish geometry is valid and renderable", () => {
  const g = fishGeometry();
  expect(g.getAttribute("position").count).toBeGreaterThan(0);
  expect(g.getAttribute("normal")).toBeDefined();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run web/test/lake-shoal.test.ts`
Expected: FAIL — cannot resolve `../src/themes/lake/shoal.js`.

- [ ] **Step 3: Write the implementation**

Create `web/src/themes/lake/shoal.ts`:

```ts
import * as THREE from "three";
import type { SproutEvent } from "@grove/shared";
import { bandDepth, seatOffset } from "./layout.js";

const WHITE = new THREE.Color(0xffffff);
const HIGHLIGHT_BOOST = 2.2;
const DEFAULT_CAP = 1200;
const BOB_AMPLITUDE = 0.35;

/**
 * One fish, built by hand rather than composed from primitives: an InstancedMesh
 * takes a single geometry, so a fish has to be one BufferGeometry, and merging
 * cones would drag in BufferGeometryUtils for a shape this simple.
 *
 * Points along +X (its swimming direction), nose at +0.6, tail fin at -0.6.
 * Non-indexed and rendered DoubleSide, so winding order does not matter.
 */
export function fishGeometry(): THREE.BufferGeometry {
  const nose: [number, number, number] = [0.6, 0, 0];
  const top: [number, number, number] = [0.1, 0.18, 0];
  const bottom: [number, number, number] = [0.1, -0.18, 0];
  const left: [number, number, number] = [0.1, 0, 0.13];
  const right: [number, number, number] = [0.1, 0, -0.13];
  const tail: [number, number, number] = [-0.35, 0, 0];
  const finTop: [number, number, number] = [-0.62, 0.3, 0];
  const finBottom: [number, number, number] = [-0.62, -0.3, 0];

  const tris: Array<[number, number, number]> = [
    // nose cone
    nose,
    top,
    left,
    nose,
    left,
    bottom,
    nose,
    bottom,
    right,
    nose,
    right,
    top,
    // body tapering to the tail
    tail,
    left,
    top,
    tail,
    bottom,
    left,
    tail,
    right,
    bottom,
    tail,
    top,
    right,
    // tail fin
    tail,
    finTop,
    finBottom,
  ];

  const positions = new Float32Array(tris.length * 3);
  for (let i = 0; i < tris.length; i++) {
    positions[i * 3] = tris[i][0];
    positions[i * 3 + 1] = tris[i][1];
    positions[i * 3 + 2] = tris[i][2];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return g;
}

interface FishSlot {
  meta: SproutEvent | null;
  bornBlock: number;
  radius: number;
  angle: number;
  speed: number;
  bob: number;
  size: number;
  baseColor: THREE.Color;
}

/**
 * A pool of instanced fish sharing one mesh. This does not use `InstancedKind`:
 * that class pins an instance at (x, z) and grows it upward from a base, which
 * cannot express a fish that moves along a path and turns to face its heading.
 * The parts of it that did earn their keep are reproduced here — the wrapping
 * slot pool, the reorg cull with its draw-count shrink, metaAt for picking, and
 * the white instance-color init (skip that and untinted instances render black).
 */
export class Shoal {
  readonly mesh: THREE.InstancedMesh;
  private readonly slots: FishSlot[];
  private next = 0;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly euler = new THREE.Euler();
  private readonly quaternion = new THREE.Quaternion();
  private readonly highlightColor = new THREE.Color();

  constructor(scene: THREE.Scene, color: number, cap = DEFAULT_CAP) {
    this.mesh = new THREE.InstancedMesh(
      fishGeometry(),
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.55,
        metalness: 0.15,
        flatShading: true,
        side: THREE.DoubleSide,
      }),
      cap
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.slots = Array.from({ length: cap }, () => ({
      meta: null,
      bornBlock: 0,
      radius: 0,
      angle: 0,
      speed: 0,
      bob: 0,
      size: 1,
      baseColor: WHITE.clone(),
    }));
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < cap; i++) {
      this.mesh.setMatrixAt(i, zero);
      this.mesh.setColorAt(i, WHITE);
    }
    // An InstancedMesh caches its bounding sphere on first raycast, which would
    // otherwise happen while every slot is still scale-0 and leave a radius-0
    // sphere that makes every later pick miss.
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -33, 0), 70);
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  /**
   * @param member index within a CAT school (0 for a lone fish) — nudges the
   * circuit so schoolmates swim together without any neighbour queries.
   */
  plant(
    event: SproutEvent,
    bornBlock: number,
    size: number,
    color: THREE.Color | null,
    member = 0
  ): void {
    const i = this.next;
    this.next = (this.next + 1) % this.slots.length;
    if (i + 1 > this.mesh.count) this.mesh.count = i + 1;

    const seat = seatOffset(event.coinId);
    const slot = this.slots[i];
    slot.meta = event;
    slot.bornBlock = bornBlock;
    slot.radius = seat.radius + member * 0.4;
    slot.angle = seat.angle + member * 0.07;
    slot.speed = seat.speed;
    slot.bob = seat.bob + member * 0.5;
    slot.size = size;
    slot.baseColor = color ? color.clone() : WHITE.clone();
    // always write: clears any leftover highlight from the recycled slot
    this.mesh.setColorAt(i, slot.baseColor);
    this.mesh.instanceColor!.addUpdateRange(i * 3, 3);
    this.mesh.instanceColor!.needsUpdate = true;
  }

  update(t: number, blocksSeen: number): void {
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (!slot.meta) continue;
      const angle = slot.angle + t * slot.speed;
      const y =
        bandDepth(blocksSeen - slot.bornBlock) + Math.sin(t * 0.8 + slot.bob) * BOB_AMPLITUDE;
      // Heading: the fish points +X, and its velocity around the circuit is the
      // tangent (-sin a, cos a) in XZ. A Y-rotation by θ sends +X to
      // (cos θ, -sin θ), so θ = -(a + π/2) lines the nose up with the tangent.
      const heading = -(angle + Math.PI / 2);
      const wiggle = Math.sin(t * 5 + slot.bob) * 0.18;
      this.euler.set(0, heading, wiggle);
      this.quaternion.setFromEuler(this.euler);
      this.matrix.compose(
        this.position.set(Math.cos(angle) * slot.radius, y, Math.sin(angle) * slot.radius),
        this.quaternion,
        this.scale.setScalar(slot.size)
      );
      this.mesh.setMatrixAt(i, this.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Reorg cull: drop every fish from the orphaned blocks. */
  clearAbove(forkHeight: number): void {
    let highestActive = -1;
    let clearedAny = false;
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (slot.meta && slot.meta.height >= forkHeight) {
        slot.meta = null;
        this.matrix.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this.matrix);
        clearedAny = true;
      } else if (slot.meta) {
        highestActive = i;
      }
    }
    if (!clearedAny) return;
    // The GPU draws every instance below `count` regardless of whether its
    // matrix is degenerate — shrink so a mass cull stops paying for dead slots.
    this.mesh.count = Math.min(this.mesh.count, highestActive + 1);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  metaAt(index: number): SproutEvent | null {
    return this.slots[index]?.meta ?? null;
  }

  pickables(): THREE.Object3D[] {
    return this.mesh.count > 0 ? [this.mesh] : [];
  }

  metaFor(object: THREE.Object3D, instanceId: number | undefined): SproutEvent | null {
    if (object !== this.mesh || instanceId === undefined) return null;
    return this.metaAt(instanceId);
  }

  /** @returns true if this shoal owns the object (so callers can chain). */
  setHighlight(object: THREE.Object3D, index: number, on: boolean): boolean {
    if (object !== this.mesh) return false;
    const slot = this.slots[index];
    if (!slot?.meta) return false;
    const color = on
      ? this.highlightColor.copy(slot.baseColor).multiplyScalar(HIGHLIGHT_BOOST)
      : slot.baseColor;
    this.mesh.setColorAt(index, color);
    this.mesh.instanceColor!.addUpdateRange(index * 3, 3);
    this.mesh.instanceColor!.needsUpdate = true;
    return true;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run web/test/lake-shoal.test.ts web/test/lake-geometry.test.ts`
Expected: PASS (9 shoal tests, 8 geometry tests).

- [ ] **Step 5: Wire the shoals into the theme**

Rewrite `web/src/themes/lake/index.ts`:

```ts
import * as THREE from "three";
import type { Visualization } from "../types.js";
import { catColor } from "../shared/cat-color.js";
import { startLake } from "./lake.js";
import { LAKE } from "./palette.js";
import { fishSize, schoolSize } from "./scales.js";
import { Shoal } from "./shoal.js";

export const lake: Visualization = {
  id: "lake",
  label: "lake",
  legend: [
    ["sw-fish", "fish — XCH spend (size = amount)"],
    ["sw-school", "school — CAT (color = asset)"],
    ["sw-jelly", "jellyfish — NFT (clickable)"],
    ["sw-turtle", "turtle — DID"],
    ["sw-ripple", "ripple — new block"],
    ["sw-bubble", "bubbles — mempool"],
    ["sw-shaft", "light shafts — netspace"],
    ["sw-reorg", "strike — reorg"],
  ],
  start(canvas, feed) {
    const runtime = startLake(canvas, feed);
    const xchFish = new Shoal(runtime.scene, LAKE.xchFish);
    const catFish = new Shoal(runtime.scene, 0xffffff);
    const schoolColor = new THREE.Color();
    let hovered: { object: THREE.Object3D; index: number } | null = null;

    runtime.setSproutHandler((event, blocksSeen) => {
      if (event.kind === "xch") {
        xchFish.plant(event, blocksSeen, fishSize(event.amount), null);
        return;
      }
      if (event.kind === "cat") {
        const { h, s, l } = catColor(event.assetId ?? event.coinId);
        schoolColor.setHSL(h, s, l);
        const count = schoolSize(event.amount);
        for (let member = 0; member < count; member++) {
          catFish.plant(event, blocksSeen, 0.5, schoolColor, member);
        }
      }
    });
    runtime.setReorgHandler((forkHeight) => {
      xchFish.clearAbove(forkHeight);
      catFish.clearAbove(forkHeight);
    });

    const frameCallbacks: Array<() => void> = [];
    runtime.setUpdateHandler((_dt, t, blocksSeen) => {
      xchFish.update(t, blocksSeen);
      catFish.update(t, blocksSeen);
      for (const fn of frameCallbacks) fn();
    });

    return {
      camera: runtime.camera,
      onFrame: (fn) => frameCallbacks.push(fn),
      isDragging: () => runtime.isDragging(),
      pickables: () => [...xchFish.pickables(), ...catFish.pickables()],
      metaFor: (object, instanceId) =>
        xchFish.metaFor(object, instanceId) ?? catFish.metaFor(object, instanceId),
      setHovered: (object, instanceId) => {
        if (hovered) {
          if (!xchFish.setHighlight(hovered.object, hovered.index, false)) {
            catFish.setHighlight(hovered.object, hovered.index, false);
          }
          hovered = null;
        }
        if (object && instanceId !== undefined) {
          if (
            xchFish.setHighlight(object, instanceId, true) ||
            catFish.setHighlight(object, instanceId, true)
          ) {
            hovered = { object, index: instanceId };
          }
        }
      },
    };
  },
};
```

Note the CAT fallback `event.assetId ?? event.coinId`: `assetId` is optional on `SproutEvent`, and `catColor` would throw on `undefined`. Falling back to the coin id keeps the fish colored (just not per-asset) rather than crashing the frame.

- [ ] **Step 6: Verify it renders**

Run: `npm run dev:web`, open `http://localhost:5173/?theme=lake&demo=1`.
Expected: fish swimming circuits at the top of the column, sinking a step with each new block, colored schools for CATs. Click a fish and confirm the shared detail card opens with that spend.

- [ ] **Step 7: Format, typecheck, lint, commit**

```bash
npm run format
npm run typecheck
npm run lint
npm test
git add web/src/themes/lake/shoal.ts web/src/themes/lake/index.ts web/test/lake-shoal.test.ts web/test/lake-geometry.test.ts
git commit -m "feat(lake): instanced fish shoals for XCH and CAT spends"
```

---

### Task 7: Jellies — NFT mints carrying their art

**Files:**

- Create: `web/src/themes/lake/jellies.ts`
- Modify: `web/src/themes/lake/index.ts`
- Test: `web/test/lake-jellies.test.ts`

**Interfaces:**

- Consumes: `bandDepth`, `seatOffset` (Task 1); `LAKE` (Task 3); `LoadPool` from `../shared/load-pool.js`; `sensitivePlaceholderTexture` from `../shared/textures.js`; `loadArtTexture` from `../gallery/media.js`; `resolveMedia` and `thumbnailSrc` from `../../ui/media.js`.
- Produces: `bellGeometry(): THREE.SphereGeometry`; `class Jellies` with constructor `(scene: THREE.Scene, cap?: number)` and methods `plant(event: SproutEvent, bornBlock: number): void`, `update(camera: THREE.Camera, t: number, blocksSeen: number): void`, `has(launcherId: string): boolean`, `markSensitive(launcherId: string): boolean`, `clearAbove(forkHeight: number): void`, `pickables(): THREE.Object3D[]`, `metaFor(object: THREE.Object3D): SproutEvent | null`.

This is a close port of `Paintings` in `mine/structures.ts`. Every carried-over mechanism solves a problem already hit in production — read that file before starting.

- [ ] **Step 1: Write the failing tests**

Create `web/test/lake-jellies.test.ts`:

```ts
import * as THREE from "three";
import { expect, test } from "vitest";
import type { SproutEvent } from "@grove/shared";
import { Jellies } from "../src/themes/lake/jellies.js";

const id = (n: number) => n.toString(16).padStart(8, "0") + "00".repeat(28);
const lid = (n: number) => "ff" + n.toString(16).padStart(62, "0");
// no mediaKind and no dataUri → resolveMedia returns { render: "none" }, so
// these tests never touch the loader or the DOM
const nft = (coinId: string, launcherId: string, height = 1): SproutEvent => ({
  type: "sprout",
  kind: "nft",
  height,
  coinId,
  amount: "1",
  launcherId,
});

test("tracks NFTs by launcher id so repeat spends can be skipped", () => {
  const j = new Jellies(new THREE.Scene());
  j.plant(nft(id(1), lid(1)), 0);
  expect(j.has(lid(1))).toBe(true);
  expect(j.has(lid(2))).toBe(false);
});

test("wrapping a jellyfish out of the pool frees its launcher", () => {
  const j = new Jellies(new THREE.Scene(), 1);
  j.plant(nft(id(1), lid(1)), 0);
  j.plant(nft(id(2), lid(2)), 0);
  expect(j.has(lid(1))).toBe(false);
  expect(j.has(lid(2))).toBe(true);
});

test("clearAbove frees the launchers of the jellyfish it removes", () => {
  const j = new Jellies(new THREE.Scene());
  j.plant(nft(id(1), lid(1), 10), 0);
  j.plant(nft(id(2), lid(2), 12), 0);
  j.clearAbove(12);
  expect(j.has(lid(1))).toBe(true);
  expect(j.has(lid(2))).toBe(false);
});

test("only planted jellyfish are pickable", () => {
  const j = new Jellies(new THREE.Scene());
  expect(j.pickables()).toHaveLength(0);
  j.plant(nft(id(1), lid(1)), 0);
  expect(j.pickables()).toHaveLength(1);
  expect(j.metaFor(j.pickables()[0])?.launcherId).toBe(lid(1));
});

test("a late content flag swaps a hung jellyfish to the placeholder", () => {
  const j = new Jellies(new THREE.Scene());
  j.plant(nft(id(1), lid(1)), 0);
  expect(j.markSensitive(lid(1))).toBe(true);
  expect(j.markSensitive(lid(2))).toBe(false);
  expect(j.metaFor(j.pickables()[0])?.mediaFilter).toBe("sensitive");
});

test("jellyfish sink with age like everything else in the column", () => {
  const j = new Jellies(new THREE.Scene(), 4);
  j.plant(nft(id(1), lid(1)), 0);
  const group = j.pickables()[0].parent as THREE.Object3D;
  const camera = new THREE.PerspectiveCamera();
  j.update(camera, 0, 0);
  const fresh = group.position.y;
  j.update(camera, 0, 10);
  expect(group.position.y).toBeLessThan(fresh);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run web/test/lake-jellies.test.ts`
Expected: FAIL — cannot resolve `../src/themes/lake/jellies.js`.

- [ ] **Step 3: Write the implementation**

Create `web/src/themes/lake/jellies.ts`:

```ts
import * as THREE from "three";
import type { SproutEvent } from "@grove/shared";
import { resolveMedia, thumbnailSrc } from "../../ui/media.js";
import { loadArtTexture } from "../gallery/media.js";
import { LoadPool } from "../shared/load-pool.js";
import { sensitivePlaceholderTexture } from "../shared/textures.js";
import { bandDepth, seatOffset } from "./layout.js";
import { LAKE } from "./palette.js";

const JELLY_CAP = 40;
const PLACEHOLDER = 0x9fb6c9;

/** The bell: a dome, open underneath, with the art panel hanging inside it. */
export function bellGeometry(): THREE.SphereGeometry {
  return new THREE.SphereGeometry(0.95, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
}

interface Jelly {
  group: THREE.Group;
  panel: THREE.Mesh;
  bell: THREE.Mesh;
  meta: SproutEvent | null;
  bornBlock: number;
  radius: number;
  angle: number;
  speed: number;
  bob: number;
}

/**
 * NFT mints as drifting jellyfish. Structurally this is `mine`'s `Paintings`
 * with different geometry, and the machinery it carries over is all load-bearing:
 *
 * - byLauncher dedupe, because a mint arrives as an eve plus a lineage spend and
 *   transfers spend the NFT again — without it one NFT hangs several jellyfish.
 * - LoadPool with a stillWanted guard, because the snapshot replay churns
 *   hundreds of NFTs through this small pool in a couple of seconds; fetching
 *   art for slots that were recycled before anyone saw them bursts past the /img
 *   proxy's rate limit.
 * - resolveMedia for every render decision, so content filtering is uniform by
 *   construction: blocked and sensitive art is never fetched, only placeheld.
 */
export class Jellies {
  private readonly pool: Jelly[];
  private next = 0;
  private readonly byLauncher = new Map<string, number>();
  private readonly loads = new LoadPool(3, 15000);

  constructor(
    scene: THREE.Scene,
    private readonly cap = JELLY_CAP
  ) {
    const bellGeo = bellGeometry();
    const panelGeo = new THREE.PlaneGeometry(0.9, 0.9);
    const tentacleGeo = new THREE.BoxGeometry(0.05, 1.5, 0.05);
    tentacleGeo.translate(0, -0.75, 0);

    this.pool = Array.from({ length: cap }, () => {
      const group = new THREE.Group();
      const bell = new THREE.Mesh(
        bellGeo,
        new THREE.MeshStandardMaterial({
          color: LAKE.jelly,
          transparent: true,
          opacity: 0.42,
          roughness: 0.25,
          emissive: new THREE.Color(LAKE.jelly),
          emissiveIntensity: 0.35,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      );
      // the art hangs inside the bell, billboarded to the camera each frame
      const panel = new THREE.Mesh(
        panelGeo,
        new THREE.MeshBasicMaterial({ color: PLACEHOLDER, side: THREE.DoubleSide })
      );
      panel.position.y = -0.25;
      const tentacleMat = new THREE.MeshStandardMaterial({
        color: LAKE.jelly,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
      });
      group.add(bell, panel);
      for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2;
        const tentacle = new THREE.Mesh(tentacleGeo, tentacleMat);
        tentacle.position.set(Math.cos(angle) * 0.55, -0.1, Math.sin(angle) * 0.55);
        group.add(tentacle);
      }
      group.visible = false;
      scene.add(group);
      return {
        group,
        panel,
        bell,
        meta: null,
        bornBlock: 0,
        radius: 0,
        angle: 0,
        speed: 0,
        bob: 0,
      };
    });
  }

  plant(event: SproutEvent, bornBlock: number): void {
    const slot = this.next;
    const j = this.pool[slot];
    this.next = (this.next + 1) % this.cap;
    // a recycled slot may still own a launcher mapping — drop it before reuse
    if (j.meta?.launcherId && this.byLauncher.get(j.meta.launcherId) === slot) {
      this.byLauncher.delete(j.meta.launcherId);
    }

    const seat = seatOffset(event.coinId);
    j.meta = event;
    j.bornBlock = bornBlock;
    // jellyfish drift on a tighter, slower circuit than the fish
    j.radius = seat.radius * 0.8;
    j.angle = seat.angle;
    j.speed = seat.speed * 0.35;
    j.bob = seat.bob;
    j.group.visible = true;
    if (event.launcherId) this.byLauncher.set(event.launcherId, slot);

    // reset a recycled slot to the placeholder before the (async) art loads
    const mat = j.panel.material as THREE.MeshBasicMaterial;
    mat.map = null;
    mat.color.set(PLACEHOLDER);
    mat.needsUpdate = true;

    const media = resolveMedia(event);
    if (media.render === "art") {
      const src = media.src;
      const kind = media.kind;
      const poster = thumbnailSrc(event) ?? undefined;
      this.loads.submit({
        // by the time a queued load reaches the front the slot may have been
        // recycled (replay churns hundreds of NFTs through it) — skip the fetch
        stillWanted: () => j.meta === event,
        start: (done) => {
          loadArtTexture(
            src,
            kind,
            (tex) => {
              done(); // free the pool slot regardless of whether we still want it
              if (j.meta !== event) return; // slot recycled mid-flight
              tex.colorSpace = THREE.SRGBColorSpace;
              mat.map = tex;
              mat.color.set(0xffffff);
              mat.needsUpdate = true;
            },
            done,
            poster
          );
        },
      });
    } else if (media.render === "blur" || media.render === "placeholder") {
      // filtered → neutral placeholder texture; never fetch the real art
      mat.map = sensitivePlaceholderTexture();
      mat.color.set(0xffffff);
      mat.needsUpdate = true;
    }
    // render === "none" → leave the solid placeholder color set above
  }

  update(camera: THREE.Camera, t: number, blocksSeen: number): void {
    for (const j of this.pool) {
      if (!j.meta) continue;
      const angle = j.angle + t * j.speed;
      j.group.position.set(
        Math.cos(angle) * j.radius,
        bandDepth(blocksSeen - j.bornBlock) + Math.sin(t * 0.5 + j.bob) * 0.5,
        Math.sin(angle) * j.radius
      );
      // pulse the bell; the panel keeps its own scale so the art never squashes
      const pulse = 1 + Math.sin(t * 1.4 + j.bob) * 0.12;
      j.bell.scale.set(pulse, 2 - pulse, pulse);
      // same-Y lookAt is a pure yaw, so the dome stays upright while the art
      // panel turns to face the camera — the trick `Paintings.update` uses
      j.group.lookAt(camera.position.x, j.group.position.y, camera.position.z);
    }
  }

  /** True if an NFT with this launcher id already has a jellyfish. */
  has(launcherId: string): boolean {
    return this.byLauncher.has(launcherId);
  }

  /** Blur an already-drifting jellyfish after a late content flag. */
  markSensitive(launcherId: string): boolean {
    const slot = this.byLauncher.get(launcherId);
    if (slot === undefined) return false;
    const j = this.pool[slot];
    if (!j?.meta) return false;
    j.meta = { ...j.meta, mediaFilter: "sensitive" };
    const mat = j.panel.material as THREE.MeshBasicMaterial;
    mat.map = sensitivePlaceholderTexture();
    mat.color.set(0xffffff);
    mat.needsUpdate = true;
    return true;
  }

  clearAbove(forkHeight: number): void {
    for (let i = 0; i < this.pool.length; i++) {
      const j = this.pool[i];
      if (j.meta && j.meta.height >= forkHeight) {
        if (j.meta.launcherId && this.byLauncher.get(j.meta.launcherId) === i) {
          this.byLauncher.delete(j.meta.launcherId);
        }
        j.meta = null;
        j.group.visible = false;
      }
    }
  }

  pickables(): THREE.Object3D[] {
    return this.pool.filter((j) => j.meta).map((j) => j.panel);
  }

  metaFor(object: THREE.Object3D): SproutEvent | null {
    return this.pool.find((j) => j.panel === object)?.meta ?? null;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run web/test/lake-jellies.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Wire the jellies into the theme**

In `web/src/themes/lake/index.ts`, add the import:

```ts
import { Jellies } from "./jellies.js";
```

Construct it next to the shoals:

```ts
const jellies = new Jellies(runtime.scene);
```

Extend the sprout handler with an NFT branch, placed after the CAT branch:

```ts
if (event.kind === "nft") {
  // an NFT spent more than once inside the window (a mint is an eve + lineage
  // spend; transfers spend it again) arrives as repeat events — one jellyfish
  // per launcher id, the way the gallery dedupes its canvases
  if (event.launcherId && jellies.has(event.launcherId)) return;
  jellies.plant(event, blocksSeen);
}
```

Add to the reorg handler:

```ts
jellies.clearAbove(forkHeight);
```

Add the content-flag handler:

```ts
runtime.setContentFlagHandler((launcherId) => jellies.markSensitive(launcherId));
```

Add to the update handler:

```ts
jellies.update(runtime.camera, t, blocksSeen);
```

Extend `pickables` and `metaFor`:

```ts
pickables: () => [...xchFish.pickables(), ...catFish.pickables(), ...jellies.pickables()],
metaFor: (object, instanceId) =>
  xchFish.metaFor(object, instanceId) ??
  catFish.metaFor(object, instanceId) ??
  jellies.metaFor(object),
```

- [ ] **Step 6: Verify it renders**

Run: `npm run dev:web`, open `http://localhost:5173/?theme=lake&demo=1`.
Expected: translucent jellyfish drifting among the fish with demo art visible in their bells, pulsing slowly, sinking with their band. Click one and confirm the detail card opens.

- [ ] **Step 7: Format, typecheck, lint, commit**

```bash
npm run format
npm run typecheck
npm run lint
npm test
git add web/src/themes/lake/jellies.ts web/src/themes/lake/index.ts web/test/lake-jellies.test.ts
git commit -m "feat(lake): NFT jellyfish carrying art in their bells"
```

---

### Task 8: Turtles — DID spends

**Files:**

- Create: `web/src/themes/lake/turtles.ts`
- Modify: `web/src/themes/lake/index.ts`
- Modify: `web/test/lake-geometry.test.ts` (append)

**Interfaces:**

- Consumes: `bandDepth`, `seatOffset` (Task 1); `LAKE` (Task 3).
- Produces: `shellGeometry(): THREE.SphereGeometry`; `class Turtles` with constructor `(scene: THREE.Scene, cap?: number)` and methods `plant(event: SproutEvent, bornBlock: number): void`, `update(t: number, blocksSeen: number): void`, `clearAbove(forkHeight: number): void`, `pickables(): THREE.Object3D[]`, `metaFor(object: THREE.Object3D): SproutEvent | null`.

- [ ] **Step 1: Write the failing tests**

Append to `web/test/lake-geometry.test.ts`:

```ts
import type { SproutEvent } from "@grove/shared";
import { shellGeometry, Turtles } from "../src/themes/lake/turtles.js";

const did = (coinId: string, height = 1): SproutEvent => ({
  type: "sprout",
  kind: "did",
  height,
  coinId,
  amount: "1",
});

test("shell geometry is valid and renderable", () => {
  expect(shellGeometry().getAttribute("position").count).toBeGreaterThan(0);
});

test("turtles are pickable once planted and cull on reorg", () => {
  const turtles = new Turtles(new THREE.Scene());
  expect(turtles.pickables()).toHaveLength(0);
  turtles.plant(did("aa".repeat(32), 10), 0);
  turtles.plant(did("bb".repeat(32), 20), 0);
  expect(turtles.pickables()).toHaveLength(2);
  turtles.clearAbove(20);
  expect(turtles.pickables()).toHaveLength(1);
  expect(turtles.metaFor(turtles.pickables()[0])?.height).toBe(10);
});

test("turtles sink with age", () => {
  const turtles = new Turtles(new THREE.Scene());
  turtles.plant(did("aa".repeat(32)), 0);
  const shell = turtles.pickables()[0];
  turtles.update(0, 0);
  const fresh = (shell.parent as THREE.Object3D).position.y;
  turtles.update(0, 10);
  expect((shell.parent as THREE.Object3D).position.y).toBeLessThan(fresh);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run web/test/lake-geometry.test.ts`
Expected: FAIL — cannot resolve `../src/themes/lake/turtles.js`.

- [ ] **Step 3: Write the implementation**

Create `web/src/themes/lake/turtles.ts`:

```ts
import * as THREE from "three";
import type { SproutEvent } from "@grove/shared";
import { bandDepth, seatOffset } from "./layout.js";
import { LAKE } from "./palette.js";

const TURTLE_CAP = 30;

/** A domed shell, flattened on assembly so it reads as a carapace. */
export function shellGeometry(): THREE.SphereGeometry {
  return new THREE.SphereGeometry(0.55, 14, 10);
}

interface Turtle {
  group: THREE.Group;
  shell: THREE.Mesh;
  meta: SproutEvent | null;
  bornBlock: number;
  radius: number;
  angle: number;
  speed: number;
  bob: number;
}

/**
 * DIDs as turtles: the longest-lived things in the lake, on the slowest
 * circuits. Same pool-and-recycle shape as `Jellies` without the media
 * pipeline, since a DID has no art.
 */
export class Turtles {
  private readonly pool: Turtle[];
  private next = 0;

  constructor(
    scene: THREE.Scene,
    private readonly cap = TURTLE_CAP
  ) {
    const shellGeo = shellGeometry();
    const headGeo = new THREE.SphereGeometry(0.16, 8, 6);
    const flipperGeo = new THREE.BoxGeometry(0.4, 0.06, 0.16);
    const material = new THREE.MeshStandardMaterial({
      color: LAKE.turtle,
      roughness: 0.8,
      flatShading: true,
    });

    this.pool = Array.from({ length: cap }, () => {
      const group = new THREE.Group();
      const shell = new THREE.Mesh(shellGeo, material);
      shell.scale.set(1, 0.5, 1.25); // flatten the sphere into a carapace
      const head = new THREE.Mesh(headGeo, material);
      head.position.set(0, 0, 0.72);
      group.add(shell, head);
      for (const side of [-1, 1]) {
        const flipper = new THREE.Mesh(flipperGeo, material);
        flipper.position.set(side * 0.5, 0, 0.2);
        flipper.rotation.z = side * 0.2;
        group.add(flipper);
      }
      group.visible = false;
      scene.add(group);
      return {
        group,
        shell,
        meta: null,
        bornBlock: 0,
        radius: 0,
        angle: 0,
        speed: 0,
        bob: 0,
      };
    });
  }

  plant(event: SproutEvent, bornBlock: number): void {
    const slot = this.next;
    const turtle = this.pool[slot];
    this.next = (this.next + 1) % this.cap;

    const seat = seatOffset(event.coinId);
    turtle.meta = event;
    turtle.bornBlock = bornBlock;
    turtle.radius = seat.radius * 1.05;
    turtle.angle = seat.angle;
    turtle.speed = seat.speed * 0.25; // patient
    turtle.bob = seat.bob;
    turtle.group.visible = true;
  }

  update(t: number, blocksSeen: number): void {
    for (const turtle of this.pool) {
      if (!turtle.meta) continue;
      const angle = turtle.angle + t * turtle.speed;
      turtle.group.position.set(
        Math.cos(angle) * turtle.radius,
        bandDepth(blocksSeen - turtle.bornBlock) + Math.sin(t * 0.35 + turtle.bob) * 0.4,
        Math.sin(angle) * turtle.radius
      );
      // the head points +Z, so yaw by -angle lines it up with the tangent
      turtle.group.rotation.y = -angle;
      // a slow paddling roll
      turtle.group.rotation.z = Math.sin(t * 1.1 + turtle.bob) * 0.12;
    }
  }

  clearAbove(forkHeight: number): void {
    for (const turtle of this.pool) {
      if (turtle.meta && turtle.meta.height >= forkHeight) {
        turtle.meta = null;
        turtle.group.visible = false;
      }
    }
  }

  pickables(): THREE.Object3D[] {
    return this.pool.filter((turtle) => turtle.meta).map((turtle) => turtle.shell);
  }

  metaFor(object: THREE.Object3D): SproutEvent | null {
    return this.pool.find((turtle) => turtle.shell === object)?.meta ?? null;
  }
}
```

Note: every turtle shares one `shell` geometry _and_ material instance, but each has its own `THREE.Mesh`, so `metaFor`'s identity lookup on the mesh still works.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run web/test/lake-geometry.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Wire the turtles into the theme**

In `web/src/themes/lake/index.ts`, add the import `import { Turtles } from "./turtles.js";`, construct `const turtles = new Turtles(runtime.scene);`, then add a DID branch to the sprout handler after the NFT branch:

```ts
if (event.kind === "did") turtles.plant(event, blocksSeen);
```

Add `turtles.clearAbove(forkHeight);` to the reorg handler, `turtles.update(t, blocksSeen);` to the update handler, `...turtles.pickables()` to `pickables`, and `?? turtles.metaFor(object)` to the end of the `metaFor` chain.

- [ ] **Step 6: Format, typecheck, lint, commit**

```bash
npm run format
npm run typecheck
npm run lint
npm test
git add web/src/themes/lake/turtles.ts web/src/themes/lake/index.ts web/test/lake-geometry.test.ts
git commit -m "feat(lake): DID turtles"
```

---

### Task 9: Vfx — mempool bubbles, block ripples, reorg strike

**Files:**

- Create: `web/src/themes/lake/vfx.ts`
- Modify: `web/src/themes/lake/index.ts`
- Modify: `web/test/lake-geometry.test.ts` (append)

**Interfaces:**

- Consumes: `BED_Y`, `TOP_BAND_Y`, `BAND_RADIUS_MAX` (Task 1); `LAKE` (Task 3); `SURFACE_Y` (Task 3).
- Produces: `class Vfx` with constructor `(scene: THREE.Scene)` and methods `setMempool(size: number): void`, `beacon(radius: number, t: number): void`, `strike(t: number): void`, `update(dt: number, t: number): void`, plus three inspection helpers used by the tests: `bubbleCount(): number`, `highestBubbleY(): number`, `activeBeacons(): number`.

The block ripple is not here — it belongs to `water.ts`, which owns the surface shader. `index.ts` calls `runtime.water.ripple(t)` on each block.

`beacon()` covers the spec's `mint` mapping: a mint already becomes a jellyfish or a fish, and this adds the shaft of light marking it as newly created, the way `mine` fires a beacon on the same flag.

- [ ] **Step 1: Write the failing tests**

Append to `web/test/lake-geometry.test.ts`:

```ts
import { Vfx } from "../src/themes/lake/vfx.js";
import { SURFACE_Y } from "../src/themes/lake/water.js";

test("mempool size controls how many bubbles are drawn", () => {
  const vfx = new Vfx(new THREE.Scene());

  vfx.setMempool(0);
  expect(vfx.bubbleCount()).toBe(0);

  vfx.setMempool(10);
  const quiet = vfx.bubbleCount();
  expect(quiet).toBeGreaterThan(0);

  vfx.setMempool(500);
  expect(vfx.bubbleCount()).toBeGreaterThan(quiet);
});

test("bubble count is capped so a mempool spike cannot exceed the buffer", () => {
  const vfx = new Vfx(new THREE.Scene());
  vfx.setMempool(1e9);
  expect(vfx.bubbleCount()).toBeLessThanOrEqual(400);
});

test("bubbles rise and wrap back to the bed instead of escaping", () => {
  const vfx = new Vfx(new THREE.Scene());
  vfx.setMempool(500);
  // run well past the time it takes a bubble to cross the whole column
  for (let i = 0; i < 3000; i++) vfx.update(0.016, i * 0.016);
  expect(vfx.highestBubbleY()).toBeLessThanOrEqual(SURFACE_Y);
});

test("a mint fires a beacon that fades out on its own", () => {
  const vfx = new Vfx(new THREE.Scene());
  expect(vfx.activeBeacons()).toBe(0);
  vfx.beacon(12, 0);
  expect(vfx.activeBeacons()).toBe(1);
  for (let i = 0; i < 200; i++) vfx.update(0.016, i * 0.016);
  expect(vfx.activeBeacons()).toBe(0);
});

test("a reorg strike runs and finishes without a renderer", () => {
  const vfx = new Vfx(new THREE.Scene());
  vfx.strike(0);
  expect(() => {
    for (let i = 0; i < 200; i++) vfx.update(0.016, i * 0.016);
  }).not.toThrow();
});

test("a mint fires a beacon that fades out on its own", () => {
  const vfx = new Vfx(new THREE.Scene());
  expect(vfx.activeBeacons()).toBe(0);
  vfx.beacon(12, 0);
  expect(vfx.activeBeacons()).toBe(1);
  for (let i = 0; i < 200; i++) vfx.update(0.016, i * 0.016);
  expect(vfx.activeBeacons()).toBe(0);
});
```

Delete the two placeholder lines (`const bubbles = ...` / `void bubbles;`) — they are shown only to mark where an earlier draft had dead code; the test does not need them.

Add `SURFACE_Y` to this file's imports from `../src/themes/lake/water.js`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run web/test/lake-geometry.test.ts`
Expected: FAIL — cannot resolve `../src/themes/lake/vfx.js`.

- [ ] **Step 3: Write the implementation**

Create `web/src/themes/lake/vfx.ts`:

```ts
import * as THREE from "three";
import { mulberry32 } from "../shared/util.js";
import { BAND_RADIUS_MAX, BED_Y, TOP_BAND_Y } from "./layout.js";
import { LAKE } from "./palette.js";
import { SURFACE_Y } from "./water.js";

const BUBBLE_CAP = 400;
const STRIKE_SECONDS = 2.4;
const BEACON_CAP = 8;
const BEACON_SECONDS = 1.4;

interface Beacon {
  mesh: THREE.Mesh;
  bornAt: number;
  active: boolean;
}

/**
 * Ambient effects: bubble columns rising off the bed (mempool), mint beacons,
 * and the reorg predator. The per-block surface ripple lives in `water.ts`,
 * which owns the surface shader.
 */
export class Vfx {
  private readonly bubbles: THREE.Points;
  private readonly speeds: Float32Array;
  private readonly predator: THREE.Mesh;
  private readonly beacons: Beacon[];
  private nextBeacon = 0;
  private litCount = 0;
  private strikeStart = -1;

  constructor(scene: THREE.Scene) {
    const positions = new Float32Array(BUBBLE_CAP * 3);
    this.speeds = new Float32Array(BUBBLE_CAP);
    const rand = mulberry32(0x5eed1234);
    for (let i = 0; i < BUBBLE_CAP; i++) {
      // cluster bubbles into a handful of vents rather than scattering them
      const vent = Math.floor(rand() * 9);
      const ventAngle = (vent / 9) * Math.PI * 2;
      const ventRadius = 5 + (vent % 4) * 6;
      positions[i * 3] = Math.cos(ventAngle) * ventRadius + (rand() - 0.5) * 2.2;
      positions[i * 3 + 1] = BED_Y + rand() * (SURFACE_Y - BED_Y);
      positions[i * 3 + 2] = Math.sin(ventAngle) * ventRadius + (rand() - 0.5) * 2.2;
      this.speeds[i] = 1.4 + rand() * 1.8;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.bubbles = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: LAKE.bubble,
        size: 0.16,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      })
    );
    this.bubbles.frustumCulled = false;
    scene.add(this.bubbles);

    // the predator: a dark silhouette that sweeps the column on a reorg
    const bodyGeo = new THREE.ConeGeometry(0.9, 5.5, 8);
    bodyGeo.rotateZ(-Math.PI / 2); // point +X, the direction it travels
    this.predator = new THREE.Mesh(
      bodyGeo,
      new THREE.MeshStandardMaterial({
        color: LAKE.predator,
        roughness: 0.7,
        transparent: true,
        opacity: 0,
      })
    );
    this.predator.visible = false;
    scene.add(this.predator);

    // mint beacons: short-lived columns of light rising to the surface
    const beamGeo = new THREE.CylinderGeometry(0.3, 0.3, 60, 8, 1, true);
    beamGeo.translate(0, 30, 0);
    this.beacons = Array.from({ length: BEACON_CAP }, () => {
      const mesh = new THREE.Mesh(
        beamGeo,
        new THREE.MeshBasicMaterial({
          color: LAKE.shaft,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          fog: false,
        })
      );
      mesh.visible = false;
      scene.add(mesh);
      return { mesh, bornAt: 0, active: false };
    });
  }

  /** Mempool size → how much of the bubble field is active. */
  setMempool(size: number): void {
    this.litCount = Math.max(0, Math.min(BUBBLE_CAP, Math.round(size * 4)));
  }

  /**
   * Mint flag → a beacon at the given circuit radius, on a random bearing so
   * repeated mints in one block do not stack into a single brighter column.
   */
  beacon(radius: number, t: number): void {
    const b = this.beacons[this.nextBeacon];
    this.nextBeacon = (this.nextBeacon + 1) % BEACON_CAP;
    // vary the bearing by slot index rather than Math.random so the scene stays
    // reproducible across a snapshot replay
    const angle = (this.nextBeacon / BEACON_CAP) * Math.PI * 2;
    b.mesh.position.set(Math.cos(angle) * radius, BED_Y, Math.sin(angle) * radius);
    b.mesh.visible = true;
    b.active = true;
    b.bornAt = t;
  }

  /** Reorg → send the predator across the column. */
  strike(t: number): void {
    this.strikeStart = t;
    this.predator.visible = true;
  }

  /** How many bubbles are currently drawn. Test seam. */
  bubbleCount(): number {
    return this.litCount;
  }

  /** The Y of the highest active bubble. Test seam. */
  highestBubbleY(): number {
    const attr = this.bubbles.geometry.getAttribute("position") as THREE.BufferAttribute;
    let highest = -Infinity;
    for (let i = 0; i < this.litCount; i++) highest = Math.max(highest, attr.getY(i));
    return highest;
  }

  /** How many mint beacons are still burning. Test seam. */
  activeBeacons(): number {
    return this.beacons.filter((b) => b.active).length;
  }

  update(dt: number, t: number): void {
    // bubbles rise and wrap back to the bed
    const attr = this.bubbles.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < this.litCount; i++) {
      let y = attr.getY(i) + this.speeds[i] * dt;
      if (y > SURFACE_Y) y = BED_Y;
      attr.setY(i, y);
    }
    attr.needsUpdate = true;
    this.bubbles.geometry.setDrawRange(0, this.litCount);

    for (const b of this.beacons) {
      if (!b.active) continue;
      const opacity = Math.max(0, 0.5 * (1 - (t - b.bornAt) / BEACON_SECONDS));
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
      if (opacity <= 0) {
        b.active = false;
        b.mesh.visible = false;
      }
    }

    if (this.strikeStart >= 0) {
      const age = t - this.strikeStart;
      const progress = age / STRIKE_SECONDS;
      if (progress >= 1) {
        this.predator.visible = false;
        this.strikeStart = -1;
      } else {
        // crosses the column left to right, fading in and out at the edges
        const span = BAND_RADIUS_MAX + 22;
        this.predator.position.set(
          -span + progress * span * 2,
          TOP_BAND_Y - 6 + Math.sin(progress * Math.PI) * 3,
          Math.cos(progress * 2.2) * 5
        );
        this.predator.rotation.y = Math.sin(progress * 2.2) * 0.4;
        (this.predator.material as THREE.MeshStandardMaterial).opacity =
          Math.sin(progress * Math.PI) * 0.9;
      }
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run web/test/lake-geometry.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Wire the vfx into the theme**

In `web/src/themes/lake/index.ts`, add `import { Vfx } from "./vfx.js";`, construct `const vfx = new Vfx(runtime.scene);`, and wire the remaining three handlers. Note the block handler and the ambient handler did not exist yet in this file:

```ts
runtime.setBlockHandler(() => runtime.water.ripple(clock.t));
runtime.setAmbientHandler((mempoolSize) => vfx.setMempool(mempoolSize));
```

`runtime.water.ripple` and `vfx.strike` both need the current elapsed time, which only the frame loop has, so hold it in a small ref updated each frame — the pattern `mine/index.ts` uses with its `clock` object. Declare it next to the systems:

```ts
const clock = { t: 0 };
```

Add the strike to the existing reorg handler:

```ts
vfx.strike(clock.t);
```

Fire a beacon on mints. Add `seatOffset` to this file's imports from `./layout.js`, then put this at the very top of the sprout handler, before the per-kind branches, so a mint of any kind is marked:

```ts
if (event.mint) vfx.beacon(seatOffset(event.coinId).radius, clock.t);
```

And in the update handler, set the clock first so the handlers above read a current value, then update the vfx:

```ts
runtime.setUpdateHandler((dt, t, blocksSeen) => {
  clock.t = t;
  xchFish.update(t, blocksSeen);
  catFish.update(t, blocksSeen);
  jellies.update(runtime.camera, t, blocksSeen);
  turtles.update(t, blocksSeen);
  vfx.update(dt, t);
  for (const fn of frameCallbacks) fn();
});
```

- [ ] **Step 6: Verify the whole scene**

Run: `npm run dev:web`, open `http://localhost:5173/?theme=lake&demo=1`.
Expected: bubbles rising from vents on the bed, a ripple crossing the surface on each block, and — if the demo feed emits one — a predator sweeping through on a reorg while the affected fish vanish.

Also check the real feed: run `npm run dev:server` in a second terminal and open `http://localhost:5173/?theme=lake`.

- [ ] **Step 7: Format, typecheck, lint, commit**

```bash
npm run format
npm run typecheck
npm run lint
npm test
git add web/src/themes/lake/vfx.ts web/src/themes/lake/index.ts web/test/lake-geometry.test.ts
git commit -m "feat(lake): mempool bubbles, block ripples and the reorg strike"
```

---

### Task 10: Documentation and final verification

**Files:**

- Modify: `web/CLAUDE.md`
- Modify: `CLAUDE.md` (root)

**Interfaces:**

- Consumes: everything above.
- Produces: no code.

- [ ] **Step 1: Document the theme**

In `web/CLAUDE.md`, update the theme-system paragraph so the count and list include `lake`:

> Six themes ship: `grove`, `farm`, `gallery`, `mine`, `board`, `lake`.

Then add a `### lake (src/themes/lake/)` section after the `board` section:

```markdown
### lake (`src/themes/lake/`)

Submerged freshwater lake. The camera orbits inside the water column looking
slightly upward. Each block is a horizontal band: the newest sits just under the
surface and older bands sink, so chain history reads as depth. XCH spends are
fish sized by amount (a whale spend is a whale), CATs are schools colored by
`assetId`, NFT mints are jellyfish carrying their art in a translucent bell, DIDs
are turtles. Mempool drives bubble columns off the bed, netspace drives water
clarity and light-shaft strength, each block ripples the surface, and a reorg
sends a predator through.

Sinking has no per-band bookkeeping: each planted object stores the global block
counter as `bornBlock`, and its Y is `bandDepth(blocksSeen - bornBlock)`,
recomputed each frame. Objects older than `MAX_BANDS` (40) clamp at the bed until
their pool slot is recycled by wrapping.

`shoal.ts` deliberately does not use `InstancedKind`: that class pins instances at
`(x, z)` and grows them upward from a base, which cannot express a fish that
follows a path and turns to face its heading. It owns its own `InstancedMesh` and
reproduces only the parts of `InstancedKind` that earned their keep (wrapping
pool, reorg cull with draw-count shrink, `metaAt` picking, white color init).
`jellies.ts` is a close port of `mine`'s `Paintings` — the launcher dedupe,
`LoadPool` `stillWanted` guard, and `resolveMedia` filtering all carry over
unchanged. `bed.ts` weeds are static instanced scenery swayed in the vertex
shader, costing one uniform write per frame.
```

In the root `CLAUDE.md`, update the `web/` bullet to say six themes and list `lake`.

- [ ] **Step 2: Full verification**

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Expected: all pass, and the production build succeeds.

- [ ] **Step 3: Commit**

```bash
npm run format
git add CLAUDE.md web/CLAUDE.md
git commit -m "docs: document the lake theme"
```

---

## Self-Review Notes

Checked against `docs/superpowers/specs/2026-08-12-lake-theme-design.md`:

- Every file in the spec's architecture table has a task: `layout.ts` (1), `scales.ts` (2), `palette.ts`/`water.ts` (3), `bed.ts` (4), `lake.ts`/`index.ts` (5), `shoal.ts` (6), `jellies.ts` (7), `turtles.ts` (8), `vfx.ts` (9).
- Every row of the spec's event-mapping table is wired: block (5, 9), xch (6), cat (6), nft (7), did (8), mint (9), ambient mempool (9), ambient netspace (3, 5), reorg (6, 7, 8, 9), content-flag (7).
- Every test file the spec lists is created: `lake-layout` (1), `lake-scales` (2), `lake-geometry` (3, 4, 6, 8, 9), `lake-shoal` (6), `lake-jellies` (7), `themes.test.ts` extension (5).
- Type consistency: `bandDepth(age)` and `seatOffset(coinId)` keep their Task 1 signatures everywhere; `clearAbove(forkHeight)` is the name used by all four systems; `plant(event, bornBlock, ...)` is consistent across `Shoal`, `Jellies`, and `Turtles`; `blocksSeen` is threaded from `lake.ts` through every handler.

**Fixed during review:** an earlier draft of this plan had no task for the spec's `mint` mapping and proposed deferring it. That was wrong — a spec requirement with no task is a plan gap, not a scope decision — so `Vfx.beacon()` and its wiring are now part of Task 9.

**Verification seams:** `Vfx` exposes `bubbleCount()`, `highestBubbleY()`, and `activeBeacons()` purely so its behavior is assertable without a renderer. They are cheap reads over state the class already keeps, and they replace the alternative of reaching into private fields from the test.
