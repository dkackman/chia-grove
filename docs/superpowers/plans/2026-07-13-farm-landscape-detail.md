# Farm Landscape Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the farm theme's surroundings static texture and weight — a grained, gently rolling ground; painted parcels, a dirt lane and a worn barnyard; hedgerows; and a scatter of bales, boulders and clutter — so the farm reads as sited in worked countryside rather than placed on a putting green.

**Architecture:** A pure `groundHeight(x, z)` height field displaces the turf disc, damped to exactly zero over the box the farm occupies (so crops, tractor, chickens, fence and blob shadows keep their `y = 0` world) and again near the hills (whose lower hemispheres are buried under the turf). A transparent "landscape" canvas draped on a clone of the same displaced geometry carries the parcels, mowing stripes, dirt lane and barnyard apron. `field.ts` (607 lines) splits: the ground moves to `terrain.ts`, the canvas painter to `landscape.ts`, trees and hedges to `scenery.ts`, the scatter to `props.ts`.

**Tech Stack:** TypeScript, Three.js (`RingGeometry`, `mergeGeometries`, `CanvasTexture`), Vitest (node environment — **no DOM**), Vite.

**Spec:** [docs/superpowers/specs/2026-07-13-farm-landscape-detail-design.md](../specs/2026-07-13-farm-landscape-detail-design.md)

## Global Constraints

- **Everything added is static scenery.** Built once at scene construction. No per-frame `update`, no legend row, no `reducedMotion` branch. The one exception is Task 6, which _reduces_ existing motion.
- **Nothing on the ground may move.** Crops (`plantPosition`), the tractor (`EDGE_X = 24`), the chickens (home x ≈ −14, z ≈ −23), the fence (z ≈ 22.8), the furrow plane, the soil strips and every `blobShadow` all assume the ground is exactly `y = 0` and none of them sample a height. The flat zone exists to keep that true. Do not change any of them.
- **Vitest runs in the node environment — there is no `document`.** Anything that calls `document.createElement("canvas")` cannot be unit-tested and must not run at module load time. Canvas work goes inside functions; the pure logic around it (coordinate mapping, placement lists, height fields, geometry factories) is what gets tested.
- **Determinism.** Every scatter is seeded from a fixed constant via `mulberry32` (`web/src/themes/shared/util.ts`) so a reload or a snapshot replay never reshuffles the scenery. Never call `Math.random()` in placement code.
- **`HILLS` keeps its name, contents and shape.** `web/test/farm-turbines.test.ts` re-derives the hill surface from it to pin the turbines' blade clearance. It changes file, and nothing else.
- **`mergeGeometries` returns `null` when its inputs mix indexed and non-indexed geometry**, and a null geometry crashes the renderer on the first frame. `BoxGeometry`, `CylinderGeometry` and `ConeGeometry` are indexed; `IcosahedronGeometry` (and every other `PolyhedronGeometry`) is not. Never merge across that line without `.toNonIndexed()`. This is why every geometry factory below gets a validity test.
- After every task: `npm run typecheck && npm run lint && npm test` must pass.
- Run `npm run format` before committing.

## File Structure

| File                                | Responsibility                                                                                                                      |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `web/src/themes/farm/layout.ts`     | **Modify.** Gains `TURF_RADIUS` (shared by `terrain.ts` and `landscape.ts`; it lives here so those two need not import each other). |
| `web/src/themes/farm/terrain.ts`    | **Create.** The shape of the ground: `FLAT`, `AMPLITUDE`, `HILLS`, `FAR_HILLS`, `groundHeight`, `turfGeometry`, `createTerrain`.    |
| `web/src/themes/farm/landscape.ts`  | **Create.** The ground overlay canvas: parcels, mowing stripes, the dirt lane, the barnyard apron.                                  |
| `web/src/themes/farm/scenery.ts`    | **Create.** Trees (moved), hedgerows, the far tree line, `blobShadow` (moved).                                                      |
| `web/src/themes/farm/props.ts`      | **Create.** Boulders, grass tufts, scrub, hay bales, barnyard clutter.                                                              |
| `web/src/themes/farm/field.ts`      | **Modify.** Shrinks to the field and the farmstead: furrows, soil strips, barn, silo, fence, chimney smoke, weathervane.            |
| `web/src/themes/farm/palette.ts`    | **Modify.** New scenery colors.                                                                                                     |
| `web/src/themes/farm/sky.ts`        | **Modify.** Cloud shadows fade out before they reach rolling ground.                                                                |
| `web/src/themes/farm/index.ts`      | **Modify.** Calls `createTerrain`, `createScenery`, `createProps` alongside `createField`.                                          |
| `web/src/themes/shared/textures.ts` | **Modify.** `mottledTexture` gains a `repeat` argument and wraps its blotches.                                                      |
| `web/test/farm-terrain.test.ts`     | **Create.** The height field's flat-zone and amplitude contracts; the turf geometry.                                                |
| `web/test/farm-landscape.test.ts`   | **Create.** The world→canvas coordinate mapping.                                                                                    |
| `web/test/farm-scenery.test.ts`     | **Create.** Hedge and far-tree-line geometry.                                                                                       |
| `web/test/farm-props.test.ts`       | **Create.** Prop geometry validity and placement safety.                                                                            |
| `web/test/farm-sky.test.ts`         | **Create.** The cloud-shadow opacity ramp.                                                                                          |
| `web/test/farm-turbines.test.ts`    | **Modify.** The `HILLS` import path, and nothing else.                                                                              |

---

### Task 1: The height field

The pure core: a `groundHeight(x, z)` that is **exactly zero** wherever something stands on the ground, and rolls elsewhere. Nothing renders yet — this task creates the module and moves `HILLS` into it.

**Files:**

- Create: `web/src/themes/farm/terrain.ts`
- Modify: `web/src/themes/farm/layout.ts`
- Modify: `web/src/themes/farm/field.ts` (delete the local `HILLS`; import it instead)
- Modify: `web/test/farm-turbines.test.ts` (import path only)
- Test: `web/test/farm-terrain.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces:
  - `TURF_RADIUS: number` — 140, exported from `./layout.js`.
  - `FLAT: { halfX: number; centerZ: number; halfZ: number }`
  - `AMPLITUDE: number` — 1.2
  - `HILLS: ReadonlyArray<readonly [number, number, number]>` — unchanged contents, new home.
  - `FAR_HILLS: ReadonlyArray<readonly [number, number, number]>`
  - `groundHeight(x: number, z: number): number`

- [ ] **Step 1: Write the failing test**

Create `web/test/farm-terrain.test.ts`:

```ts
import { expect, test } from "vitest";
import { AMPLITUDE, FAR_HILLS, FLAT, groundHeight, HILLS } from "../src/themes/farm/terrain.js";
import { FIELD, rowZ, TURF_RADIUS } from "../src/themes/farm/layout.js";

// Every system that sits on the turf — the crops, the tractor, the chickens, the
// fence, the furrow plane, the soil strips, every blobShadow — is placed at a
// hard-coded y and never samples a ground height. If the ground rolls under any
// of them they float or sink. These are the points that must stay dead flat.
test("the ground is exactly flat everywhere the farm stands on it", () => {
  // the whole field, row by row, out to the tractor's headland turns (EDGE_X = 24)
  for (let row = 0; row < FIELD.rows; row++) {
    for (let x = -24; x <= 24; x += 2) {
      expect(groundHeight(x, rowZ(row))).toBe(0);
    }
  }
  const seats: ReadonlyArray<readonly [number, number]> = [
    [-23, rowZ(0) + 2.8], // fence, west end
    [23, rowZ(0) + 2.8], // fence, east end
    [-13.5, -28.3], // barn, far corner
    [-6.5, -23.7], // barn, near corner
    [-4.6, -26], // silo
    [-17.5, -26.5], // chicken yard, far corner
    [-10.5, -19.5], // chicken yard, near corner
  ];
  for (const [x, z] of seats) {
    expect(groundHeight(x, z)).toBe(0);
  }
});

// The hills are squashed spheres sunk to their equator, so their lower hemisphere
// is buried under the turf. Ground that rises at a hill's fringe pokes through
// the dome; ground that dips there exposes the dome's back-facing underside,
// which is culled and reads as a hole.
test("the ground is exactly flat under every hill", () => {
  for (const [hx, hz, r] of [...HILLS, ...FAR_HILLS]) {
    for (const [dx, dz] of [
      [0, 0],
      [0.9, 0],
      [-0.9, 0],
      [0, 0.9],
      [0, -0.9],
    ]) {
      expect(groundHeight(hx + dx * 1.3 * r, hz + dz * r)).toBe(0);
    }
  }
});

// A wavy disc rim reads as a torn paper edge against the sky.
test("the ground is exactly flat at the disc rim", () => {
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
    expect(groundHeight(Math.cos(a) * (TURF_RADIUS - 5), Math.sin(a) * (TURF_RADIUS - 5))).toBe(0);
  }
});

// A damping bug that flattened the whole disc would satisfy every test above.
test("the ground actually rolls in the wings", () => {
  let peak = 0;
  for (let x = -90; x <= 90; x += 3) {
    for (let z = -60; z <= 60; z += 3) {
      peak = Math.max(peak, Math.abs(groundHeight(x, z)));
    }
  }
  expect(peak).toBeGreaterThan(0.4);
});

test("the ground never exceeds the stated amplitude", () => {
  for (let x = -TURF_RADIUS; x <= TURF_RADIUS; x += 2) {
    for (let z = -TURF_RADIUS; z <= TURF_RADIUS; z += 2) {
      const y = groundHeight(x, z);
      expect(Number.isFinite(y)).toBe(true);
      expect(Math.abs(y)).toBeLessThanOrEqual(AMPLITUDE);
    }
  }
});

test("the flat zone contains the farm with margin", () => {
  expect(FLAT.halfX).toBeGreaterThan(24); // the tractor's headland turns
  expect(FLAT.centerZ + FLAT.halfZ).toBeGreaterThan(rowZ(0) + 2.8); // the fence
  expect(FLAT.centerZ - FLAT.halfZ).toBeLessThan(-28.3); // the barn's far wall
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run web/test/farm-terrain.test.ts`

Expected: FAIL — `Failed to resolve import "../src/themes/farm/terrain.js"`.

- [ ] **Step 3: Add `TURF_RADIUS` to `layout.ts`**

Append to `web/src/themes/farm/layout.ts`:

```ts
/** Radius of the turf disc. Past this, a prop floats over open sky. It lives here
 *  rather than in terrain.ts so that terrain.ts and landscape.ts — which both need
 *  it — do not have to import each other. */
export const TURF_RADIUS = 140;
```

- [ ] **Step 4: Create `terrain.ts`**

Create `web/src/themes/farm/terrain.ts`:

```ts
import * as THREE from "three";
import { TURF_RADIUS } from "./layout.js";

/**
 * Ground inside this box stays **exactly** at y = 0. Every system that sits on
 * the turf — the crops, the tractor (headlands at x = ±24), the chickens, the
 * fence (z ≈ 22.8), the furrow plane, the soil strips, every blobShadow — is
 * placed at a hard-coded y and never samples a ground height. Sized to hold the
 * barn's far wall (z ≈ −28.3) with margin.
 */
export const FLAT = { halfX: 26, centerZ: -3, halfZ: 29 } as const;

/** Peak rise (and fall) of the rolling ground outside the flat zone. */
export const AMPLITUDE = 1.2;

/**
 * Squashed-sphere hills on the horizon: [x, z, r]. Exported so tests can check
 * scenery clearance (e.g. a turbine's lowest blade tip against the hill it
 * stands on) without duplicating these numbers.
 */
export const HILLS: ReadonlyArray<readonly [number, number, number]> = [
  [-55, -85, 48],
  [8, -95, 56],
  [62, -78, 42],
];

/**
 * A second, lower and hazier rank behind HILLS, for depth on the horizon. Kept
 * separate so the turbine clearance contract — which reasons about HILLS alone —
 * is untouched. Both ranks flatten the ground beneath them.
 */
export const FAR_HILLS: ReadonlyArray<readonly [number, number, number]> = [
  [-105, -108, 55],
  [-15, -138, 72],
  [88, -118, 50],
];

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Three sines at falling wavelengths — roughly 60, 34 and 19 units — summing to
 * exactly [−1, 1] (0.6 + 0.28 + 0.12). Long enough to read as land rather than
 * corrugation at a camera 11 units up, short enough to fit several humps into
 * the wings either side of the field.
 */
function noise(x: number, z: number): number {
  return (
    Math.sin(x * 0.105 + 1.7) * Math.cos(z * 0.092 - 0.4) * 0.6 +
    Math.sin((x + z) * 0.11 + 3.1) * 0.28 +
    Math.sin(x * 0.19 - 2.2) * Math.sin(z * 0.17 + 0.9) * 0.12
  );
}

/** How much of the noise survives at (x, z) — zero wherever the ground must be flat. */
function damp(x: number, z: number): number {
  // The farm itself. Chebyshev, not Euclidean, so the flat region is the
  // rectangle the farm occupies rather than a circle circumscribing it.
  const inner = smoothstep(
    1,
    1.6,
    Math.max(Math.abs(x) / FLAT.halfX, Math.abs(z - FLAT.centerZ) / FLAT.halfZ)
  );

  // The hills are squashed spheres sunk to their equator, so their lower half is
  // buried. Ground that rises at a fringe pokes through the dome; ground that
  // dips there exposes the dome's culled underside and reads as a hole. Flatten
  // out well clear of every footprint.
  let hillMask = 1;
  for (const [hx, hz, r] of [...HILLS, ...FAR_HILLS]) {
    const e = Math.hypot((x - hx) / (1.3 * r), (z - hz) / r);
    hillMask = Math.min(hillMask, smoothstep(1.05, 1.2, e));
  }

  // The disc's rim is the horizon silhouette against the sky; a wavy rim reads
  // as a torn edge.
  const rimFade = 1 - smoothstep(TURF_RADIUS - 45, TURF_RADIUS - 20, Math.hypot(x, z));

  return inner * hillMask * rimFade;
}

/**
 * Height of the turf at (x, z). The vertices are displaced by this exact
 * function, so a prop that seats itself with it stands on the surface the
 * renderer draws rather than on an approximation of it.
 */
export function groundHeight(x: number, z: number): number {
  return AMPLITUDE * noise(x, z) * damp(x, z);
}
```

- [ ] **Step 5: Move `HILLS` out of `field.ts`**

In `web/src/themes/farm/field.ts`, **delete** the exported `HILLS` constant (the block whose comment begins "Squashed-sphere hills on the horizon", currently around lines 484–489) and import it instead. Add to the imports at the top:

```ts
import { HILLS } from "./terrain.js";
```

`addHills` stays in `field.ts` for now — Task 2 moves it. It reads `HILLS`, so it keeps working.

- [ ] **Step 6: Update the turbine test's import**

In `web/test/farm-turbines.test.ts`, change line 3 from:

```ts
import { HILLS } from "../src/themes/farm/field.js";
```

to:

```ts
import { HILLS } from "../src/themes/farm/terrain.js";
```

Nothing else in that file changes — its assertions are the contract we are preserving.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run web/test/farm-terrain.test.ts web/test/farm-turbines.test.ts`

Expected: PASS, every test in both files.

If "the ground actually rolls in the wings" fails, the damping is too aggressive — most likely `hillMask` reaching further than intended. If a flat-zone test fails, `FLAT` is too small for the point that failed.

- [ ] **Step 8: Full verification and commit**

```bash
npm run typecheck && npm run lint && npm test && npm run format
git add web/src/themes/farm/terrain.ts web/src/themes/farm/layout.ts web/src/themes/farm/field.ts web/test/farm-terrain.test.ts web/test/farm-turbines.test.ts
git commit -m "Add the farm's ground height field

A pure groundHeight(x, z), damped to exactly zero over the box the farm
occupies and again under the hills, whose buried lower hemispheres cannot
tolerate ground that rises or dips at their fringe. HILLS moves to
terrain.ts; its contents and its turbine-clearance contract are unchanged."
```

---

### Task 2: The displaced turf disc, with grain

Replace the flat, effectively-untextured turf with a subdivided disc displaced by `groundHeight`, carrying a mottled texture that actually tiles. Move the hills in, and add the far rank.

**Files:**

- Modify: `web/src/themes/shared/textures.ts`
- Modify: `web/src/themes/farm/terrain.ts`
- Modify: `web/src/themes/farm/field.ts` (delete the turf mesh and `addHills`)
- Modify: `web/src/themes/farm/palette.ts`
- Modify: `web/src/themes/farm/index.ts`
- Test: `web/test/farm-terrain.test.ts` (extend)

**Interfaces:**

- Consumes: `groundHeight`, `AMPLITUDE`, `HILLS`, `FAR_HILLS` (Task 1); `TURF_RADIUS` from `./layout.js`.
- Produces:
  - `mottledTexture(base, light, dark, strength?, repeat?): THREE.CanvasTexture` — `repeat` defaults to `1` (no wrapping), so the grove's call site is unchanged.
  - `turfGeometry(): THREE.BufferGeometry` — the displaced disc, already lying in the XZ plane (y is up, no mesh rotation needed). Exported for testing.
  - `createTerrain(scene: THREE.Scene): void`
  - `FARM.hillFar`

- [ ] **Step 1: Write the failing test**

In `web/test/farm-terrain.test.ts`, add `turfGeometry` to the existing `terrain.js` import so it reads:

```ts
import {
  AMPLITUDE,
  FAR_HILLS,
  FLAT,
  groundHeight,
  HILLS,
  turfGeometry,
} from "../src/themes/farm/terrain.js";
```

and append this test to the end of the file:

```ts
// The disc is a RingGeometry rotated flat at build time, so its position
// attribute is already world-space: y is height, and the mesh needs no rotation.
test("the turf geometry is a flat-lying, displaced disc", () => {
  const geo = turfGeometry();
  const pos = geo.getAttribute("position");
  // subdivided, not the 48-triangle fan a CircleGeometry would give
  expect(pos.count).toBeGreaterThan(1000);

  let peak = 0;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    expect(Number.isFinite(y)).toBe(true);
    // every vertex sits on the height field the props seat themselves with
    expect(y).toBeCloseTo(groundHeight(x, z), 6);
    expect(Math.hypot(x, z)).toBeLessThanOrEqual(TURF_RADIUS + 0.001);
    peak = Math.max(peak, Math.abs(y));
  }
  expect(peak).toBeGreaterThan(0.4); // it is actually displaced
  expect(peak).toBeLessThanOrEqual(AMPLITUDE);

  // normals must be recomputed after displacement, or the rolling ground is lit
  // as though it were still flat and the roll is invisible
  const nrm = geo.getAttribute("normal");
  let tilted = false;
  for (let i = 0; i < nrm.count; i++) {
    if (Math.abs(nrm.getY(i)) < 0.999) tilted = true;
  }
  expect(tilted).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run web/test/farm-terrain.test.ts`

Expected: FAIL — `turfGeometry is not a function` (no such export yet).

- [ ] **Step 3: Give `mottledTexture` a repeat**

In `web/src/themes/shared/textures.ts`, replace the whole `mottledTexture` function with:

```ts
/**
 * A base color flecked with soft lighter/darker blotches, for use as a ground
 * `map` so a large flat disc reads as a varied surface instead of felt. Set the
 * material color to white so the texture supplies the color.
 *
 * `repeat` > 1 tiles the texture across the surface. Without it, a single canvas
 * stretched over a 280-unit disc has no grain at all and the ground reads as one
 * flat mat. Each blotch is drawn nine times — offset by ±1 tile in each axis — so
 * that it wraps continuously; drawn once it would be clipped at the canvas edge
 * and every tile boundary would show as a seam.
 */
export function mottledTexture(
  base: number,
  light: number,
  dark: number,
  strength = 1,
  repeat = 1
): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = hex(base);
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 220; i++) {
    const r = 12 + Math.random() * 70;
    const x = Math.random() * size;
    const y = Math.random() * size;
    const color = Math.random() < 0.5 ? hex(light) : hex(dark);
    ctx.globalAlpha = Math.min(1, (0.1 + Math.random() * 0.16) * strength);
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        const grad = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        grad.addColorStop(0, color);
        grad.addColorStop(1, "transparent");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat !== 1) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat, repeat);
  }
  return tex;
}
```

The grove's call (`grove/ground.ts:19`) passes four arguments and is unchanged: it gets `repeat = 1` and no wrapping.

- [ ] **Step 4: Add the far-hill color**

In `web/src/themes/farm/palette.ts`, add to `FARM`, on the line after `hill`:

```ts
  hillFar: 0x9db5a2,
```

- [ ] **Step 5: Build the terrain**

In `web/src/themes/farm/terrain.ts`, add to the imports at the top:

```ts
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { FARM } from "./palette.js";
import { mottledTexture } from "../shared/textures.js";
```

and append to the file:

```ts
/**
 * The turf disc, displaced by `groundHeight`. A `RingGeometry`, not a
 * `CircleGeometry`: a circle is a single triangle fan with no radial
 * subdivision, so there is nothing between its centre and its rim to displace.
 * The ring is rotated flat at build time, so its positions are already
 * world-space and the mesh it goes into needs no rotation of its own.
 */
export function turfGeometry(): THREE.BufferGeometry {
  const geo = new THREE.RingGeometry(0, TURF_RADIUS, 128, 72);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, groundHeight(pos.getX(i), pos.getZ(i)));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** One rank of hazy hills. `squash` is the y-scale; flatter reads as further off. */
function addHills(
  scene: THREE.Scene,
  rank: ReadonlyArray<readonly [number, number, number]>,
  squash: number,
  color: number
): void {
  const hills: THREE.BufferGeometry[] = [];
  for (const [x, z, r] of rank) {
    const hill = new THREE.SphereGeometry(r, 20, 10);
    hill.scale(1.3, squash, 1);
    hill.translate(x, 0, z);
    hills.push(hill);
  }
  scene.add(
    new THREE.Mesh(mergeGeometries(hills), new THREE.MeshStandardMaterial({ color, roughness: 1 }))
  );
}

/** The ground: the rolling turf disc and the two ranks of hills behind it. */
export function createTerrain(scene: THREE.Scene): void {
  scene.add(
    new THREE.Mesh(
      turfGeometry(),
      new THREE.MeshStandardMaterial({
        // repeat, or a single canvas stretched across 280 units has no grain at
        // all and the whole disc reads as one flat green mat
        map: mottledTexture(FARM.turf, 0x8fbf72, 0x5e8348, 1, 22),
        roughness: 1,
      })
    )
  );

  // the far rank first, so the near hills draw over it
  addHills(scene, FAR_HILLS, 0.1, FARM.hillFar);
  addHills(scene, HILLS, 0.16, FARM.hill);
}
```

- [ ] **Step 6: Strip the turf and the hills out of `field.ts`**

In `web/src/themes/farm/field.ts`:

1. Delete the `addHills` function (the block commented "Hazy hills on the horizon; the fog does most of the softening").
2. In `createField`, delete the `turf` mesh — the `const turf = new THREE.Mesh(new THREE.CircleGeometry(140, 48), ...)` block, its `turf.rotation.x` line and its `scene.add(turf)` — and the `addHills(scene);` call.
3. Delete the now-unused `HILLS` import added in Task 1, and drop `mottledTexture` from the `../shared/textures.js` import (leaving `furrowTexture` and `glowTexture`).

`createField` keeps the furrow plane, the soil strips, the barn, the silo, the fence, the trees, the blob shadows and the smoke. (The trees move out in Task 4.)

- [ ] **Step 7: Call `createTerrain` from `index.ts`**

In `web/src/themes/farm/index.ts`, add the import:

```ts
import { createTerrain } from "./terrain.js";
```

and in `start()`, call it immediately **before** `createField` — the ground has to exist before the field is laid on it:

```ts
const sky = createFarmSky(scene);
createTerrain(scene);
const field = createField(scene, reducedMotion);
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run web/test/farm-terrain.test.ts`

Expected: PASS, including "the turf geometry is a flat-lying, displaced disc".

- [ ] **Step 9: Full verification and commit**

```bash
npm run typecheck && npm run lint && npm test && npm run format
git add web/src/themes/shared/textures.ts web/src/themes/farm/terrain.ts web/src/themes/farm/field.ts web/src/themes/farm/palette.ts web/src/themes/farm/index.ts web/test/farm-terrain.test.ts
git commit -m "Roll and grain the farm's turf

The mottled ground texture was stretched once across the whole 280-unit
disc and so had no grain at all; it now tiles, with wrapped blotches so
the tiling does not seam. The disc becomes a subdivided ring displaced by
groundHeight, and a second, hazier rank of hills sits behind the first."
```

---

### Task 3: The landscape overlay — parcels, lane and barnyard

A transparent canvas draped on a clone of the displaced turf, carrying everything painted rather than built: neighbouring parcels in low-contrast tones, mowing stripes, a rutted lane out of the barn doors, and the worn earth the farmstead stands in.

**Files:**

- Create: `web/src/themes/farm/landscape.ts`
- Modify: `web/src/themes/farm/terrain.ts` (drape the overlay)
- Test: `web/test/farm-landscape.test.ts`

**Interfaces:**

- Consumes: `TURF_RADIUS` from `./layout.js`; `mulberry32` from `../shared/util.js`.
- Produces:
  - `CANVAS_SIZE: number` — 2048.
  - `toPx(world: number): number` — a world coordinate → a canvas pixel, on either axis.
  - `landscapeTexture(): THREE.CanvasTexture` — touches `document`, so it is only ever called from `createTerrain` at scene construction, never at module load.

- [ ] **Step 1: Write the failing test**

Create `web/test/farm-landscape.test.ts`:

```ts
import { expect, test } from "vitest";
import { CANVAS_SIZE, toPx } from "../src/themes/farm/landscape.js";
import { TURF_RADIUS } from "../src/themes/farm/layout.js";

// The overlay rides the turf's RingGeometry UVs, which span the disc's bounding
// square: u = (x / 140 + 1) / 2 and v = (−z / 140 + 1) / 2. CanvasTexture flips
// v, and that flip cancels the sign, so the canvas is a plain north-up map —
// x = −140 at the left edge, z = −140 (the hills) at the top — and one toPx()
// serves both axes. Getting this backwards paints the barnyard on the wrong side
// of the field, so it is pinned here rather than discovered on screen.
test("toPx maps the disc's bounding square onto the canvas", () => {
  expect(toPx(-TURF_RADIUS)).toBe(0);
  expect(toPx(TURF_RADIUS)).toBe(CANVAS_SIZE);
  expect(toPx(0)).toBe(CANVAS_SIZE / 2);
});

test("toPx is linear and increasing", () => {
  const scale = CANVAS_SIZE / (TURF_RADIUS * 2);
  expect(toPx(10) - toPx(0)).toBeCloseTo(10 * scale, 6);
  expect(toPx(-30) - toPx(-40)).toBeCloseTo(10 * scale, 6);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run web/test/farm-landscape.test.ts`

Expected: FAIL — `Failed to resolve import "../src/themes/farm/landscape.js"`.

- [ ] **Step 3: Write `landscape.ts`**

Create `web/src/themes/farm/landscape.ts`:

```ts
import * as THREE from "three";
import { TURF_RADIUS } from "./layout.js";
import { mulberry32 } from "../shared/util.js";

/** Fixed seed — the countryside must be identical on every reload and replay. */
const SEED = 0x5eedfa12;

export const CANVAS_SIZE = 2048;

const SPAN = TURF_RADIUS * 2;

/**
 * A world coordinate → a canvas pixel, on either axis. The turf's RingGeometry
 * UVs span the disc's bounding square, and CanvasTexture's v-flip cancels the
 * sign flip between the ring's local y and world z, so the canvas is a plain
 * north-up map: x = −140 at the left edge, z = −140 (the hills) at the top.
 */
export function toPx(world: number): number {
  return ((world + TURF_RADIUS) / SPAN) * CANVAS_SIZE;
}

/** A world length → canvas pixels. */
function scalePx(length: number): number {
  return (length / SPAN) * CANVAS_SIZE;
}

/**
 * A neighbouring field: a patch a few percent off the turf's tone, combed with
 * mowing stripes at its own angle. The body is blurred so the parcel has no hard
 * border, but the stripes are clipped square — mowing really does stop dead at a
 * field boundary, and that crispness is what reads as "worked".
 */
function paintParcel(
  ctx: CanvasRenderingContext2D,
  rand: () => number,
  cx: number,
  cz: number,
  w: number,
  d: number
): void {
  const W = scalePx(w);
  const D = scalePx(d);
  const light = rand() < 0.5;

  ctx.save();
  ctx.translate(toPx(cx), toPx(cz));
  ctx.rotate((rand() - 0.5) * 0.5);

  ctx.filter = "blur(18px)";
  ctx.fillStyle = light ? "rgba(190,214,150,0.15)" : "rgba(74,102,58,0.15)";
  ctx.fillRect(-W / 2, -D / 2, W, D);
  ctx.filter = "none";

  ctx.beginPath();
  ctx.rect(-W / 2, -D / 2, W, D);
  ctx.clip();
  ctx.rotate(rand() * Math.PI);
  ctx.fillStyle = light ? "rgba(255,255,255,0.05)" : "rgba(30,50,24,0.06)";
  const pitch = 14 + rand() * 18;
  const reach = Math.max(W, D);
  for (let s = -reach; s < reach; s += pitch * 2) {
    ctx.fillRect(s, -reach, pitch, reach * 2);
  }
  ctx.restore();
}

/**
 * Parcels on the wings and beyond the barn, as [cx, cz, w, d]. All of them clear
 * of the field itself (x ∈ [−26, 26], z ∈ [−32, 26]): the crop rows are the
 * subject and nothing may be painted under them.
 */
const PARCELS: ReadonlyArray<readonly [number, number, number, number]> = [
  [-56, 6, 40, 34],
  [-58, -34, 44, 30],
  [-50, 44, 36, 28],
  [-88, 10, 34, 44],
  [56, 4, 42, 36],
  [60, -36, 38, 30],
  [50, 46, 34, 26],
  [92, 12, 32, 42],
  [0, -54, 54, 26],
  [-30, 52, 40, 26],
  [34, 54, 38, 24],
];

/**
 * The lane out of the barn doors, running east along the field's far headland
 * and away toward the horizon. [x, z] control points. It threads the corridor
 * between the barn's front wall (z ≈ −23.7) and the field's far soil strip
 * (z ≈ −19.6) — which is exactly where a farm lane belongs — so the z values
 * near the barn are tightly constrained and should not be nudged casually.
 */
const LANE: ReadonlyArray<readonly [number, number]> = [
  [-9, -21.3],
  [4, -22],
  [22, -22.6],
  [40, -22.2],
  [68, -24.6],
  [104, -30],
  [128, -33],
];

/** Trace the lane's centreline; the caller strokes it. */
function lanePath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(toPx(LANE[0][0]), toPx(LANE[0][1]));
  for (let i = 1; i < LANE.length - 1; i++) {
    const [x, z] = LANE[i];
    const [nx, nz] = LANE[i + 1];
    ctx.quadraticCurveTo(toPx(x), toPx(z), toPx((x + nx) / 2), toPx((z + nz) / 2));
  }
  const last = LANE[LANE.length - 1];
  ctx.lineTo(toPx(last[0]), toPx(last[1]));
}

/**
 * The overlay: everything about the landscape that is painted rather than built.
 * Draped on a clone of the turf's displaced geometry so it follows the rolling
 * ground instead of z-fighting a flat plane against it.
 *
 * Creates a canvas, so it must only ever be called at scene construction — never
 * at module load. The tests run in node, where there is no `document`.
 */
export function landscapeTexture(): THREE.CanvasTexture {
  const rand = mulberry32(SEED);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext("2d")!;

  for (const [cx, cz, w, d] of PARCELS) {
    paintParcel(ctx, rand, cx, cz, w, d);
  }

  // the lane: a soft band of dust, then two worn ruts inside it
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.filter = "blur(9px)";
  ctx.strokeStyle = "rgba(138,115,85,0.42)";
  ctx.lineWidth = scalePx(3.4);
  lanePath(ctx);
  ctx.stroke();
  ctx.filter = "blur(2px)";
  ctx.strokeStyle = "rgba(104,84,60,0.5)";
  ctx.lineWidth = scalePx(0.7);
  for (const offset of [-0.9, 0.9]) {
    ctx.save();
    ctx.translate(0, scalePx(offset));
    lanePath(ctx);
    ctx.stroke();
    ctx.restore();
  }

  // the barnyard: packed bare earth under the barn and the silo, feathered into
  // the turf, with an apron fanning out from the doors. Worn ground is what makes
  // the farmstead read as worked in rather than set down on a lawn.
  ctx.filter = "blur(16px)";
  ctx.fillStyle = "rgba(146,122,90,0.55)";
  for (const [x, z, rx, rz] of [
    [-10, -26, 7.5, 5.5], // the barn
    [-4.6, -26, 3.6, 3.6], // the silo
    [-9, -21.5, 8.5, 4], // the apron in front of the doors
  ] as ReadonlyArray<readonly [number, number, number, number]>) {
    ctx.save();
    ctx.translate(toPx(x), toPx(z));
    ctx.scale(scalePx(rx), scalePx(rz));
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.filter = "none";

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
```

`ctx.filter` is what feathers the parcels, the ruts and the apron. It is supported everywhere the app already runs (Chrome, Firefox, Safari 18+); on an older engine it is silently ignored and the patches come out crisp-edged rather than soft — degraded, but not broken.

- [ ] **Step 4: Drape the overlay in `createTerrain`**

In `web/src/themes/farm/terrain.ts`, add the import:

```ts
import { landscapeTexture } from "./landscape.js";
```

and replace `createTerrain` with this version, which shares one geometry between the turf and the overlay:

```ts
/** The ground: the rolling turf disc, the painted landscape draped on it, and the
 *  two ranks of hills behind. */
export function createTerrain(scene: THREE.Scene): void {
  const geo = turfGeometry();

  scene.add(
    new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        // repeat, or a single canvas stretched across 280 units has no grain at
        // all and the whole disc reads as one flat green mat
        map: mottledTexture(FARM.turf, 0x8fbf72, 0x5e8348, 1, 22),
        roughness: 1,
      })
    )
  );

  // The parcels, the lane and the barnyard, on a clone of the same displaced
  // surface so the overlay drapes with the ground rather than z-fighting a flat
  // plane against it. Lit (not Basic), so it dims and warms with the sun exactly
  // as the turf beneath it does. polygonOffset guards the two near-coincident
  // surfaces against depth flicker out at the far end of the disc.
  scene.add(
    new THREE.Mesh(
      geo.clone().translate(0, 0.02, 0),
      new THREE.MeshStandardMaterial({
        map: landscapeTexture(),
        transparent: true,
        depthWrite: false,
        roughness: 1,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      })
    )
  );

  // the far rank first, so the near hills draw over it
  addHills(scene, FAR_HILLS, 0.1, FARM.hillFar);
  addHills(scene, HILLS, 0.16, FARM.hill);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run web/test/farm-landscape.test.ts`

Expected: PASS, both tests.

- [ ] **Step 6: Look at it**

The canvas itself cannot be unit-tested — there is no DOM in vitest — so it gets checked by eye. With `npm run dev:web` running, open `http://localhost:5173/?theme=farm&demo=1`.

Confirm: the barn and silo stand on packed earth rather than lawn; the lane leaves the barn doors heading east and threads between the barn and the field without touching either; the parcels read as tone rather than as rectangles with hard borders; nothing is painted under the crop rows.

- [ ] **Step 7: Full verification and commit**

```bash
npm run typecheck && npm run lint && npm test && npm run format
git add web/src/themes/farm/landscape.ts web/src/themes/farm/terrain.ts web/test/farm-landscape.test.ts
git commit -m "Paint the farm's parcels, lane and barnyard

A transparent canvas draped on a clone of the turf's displaced geometry:
neighbouring parcels in low-contrast tones with their own mowing stripes,
a rutted lane out of the barn doors, and the worn earth the barn and silo
stand in."
```

---

### Task 4: Trees, hedgerows and the far tree line

Move the trees out of `field.ts` and seat them on the ground they now stand on — several are in the wings, where the turf rolls. Add hedgerows to give the painted parcels a silhouette, and a distant tree line for depth.

**Files:**

- Create: `web/src/themes/farm/scenery.ts`
- Modify: `web/src/themes/farm/field.ts` (delete the trees and `blobShadow`)
- Modify: `web/src/themes/farm/palette.ts`
- Modify: `web/src/themes/farm/index.ts`
- Test: `web/test/farm-scenery.test.ts`

**Interfaces:**

- Consumes: `groundHeight` (Task 1); `FARM`; `mulberry32`; `glowTexture`.
- Produces:
  - `blobShadow(scene, map, x, z, w, d, opacity): void` — moved verbatim from `field.ts` and now exported; `field.ts` (barn, silo) and `props.ts` (bales) both use it.
  - `hedgeGeometry(): THREE.BufferGeometry` — one shrub, at the origin. Exported for testing.
  - `farTreeLineGeometry(): THREE.BufferGeometry` — the whole distant tree line, in world space. Exported for testing.
  - `createScenery(scene: THREE.Scene): void`

- [ ] **Step 1: Write the failing test**

Create `web/test/farm-scenery.test.ts`:

```ts
import { expect, test } from "vitest";
import { farTreeLineGeometry, hedgeGeometry } from "../src/themes/farm/scenery.js";
import { groundHeight } from "../src/themes/farm/terrain.js";
import { TURF_RADIUS } from "../src/themes/farm/layout.js";

// mergeGeometries returns null when its inputs mix indexed and non-indexed
// geometry; a null geometry crashes the renderer on the first frame.
test.each([
  ["hedge shrub", hedgeGeometry],
  ["far tree line", farTreeLineGeometry],
])("the %s geometry is valid and renderable", (_name, factory) => {
  const geometry = factory();
  expect(geometry).not.toBeNull();
  expect(geometry.getAttribute("position").count).toBeGreaterThan(0);
});

// The far tree line is scenery on the horizon: off the turf disc it floats over
// open sky, and on the disc it must sit on the ground rather than through it.
test("the far tree line stands on the turf, on the ground", () => {
  const pos = farTreeLineGeometry().getAttribute("position");
  let lowest = Infinity;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    expect(Math.hypot(x, z)).toBeLessThan(TURF_RADIUS);
    lowest = Math.min(lowest, pos.getY(i) - groundHeight(x, z));
  }
  // the lowest vertex of the whole line rests on, not below, the ground under it
  expect(lowest).toBeGreaterThanOrEqual(-0.01);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run web/test/farm-scenery.test.ts`

Expected: FAIL — `Failed to resolve import "../src/themes/farm/scenery.js"`.

- [ ] **Step 3: Add the new greens**

In `web/src/themes/farm/palette.ts`, add to `FARM`, after `treeCanopy`:

```ts
  hedge: 0x3f6b39,
  treeLineFar: 0x5b7d58,
```

- [ ] **Step 4: Create `scenery.ts`**

Create `web/src/themes/farm/scenery.ts` with these imports:

```ts
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { FARM } from "./palette.js";
import { groundHeight } from "./terrain.js";
import { glowTexture } from "../shared/textures.js";
import { mulberry32 } from "../shared/util.js";
```

Then **move into it, verbatim from `field.ts`**: the `TREES` constant, `canopyBase`, `paint`, `leafColor`, `makeConifer`, `makeBroadleaf`, `addTrees` and `blobShadow`. Export `blobShadow` (`props.ts` and `field.ts` both need it). Make exactly one change to the moved code — in `addTrees`, seat each tree on the ground:

```ts
for (const g of [trunk, canopy]) {
  g.scale(s, s, s);
  g.rotateZ(lean);
  g.rotateY(yaw);
  // several trees stand out in the wings, where the ground now rolls
  g.translate(x, groundHeight(x, z), z);
}
```

Then append the new scenery:

```ts
/** Fixed seed — the hedgerows must be identical on every reload and every replay. */
const HEDGE_SEED = 0x1cebead;

/** One shrub: a squat cluster of faceted blobs — the broadleaf canopy vocabulary
 *  at hedge scale. Exported for testing. */
export function hedgeGeometry(): THREE.BufferGeometry {
  const blobs: THREE.BufferGeometry[] = [];
  for (const [dx, dy, r] of [
    [0, 0.34, 0.5],
    [0.26, 0.22, 0.34],
    [-0.24, 0.2, 0.32],
  ] as ReadonlyArray<readonly [number, number, number]>) {
    const blob = new THREE.IcosahedronGeometry(r, 0);
    blob.scale(1, 0.8, 1);
    blob.translate(dx, dy, 0);
    blobs.push(blob);
  }
  return mergeGeometries(blobs);
}

/**
 * Hedgerows along the boundaries of the parcels painted in `landscape.ts`, so the
 * quilt gets a silhouette to go with its tone. Polylines of [x, z] in world space.
 *
 * Two things constrain these lines and neither is obvious from looking at them:
 * every one clears the hand-placed TREES (which occupy x ∈ [−42, −21] and
 * [21, 40]), and the two on the east side are split into segments with a gap
 * where the lane crosses — a hedge painted over the lane would be a hedge growing
 * through a road.
 */
const HEDGEROWS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  // west
  [
    [-50, 34],
    [-50, -36],
  ],
  [
    [-54, -38],
    [-92, -34],
  ],
  [
    [-88, 32],
    [-88, -30],
  ],
  [
    [-50, 38],
    [-84, 42],
  ],
  // east, with a gate gap for the lane (which passes x = 50 at z ≈ −23)
  [
    [50, 34],
    [50, -18],
  ],
  [
    [50, -30],
    [50, -40],
  ],
  [
    [54, -42],
    [92, -40],
  ],
  // east again; the lane passes x = 88 at z ≈ −28
  [
    [88, 32],
    [88, -18],
  ],
  [
    [88, -32],
    [88, -38],
  ],
  // the cross-hedge beyond the barn
  [
    [-30, -44],
    [30, -44],
  ],
];

/** Shrubs stepped along each hedgerow, jittered so the line reads as growth rather
 *  than a string of beads, and each seated on the ground it stands on. */
function addHedgerows(scene: THREE.Scene): void {
  const rand = mulberry32(HEDGE_SEED);
  const base = hedgeGeometry();
  const shrubs: THREE.BufferGeometry[] = [];
  const STEP = 1.5;
  for (const line of HEDGEROWS) {
    for (let i = 0; i + 1 < line.length; i++) {
      const [x0, z0] = line[i];
      const [x1, z1] = line[i + 1];
      const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / STEP));
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const x = x0 + (x1 - x0) * t + (rand() - 0.5) * 0.7;
        const z = z0 + (z1 - z0) * t + (rand() - 0.5) * 0.7;
        const shrub = base.clone();
        const s = 0.8 + rand() * 0.7;
        shrub.scale(s, s * (0.85 + rand() * 0.4), s);
        shrub.rotateY(rand() * Math.PI * 2);
        shrub.translate(x, groundHeight(x, z), z);
        shrubs.push(shrub);
      }
    }
  }
  scene.add(
    new THREE.Mesh(
      mergeGeometries(shrubs),
      new THREE.MeshStandardMaterial({ color: FARM.hedge, roughness: 0.95, flatShading: true })
    )
  );
}

/** Fixed seed — the far tree line must be identical on every reload and every replay. */
const TREE_LINE_SEED = 0xfa217e;

/**
 * A hazy band of treetops far behind the barn, either side of the hills: pure
 * silhouette, no trunk worth modelling at that distance. It fills the gap on the
 * horizon between the hedgerows and the hills. Exported for testing.
 */
export function farTreeLineGeometry(): THREE.BufferGeometry {
  const rand = mulberry32(TREE_LINE_SEED);
  const blobs: THREE.BufferGeometry[] = [];
  for (const [x0, x1, z] of [
    [-118, -62, -56],
    [-40, 40, -66],
    [66, 122, -52],
  ] as ReadonlyArray<readonly [number, number, number]>) {
    for (let x = x0; x <= x1; x += 2.6) {
      const jx = x + (rand() - 0.5) * 1.8;
      const jz = z + (rand() - 0.5) * 5;
      const r = 1.6 + rand() * 1.4;
      const blob = new THREE.IcosahedronGeometry(r, 0);
      blob.scale(1, 0.75 + rand() * 0.35, 1);
      // lift by less than the radius, so the crown's lowest vertex meets the
      // ground and it reads as a treetop rather than a floating ball
      blob.translate(jx, groundHeight(jx, jz) + r * 0.75, jz);
      blobs.push(blob);
    }
  }
  return mergeGeometries(blobs);
}

/** Trees, hedgerows and the far tree line — everything green that is not a crop. */
export function createScenery(scene: THREE.Scene): void {
  addTrees(scene);
  addHedgerows(scene);
  scene.add(
    new THREE.Mesh(
      farTreeLineGeometry(),
      new THREE.MeshStandardMaterial({
        color: FARM.treeLineFar,
        roughness: 1,
        flatShading: true,
      })
    )
  );

  // soft ground shadows, so the trees don't read as floating on the turf
  const shadowMap = glowTexture();
  for (const [tx, tz, s] of TREES) {
    blobShadow(scene, shadowMap, tx - 0.3 * s, tz + 0.25 * s, 2.6 * s, 2.6 * s, 0.3);
  }
}
```

Note that the tree shadows stay flat at `y = 0.03`, under trees that may now be standing on a rise. Blob shadows are soft radial gradients at 0.3 opacity and the trees that roll are 30–45 units out, so this should not show; if a shadow visibly cuts into a hummock during Step 8's check, give `blobShadow` an optional `y = 0.03` parameter and pass `groundHeight(x, z) + 0.03` rather than changing every call site.

- [ ] **Step 5: Strip the trees out of `field.ts`**

In `web/src/themes/farm/field.ts`:

1. Delete `TREES`, `canopyBase`, `paint`, `leafColor`, `makeConifer`, `makeBroadleaf`, `addTrees` and `blobShadow` — they live in `scenery.ts` now.
2. In `createField`, delete the `addTrees(scene);` call and the tree shadow loop (`for (const [tx, tz, s] of TREES)`). Keep the barn's and the silo's `blobShadow` calls.
3. Import `blobShadow` from `./scenery.js`:

```ts
import { blobShadow } from "./scenery.js";
```

4. Delete any import that is now unused — `mulberry32` will be one. `npm run lint` will name the rest.

- [ ] **Step 6: Call `createScenery` from `index.ts`**

In `web/src/themes/farm/index.ts`, add the import:

```ts
import { createScenery } from "./scenery.js";
```

and call it after `createField`:

```ts
const field = createField(scene, reducedMotion);
createScenery(scene);
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run web/test/farm-scenery.test.ts`

Expected: PASS, all three tests.

- [ ] **Step 8: Look at it**

With the dev server running, open `http://localhost:5173/?theme=farm&demo=1`. Confirm the hedgerows divide the wings and step around the lane rather than through it; the far tree line sits between the hedgerows and the hills; no tree floats above or sinks into a rise; and no tree shadow cuts into a slope.

- [ ] **Step 9: Full verification and commit**

```bash
npm run typecheck && npm run lint && npm test && npm run format
git add web/src/themes/farm/scenery.ts web/src/themes/farm/field.ts web/src/themes/farm/palette.ts web/src/themes/farm/index.ts web/test/farm-scenery.test.ts
git commit -m "Add farm hedgerows and a far tree line

Trees move out of field.ts into scenery.ts and are seated on the ground
they now stand on. Hedgerows give the painted parcels a silhouette, with
gate gaps where the lane crosses them, and a hazy tree line fills the gap
between them and the hills."
```

---

### Task 5: The scatter — boulders, tufts, scrub, bales and clutter

The small static props. Everything scattered comes from one seeded list, so a single test can prove nothing has landed where the tractor drives, the crops grow, or the barn stands.

**Files:**

- Create: `web/src/themes/farm/props.ts`
- Modify: `web/src/themes/farm/palette.ts`
- Modify: `web/src/themes/farm/index.ts`
- Test: `web/test/farm-props.test.ts`

**Interfaces:**

- Consumes: `groundHeight` (Task 1); `blobShadow` (Task 4); `FARM`; `mulberry32`; `glowTexture`; `FIELD`, `rowZ`, `TURF_RADIUS` from `./layout.js`.
- Produces:
  - `PropKind = "rock" | "tuft" | "scrub" | "bale"`
  - `Placement = { kind: PropKind; x: number; z: number; s: number; yaw: number }`
  - `propPlacements(): Placement[]` — the seeded scatter, pure. Exported for testing.
  - `rockGeometry()`, `tuftGeometry()`, `scrubGeometry()`, `baleGeometry()`, `clutterGeometry()` — all `(): THREE.BufferGeometry`. The first four are one prop at the origin; `clutterGeometry` is the whole barnyard, already in world space.
  - `createProps(scene: THREE.Scene): void`

- [ ] **Step 1: Write the failing test**

Create `web/test/farm-props.test.ts`:

```ts
import { expect, test } from "vitest";
import {
  baleGeometry,
  clutterGeometry,
  propPlacements,
  rockGeometry,
  scrubGeometry,
  tuftGeometry,
} from "../src/themes/farm/props.js";
import { FIELD, rowZ, TURF_RADIUS } from "../src/themes/farm/layout.js";

// mergeGeometries returns null when its inputs mix indexed and non-indexed
// geometry; a null geometry crashes the renderer on the first frame. Cones,
// cylinders and boxes are indexed; icosahedra are not.
test.each([
  ["rock", rockGeometry],
  ["tuft", tuftGeometry],
  ["scrub", scrubGeometry],
  ["bale", baleGeometry],
  ["clutter", clutterGeometry],
])("the %s geometry is valid and renderable", (_name, factory) => {
  const geometry = factory();
  expect(geometry).not.toBeNull();
  expect(geometry.getAttribute("position").count).toBeGreaterThan(0);
});

// A snapshot replay must not reshuffle the countryside.
test("the scatter is deterministic", () => {
  expect(propPlacements()).toEqual(propPlacements());
});

// A boulder in the crop rows gets planted through; one on the headland gets
// driven through. The tractor turns at x = ±24 and the rows span
// z ∈ [rowZ(47), rowZ(0)].
test("no prop stands where the tractor drives or the crops grow", () => {
  const near = rowZ(0) + 1.6; // the rows, plus the crops' z-jitter
  const far = rowZ(FIELD.rows - 1) - 1.6;
  for (const p of propPlacements()) {
    const inField = Math.abs(p.x) <= 25.5 && p.z <= near && p.z >= far;
    expect(inField, `${p.kind} at (${p.x}, ${p.z}) is in the field`).toBe(false);
  }
});

// The barn (x ∈ [−13.5, −6.5], z ∈ [−28.3, −23.7]) and the silo (x ≈ −4.6,
// z ≈ −26, r ≈ 1.5) are solid: a bale inside one is a bale inside a wall.
test("no scattered prop stands inside the barn or the silo", () => {
  for (const p of propPlacements()) {
    const inBarn = p.x >= -14.5 && p.x <= -5.5 && p.z >= -29 && p.z <= -23;
    const inSilo = Math.hypot(p.x + 4.6, p.z + 26) < 2.4;
    expect(inBarn || inSilo, `${p.kind} at (${p.x}, ${p.z})`).toBe(false);
  }
});

// The camera drifts at z ≈ 34, eleven units up, looking across the fence at the
// field. A boulder or a bale dropped into that corridor fills the frame. Tufts
// are exempt — they are ankle-high, and at the fence's foot they are exactly
// where they should be.
test("nothing but a tuft stands in the camera's foreground", () => {
  for (const p of propPlacements()) {
    if (p.kind === "tuft") continue;
    const inForeground = p.z > 20 && Math.abs(p.x) < 32;
    expect(inForeground, `${p.kind} at (${p.x}, ${p.z})`).toBe(false);
  }
});

test("every prop stands on the turf", () => {
  for (const p of propPlacements()) {
    expect(Math.hypot(p.x, p.z)).toBeLessThan(TURF_RADIUS);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run web/test/farm-props.test.ts`

Expected: FAIL — `Failed to resolve import "../src/themes/farm/props.js"`.

- [ ] **Step 3: Add the prop colors**

In `web/src/themes/farm/palette.ts`, add to `FARM`:

```ts
  rock: 0x8e8b84,
  tuft: 0x6f9a58,
  scrub: 0x5c7f46,
  hay: 0xd6c07c,
  wood: 0x8a6a45,
```

(The clutter — woodpile, trough, ladder, crates — is all weathered wood and shares `FARM.wood`, which keeps the whole barnyard to one draw call.)

- [ ] **Step 4: Create `props.ts`**

Create `web/src/themes/farm/props.ts`:

```ts
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { FIELD, rowZ, TURF_RADIUS } from "./layout.js";
import { FARM } from "./palette.js";
import { groundHeight } from "./terrain.js";
import { blobShadow } from "./scenery.js";
import { glowTexture } from "../shared/textures.js";
import { mulberry32 } from "../shared/util.js";

/** Fixed seed — the scatter must be identical on every reload and every replay. */
const SEED = 0xb01dea;

export type PropKind = "rock" | "tuft" | "scrub" | "bale";

export interface Placement {
  kind: PropKind;
  x: number;
  z: number;
  /** uniform scale */
  s: number;
  yaw: number;
}

/** The crop rows plus the tractor's headland turns (EDGE_X = 24). Anything
 *  scattered in here gets planted through or driven through. */
function inField(x: number, z: number): boolean {
  return Math.abs(x) <= 25.5 && z <= rowZ(0) + 1.6 && z >= rowZ(FIELD.rows - 1) - 1.6;
}

/** The barn and the silo are solid. */
function inFarmstead(x: number, z: number): boolean {
  const inBarn = x >= -14.5 && x <= -5.5 && z >= -29 && z <= -23;
  const inSilo = Math.hypot(x + 4.6, z + 26) < 2.4;
  return inBarn || inSilo;
}

/** The strip between the fence and the camera's drift path. Anything but an
 *  ankle-high tuft dropped in here fills the frame. */
function inForeground(kind: PropKind, x: number, z: number): boolean {
  return kind !== "tuft" && z > 20 && Math.abs(x) < 32;
}

/**
 * The seeded scatter. Rocks and tufts hug the field's edges and the fence line,
 * where they hide the seam between the turf and the things standing on it; scrub
 * and bales sit further out in the pasture. Pure, so a test can prove nothing has
 * landed anywhere it must not.
 */
export function propPlacements(): Placement[] {
  const rand = mulberry32(SEED);
  const out: Placement[] = [];

  const scatter = (kind: PropKind, count: number, reach: number, sMin: number, sMax: number) => {
    let placed = 0;
    // rejection sampling; the guard keeps a bad rejection rule from spinning
    for (let tries = 0; placed < count && tries < count * 80; tries++) {
      const a = rand() * Math.PI * 2;
      const r = 27 + rand() * reach;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (inField(x, z) || inFarmstead(x, z) || inForeground(kind, x, z)) continue;
      if (Math.hypot(x, z) > TURF_RADIUS - 12) continue;
      out.push({ kind, x, z, s: sMin + rand() * (sMax - sMin), yaw: rand() * Math.PI * 2 });
      placed++;
    }
  };

  scatter("rock", 26, 34, 0.6, 1.5);
  scatter("tuft", 150, 46, 0.7, 1.5);
  scatter("scrub", 34, 60, 0.8, 1.5);
  scatter("bale", 7, 30, 0.9, 1.1);

  // a stack of bales east of the silo, on the worn apron and clear of the lane
  for (const [x, z] of [
    [-1.6, -25.5],
    [-1.6, -23.9],
    [0.2, -24.7],
  ] as ReadonlyArray<readonly [number, number]>) {
    out.push({ kind: "bale", x, z, s: 1, yaw: rand() * 0.4 });
  }

  return out;
}

/** A faceted boulder, sunk to its waist so it sits in the ground, not on it. */
export function rockGeometry(): THREE.BufferGeometry {
  const rock = new THREE.IcosahedronGeometry(0.5, 0);
  rock.scale(1.25, 0.72, 1);
  rock.translate(0, 0.16, 0);
  return rock;
}

/** A tuft of grass: three blades leaning apart. */
export function tuftGeometry(): THREE.BufferGeometry {
  const blades: THREE.BufferGeometry[] = [];
  for (const [lean, yaw] of [
    [0.22, 0],
    [-0.26, 2.1],
    [0.1, 4.2],
  ] as ReadonlyArray<readonly [number, number]>) {
    const blade = new THREE.ConeGeometry(0.09, 0.5, 4);
    blade.translate(0, 0.25, 0);
    blade.rotateZ(lean);
    blade.rotateY(yaw);
    blades.push(blade);
  }
  return mergeGeometries(blades);
}

/** A low bush: two squat faceted blobs. */
export function scrubGeometry(): THREE.BufferGeometry {
  const blobs: THREE.BufferGeometry[] = [];
  for (const [dx, dy, r] of [
    [0, 0.26, 0.4],
    [0.22, 0.18, 0.26],
  ] as ReadonlyArray<readonly [number, number, number]>) {
    const blob = new THREE.IcosahedronGeometry(r, 0);
    blob.scale(1, 0.75, 1);
    blob.translate(dx, dy, 0);
    blobs.push(blob);
  }
  return mergeGeometries(blobs);
}

/** A round bale, lying on its side with its axis along x. */
export function baleGeometry(): THREE.BufferGeometry {
  const bale = new THREE.CylinderGeometry(0.62, 0.62, 1.25, 12);
  bale.rotateZ(Math.PI / 2);
  bale.translate(0, 0.62, 0);
  return bale;
}

/**
 * The barnyard clutter, already in world space: a woodpile against the barn's
 * west end, a water trough out past the chicken yard, a ladder leaning on the
 * front wall, and a pair of crates by the doors. Human-scale objects — they are
 * what give the barn its size.
 *
 * Every position here is threaded between things that are already there: the barn
 * (x ∈ [−13.5, −6.5], front wall at z ≈ −23.7), the silo (x ≈ −4.6, z ≈ −26,
 * r ≈ 1.5), the lane (z ≈ −21.5 in front of the doors), the chicken yard
 * (x ∈ [−17.5, −10.5], z ∈ [−26.5, −19.5]) and the field's far soil strip
 * (z ≈ −19.6). It all sits inside the flat zone, so a hard-coded y is the ground.
 */
export function clutterGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, ry = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    parts.push(g);
  };

  // woodpile: split logs stacked against the barn's west end (wall at x = −13.5)
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 5; i++) {
      const log = new THREE.CylinderGeometry(0.11, 0.11, 1.8, 6);
      log.rotateZ(Math.PI / 2);
      log.translate(-14.8, 0.12 + row * 0.23, -27.6 + i * 0.24 + (row % 2) * 0.12);
      parts.push(log);
    }
  }

  // water trough on legs, west of the chicken yard and clear of the soil strips
  box(0.7, 0.42, 2.1, -20.5, 0.5, -22.5);
  for (const lz of [-23.3, -21.7]) {
    box(0.1, 0.3, 0.1, -20.75, 0.15, lz);
    box(0.1, 0.3, 0.1, -20.25, 0.15, lz);
  }

  // ladder leaning on the barn's front wall, east of the doors
  for (const dx of [-0.22, 0.22]) {
    const rail = new THREE.BoxGeometry(0.07, 3.1, 0.07);
    rail.rotateX(0.26);
    rail.translate(-7.3 + dx, 1.5, -23.1);
    parts.push(rail);
  }
  for (let i = 0; i < 6; i++) {
    const y = 0.4 + i * 0.45;
    box(0.5, 0.05, 0.05, -7.3, y, -23.5 + y * 0.26);
  }

  // crates against the wall, west of the doors and north of the lane
  box(0.7, 0.7, 0.7, -13.0, 0.35, -23.0, 0.3);
  box(0.6, 0.6, 0.6, -12.7, 0.9, -22.9, -0.2);

  return mergeGeometries(parts);
}

/** One merged mesh per kind — a few hundred small objects in four draw calls. */
function addKind(
  scene: THREE.Scene,
  placements: readonly Placement[],
  kind: PropKind,
  base: THREE.BufferGeometry,
  material: THREE.Material
): void {
  const parts = placements
    .filter((p) => p.kind === kind)
    .map((p) => {
      const g = base.clone();
      g.scale(p.s, p.s, p.s);
      g.rotateY(p.yaw);
      g.translate(p.x, groundHeight(p.x, p.z), p.z);
      return g;
    });
  if (parts.length === 0) return;
  scene.add(new THREE.Mesh(mergeGeometries(parts), material));
}

/** The static scatter: boulders, tufts, scrub, bales, and the barnyard clutter. */
export function createProps(scene: THREE.Scene): void {
  const placements = propPlacements();
  const stone = (color: number) =>
    new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true });

  addKind(scene, placements, "rock", rockGeometry(), stone(FARM.rock));
  addKind(scene, placements, "tuft", tuftGeometry(), stone(FARM.tuft));
  addKind(scene, placements, "scrub", scrubGeometry(), stone(FARM.scrub));
  addKind(scene, placements, "bale", baleGeometry(), stone(FARM.hay));
  scene.add(new THREE.Mesh(clutterGeometry(), stone(FARM.wood)));

  // only the props big enough to want one: a bale floating a hair off the turf is
  // obvious, a tuft is not
  const shadowMap = glowTexture();
  for (const p of placements) {
    if (p.kind !== "bale") continue;
    blobShadow(scene, shadowMap, p.x - 0.2, p.z + 0.2, 1.9 * p.s, 1.9 * p.s, 0.28);
  }
}
```

- [ ] **Step 5: Call `createProps` from `index.ts`**

In `web/src/themes/farm/index.ts`, add the import:

```ts
import { createProps } from "./props.js";
```

and call it after `createScenery`:

```ts
createScenery(scene);
createProps(scene);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run web/test/farm-props.test.ts`

Expected: PASS, all ten tests.

If a placement test fails, the rejection rule in `propPlacements` and the assertion in the test have drifted apart — they encode the same boxes and must agree.

- [ ] **Step 7: Look at it**

With the dev server running, open `http://localhost:5173/?theme=farm&demo=1`. Confirm the bales sit on the ground rather than in it; the ladder leans on the barn rather than through it; the woodpile, trough and crates are beside the barn and not inside it or inside the silo; no boulder or bale is looming in the camera's foreground; and the tufts along the fence read as grass, not as spikes. Let several blocks pass and watch the tractor complete a full pass without driving through anything.

- [ ] **Step 8: Full verification and commit**

```bash
npm run typecheck && npm run lint && npm test && npm run format
git add web/src/themes/farm/props.ts web/src/themes/farm/palette.ts web/src/themes/farm/index.ts web/test/farm-props.test.ts
git commit -m "Scatter boulders, tufts, bales and clutter across the farm

A seeded scatter of small static props, rejection-sampled clear of the
crop rows, the tractor's headlands, the farmstead's walls and the camera's
foreground, each seated on the rolling ground. The barn gets a woodpile, a
trough, a ladder and some crates for human scale."
```

---

### Task 6: Fade the cloud shadows before they reach rolling ground

The four drifting cloud-shadow planes are flat and run out to x = ±60, into the wings, where the ground now rolls. A hummock will occlude part of a flat shadow, and a shadow that disappears behind a rise reads as a bug. Fading them out before they get there also removes the existing hard wrap-around pop.

**Files:**

- Modify: `web/src/themes/farm/sky.ts`
- Test: `web/test/farm-sky.test.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces: `shadowOpacity(x: number): number`, exported from `sky.ts` for testing.

- [ ] **Step 1: Write the failing test**

Create `web/test/farm-sky.test.ts`:

```ts
import { expect, test } from "vitest";
import { shadowOpacity } from "../src/themes/farm/sky.js";

// The cloud-shadow planes are flat and drift out to x = ±60, into the wings,
// where the ground rolls: a hummock would occlude part of a flat shadow, and a
// shadow that vanishes behind a rise reads as a bug. The flat zone ends at
// |x| = 26 and the ground is fully rolling by |x| ≈ 42, so a shadow must be gone
// well before it gets there.
test("cloud shadows are gone before they reach rolling ground", () => {
  expect(shadowOpacity(38)).toBe(0);
  expect(shadowOpacity(-38)).toBe(0);
  expect(shadowOpacity(60)).toBe(0);
  expect(shadowOpacity(-60)).toBe(0);
});

test("cloud shadows are at full strength over the field", () => {
  expect(shadowOpacity(0)).toBeGreaterThan(0.3);
  expect(shadowOpacity(24)).toBeGreaterThan(0.3);
  expect(shadowOpacity(-24)).toBeGreaterThan(0.3);
});

test("cloud shadow opacity is symmetric, monotone outward, and never negative", () => {
  let previous = Infinity;
  for (let x = 0; x <= 70; x += 1) {
    const o = shadowOpacity(x);
    expect(o).toBeCloseTo(shadowOpacity(-x), 6);
    expect(o).toBeGreaterThanOrEqual(0);
    expect(o).toBeLessThanOrEqual(previous + 1e-9);
    previous = o;
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run web/test/farm-sky.test.ts`

Expected: FAIL — `shadowOpacity is not a function`.

- [ ] **Step 3: Add the ramp to `sky.ts`**

In `web/src/themes/farm/sky.ts`, add above `createFarmSky`:

```ts
/** Peak opacity of a cloud shadow, out over the field. */
const SHADOW_OPACITY = 0.34;

/**
 * How dark a cloud shadow is at x. The shadow planes are flat and drift out to
 * x = ±60, but past |x| ≈ 26 the ground begins to roll (see terrain.ts) and a
 * hummock would occlude part of a flat shadow — a shadow vanishing behind a rise
 * reads as a bug. So they fade out before they get there, which also replaces the
 * hard wrap-around pop with a fade.
 */
export function shadowOpacity(x: number): number {
  const fade = THREE.MathUtils.clamp((38 - Math.abs(x)) / 14, 0, 1);
  return SHADOW_OPACITY * fade * fade;
}
```

In `createFarmSky`, change the shadow material's `opacity: 0.34,` to:

```ts
        opacity: SHADOW_OPACITY,
```

and in the returned `update`, replace the shadow loop with:

```ts
for (const shadow of shadows) {
  shadow.position.x += dt * 0.9;
  if (shadow.position.x > 60) shadow.position.x = -60;
  shadow.material.opacity = shadowOpacity(shadow.position.x);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run web/test/farm-sky.test.ts`

Expected: PASS, all three tests.

- [ ] **Step 5: Full verification and commit**

```bash
npm run typecheck && npm run lint && npm test && npm run format
git add web/src/themes/farm/sky.ts web/test/farm-sky.test.ts
git commit -m "Fade the farm's cloud shadows before they reach rolling ground

The shadow planes are flat and drift out into the wings, where the ground
now rolls — a hummock would occlude part of one, and a shadow vanishing
behind a rise reads as a bug. They now fade out before they get there,
which also removes the hard wrap-around pop."
```

---

### Task 7: Verify the whole scene

Everything is in. Check it end to end, in the app, against the goal — that the farm reads as grounded, and that none of the new detail has stolen attention from the field.

**Files:** documentation only. Any fix belongs in the task that introduced the problem.

- [ ] **Step 1: Run the full suite**

```bash
npm run typecheck && npm run lint && npm test
```

Expected: everything passes. `web/test/farm-turbines.test.ts` in particular must still pass — the turbines' blade-vs-hill clearance is the contract the whole terrain design was built around.

- [ ] **Step 2: Drive the app**

Start the dev server (`npm run dev:web`) and open `http://localhost:5173/?theme=farm&demo=1`. Let it run for at least a minute — long enough for several blocks, so the tractor completes passes and the camera drifts through its full arc.

Check, in order:

1. **The ground has grain.** It is not a flat green mat. The mottled tile is visible out past the fence, and shows no tile seams.
2. **The wings roll.** The ground left and right of the field is not a table, and the roll does not reach into the field, the barnyard, or the hills.
3. **Nothing floats or sinks.** Trees, boulders, bales and shrubs sit on the ground they stand on. The crops, the tractor, the chickens and the fence are exactly where they were.
4. **The horizon has layers.** Hedgerows, then the far tree line, then two ranks of hills, then the turbines.
5. **The barn is worn in.** It stands on packed earth, with a lane leaving its doors.
6. **The field is still the subject.** Nothing in the surroundings pulls the eye off the crop rows.
7. **The frame rate is unchanged.** All of this is static; if the frame rate moved, something is being rebuilt per frame.

- [ ] **Step 3: Check `prefers-reduced-motion`**

In Chrome DevTools → Rendering → "Emulate CSS media feature prefers-reduced-motion: reduce", then reload. The scenery is static either way, so it should look identical; only the tractor, crows, smoke and motes slow down.

- [ ] **Step 4: Document the new modules**

In `web/CLAUDE.md`, under the `farm` section, add a paragraph after the one describing `CropSystem`:

```markdown
The surroundings are static scenery, built once and never updated. `terrain.ts`
owns the ground: a `groundHeight(x, z)` height field displaces the turf disc,
damped to exactly zero over the box the farm occupies (crops, tractor, chickens
and fence all assume `y = 0` and none of them sample a height) and again under the
hills, whose lower hemispheres are buried beneath the turf. `landscape.ts` paints
the parcels, mowing stripes, dirt lane and barnyard apron onto an overlay draped
on that same displaced surface. `scenery.ts` has the trees, hedgerows and far tree
line; `props.ts` the boulders, tufts, bales and barnyard clutter.
```

- [ ] **Step 5: Commit**

```bash
npm run format
git add web/CLAUDE.md
git commit -m "Document the farm's scenery modules"
```
