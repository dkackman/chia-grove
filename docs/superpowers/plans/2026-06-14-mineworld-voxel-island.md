# Mineworld Voxel-Island Theme — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fourth visualization — a Minecraft-inspired voxel island that builds itself from chain activity under a slow day–night cycle — selectable alongside grove/farm/gallery.

**Architecture:** A self-contained `web/src/themes/mine/` package behind the existing `Visualization` interface, mirroring the grove's structure (a `mine.ts` runtime owning renderer/camera/sky/dispatch with setter hooks, wired in `index.ts` to per-system modules). XCH spends pave a grass/dirt floor; CATs are deterministic material+color cubes routed into three `InstancedMesh` families (opaque/transparent/emissive); NFTs are framed paintings; DIDs are villagers. Pure logic (CAT material resolver, chunk/seating layout, day-night math) is DOM-free and unit-tested; visual systems reuse the shared `InstancedKind`, `createOrbitControl`, and `createPostFx`.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Three.js (r0.16x, `three/addons`), Vitest, Vite. Node ≥ 24.

**Spec:** `docs/superpowers/specs/2026-06-14-mineworld-voxel-island-design.md`

---

## File structure

```
web/src/themes/
  index.ts                 MODIFY: register `mine` in THEMES
  mine/
    index.ts               Visualization export (id/label/legend/start) + system wiring
    mine.ts                runtime: renderer, camera orbit, scene, dispatch, setter hooks
    palette.ts             16 wool dyes (HSL) + fixed material colors + scene colors
    material.ts            resolveCatBlock(assetId) — pure CAT material+color resolver
    layout.ts              chunkPosition / floor spiral / incremental seating — pure
    sky.ts                 day-night cycle (pure phase math + scene objects + lights)
    island.ts              ground system (grass/dirt cubes) over InstancedKind
    cats.ts                three CAT InstancedKind families + plant/pick
    structures.ts          DID villagers + NFT framed paintings
    vfx.ts                 mint beacon beams, mempool rim torches, reorg creeper burst
web/src/themes/shared/
  instanced.ts             MODIFY: per-instance y, configurable bounds, clearWhere()
web/src/style.css          MODIFY: add `.sw-*` legend swatches for mine
web/test/
  instanced.test.ts        NEW: y placement, default y, clearWhere
  mine-material.test.ts     NEW: resolveCatBlock determinism/distribution/dye range
  mine-layout.test.ts       NEW: chunk spiral, floor order, incremental seating
  mine-sky.test.ts          NEW: day-night phase math, netspace mapping
  mine-geometry.test.ts     NEW: ground/cat/villager/torch geometry validity
  themes.test.ts           MODIFY: assert `mine` registered/resolvable
```

Reused unchanged: `shared/orbit.ts`, `shared/postfx.ts`, `shared/scales.ts`, `shared/util.ts`, `ui/picker.ts`, `ui/legend.ts`, the detail card.

---

## Task 1: Extend InstancedKind for voxels (per-instance y, bounds, clearWhere)

**Files:**
- Modify: `web/src/themes/shared/instanced.ts`
- Test: `web/test/instanced.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/test/instanced.test.ts
import * as THREE from "three";
import { expect, test } from "vitest";
import { InstancedKind } from "../src/themes/shared/instanced.js";
import type { SproutEvent } from "@grove/shared";

function meta(height: number): SproutEvent {
  return { type: "sprout", kind: "cat", height, coinId: "00".repeat(32), amount: "0" };
}
function makeKind(cap = 4) {
  const scene = new THREE.Scene();
  return new InstancedKind(scene, new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial(), cap, 0);
}
function decompose(kind: ReturnType<typeof makeKind>, i: number) {
  const m = new THREE.Matrix4();
  kind.mesh.getMatrixAt(i, m);
  const pos = new THREE.Vector3(), scl = new THREE.Vector3(), q = new THREE.Quaternion();
  m.decompose(pos, q, scl);
  return { pos, scl };
}

test("plants at an explicit y and grows to full height", () => {
  const kind = makeKind();
  kind.plant(meta(5), 1, 2, 0, { height: 1, rotY: 0, tiltX: 0, tiltZ: 0, swayPhase: 0, y: 5 });
  kind.update(2, 1); // t past GROW_SECONDS → eased = 1
  const { pos, scl } = decompose(kind, 0);
  expect(pos.y).toBeCloseTo(5);
  expect(scl.y).toBeCloseTo(1);
});

test("y defaults to 0 so existing (grove) callers are unaffected", () => {
  const kind = makeKind();
  kind.plant(meta(1), 1, 2, 0, { height: 1, rotY: 0, tiltX: 0, tiltZ: 0, swayPhase: 0 });
  kind.update(2, 1);
  expect(decompose(kind, 0).pos.y).toBeCloseTo(0);
});

test("clearWhere removes matching instances and frees their metadata", () => {
  const kind = makeKind();
  kind.plant(meta(8), 0, 0, 0, { height: 1, rotY: 0, tiltX: 0, tiltZ: 0, swayPhase: 0, y: 1 });
  kind.plant(meta(9), 0, 0, 0, { height: 1, rotY: 0, tiltX: 0, tiltZ: 0, swayPhase: 0, y: 2 });
  kind.update(2, 1);
  kind.clearWhere((m) => m.height >= 9);
  expect(kind.metaAt(0)).not.toBeNull();
  expect(kind.metaAt(1)).toBeNull();
  expect(decompose(kind, 1).scl.y).toBeCloseTo(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/test/instanced.test.ts`
Expected: FAIL — `pose.y` ignored (pos.y is 0, not 5); `clearWhere` is not a function.

- [ ] **Step 3: Edit `instanced.ts`**

Add `y` to the `Slot` interface (after `z: number;`):

```ts
  z: number;
  y: number;
```

Add `y` to the `Pose` interface (after `width?: number;`):

```ts
  width?: number;
  /** vertical offset of the instance base; defaults to 0 (ground plane). */
  y?: number;
```

In `makeSlots`, add `y: 0,` to the returned object (next to `x: 0,`).

Change the constructor signature to accept optional bounds, and set the sphere from them. Replace:

```ts
    cap: number,
    private readonly swayAmp: number
  ) {
```

with:

```ts
    cap: number,
    private readonly swayAmp: number,
    boundsRadius = 80,
    boundsCenterY = 2
  ) {
```

and replace the pinned bounding-sphere line:

```ts
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2, 0), 80);
```

with:

```ts
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, boundsCenterY, 0), boundsRadius);
```

In `plant`, after `slot.z = z;` add:

```ts
    slot.y = pose.y ?? 0;
```

In `update`, change the position line:

```ts
        this.position.set(slot.x, 0, slot.z),
```

to:

```ts
        this.position.set(slot.x, slot.y, slot.z),
```

Add a `clearWhere` method (after `setHighlight`, before `private readonly highlightColor`):

```ts
  /** Release every active slot whose metadata matches — used by reorg culling. */
  clearWhere(predicate: (meta: SproutEvent) => boolean): void {
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (slot.meta && predicate(slot.meta)) {
        slot.meta = null;
        this.matrix.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this.matrix);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run web/test/instanced.test.ts web/test/layout.test.ts web/test/flora-geometry.test.ts`
Expected: PASS (new tests pass; grove tests still pass — backward compatible).

- [ ] **Step 5: Commit**

```bash
git add web/src/themes/shared/instanced.ts web/test/instanced.test.ts
git commit -m "feat(themes): per-instance y, configurable bounds, clearWhere on InstancedKind"
```

---

## Task 2: Mine palette (16 wool dyes + material/scene colors)

**Files:**
- Create: `web/src/themes/mine/palette.ts`
- Test: `web/test/mine-material.test.ts` (palette assertions; resolver added in Task 3)

- [ ] **Step 1: Write the failing test**

```ts
// web/test/mine-material.test.ts
import { expect, test } from "vitest";
import { WOOL_DYES, FIXED_COLORS } from "../src/themes/mine/palette.js";

test("there are exactly 16 wool dyes with valid HSL", () => {
  expect(WOOL_DYES.length).toBe(16);
  for (const c of WOOL_DYES) {
    expect(c.h).toBeGreaterThanOrEqual(0);
    expect(c.h).toBeLessThanOrEqual(1);
    expect(c.s).toBeGreaterThanOrEqual(0);
    expect(c.l).toBeGreaterThan(0);
  }
});

test("every fixed (non-dyed) material has a color", () => {
  for (const key of ["glass", "ice", "blue_ice", "honey", "glowstone", "sea_lantern", "shroomlight", "froglight", "redstone_lamp", "magma"]) {
    expect(FIXED_COLORS[key]).toBeDefined();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/test/mine-material.test.ts`
Expected: FAIL — cannot find module `mine/palette.js`.

- [ ] **Step 3: Create `palette.ts`**

```ts
// web/src/themes/mine/palette.ts
export interface HSL {
  h: number; // 0..1
  s: number; // 0..1
  l: number; // 0..1
}

/** hex (0xRRGGBB) → HSL in 0..1, for converting Minecraft's authentic palette. */
export function hexToHsl(hex: number): HSL {
  const r = ((hex >> 16) & 0xff) / 255;
  const g = ((hex >> 8) & 0xff) / 255;
  const b = (hex & 0xff) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return { h, s, l };
}

// The 16 authentic in-game wool/dye RGBs.
const WOOL_HEX = [
  0xe9ecec, 0xf07613, 0xbd44b3, 0x3aafd9, 0xf8c627, 0x70b919, 0xed8dac, 0x3e4447,
  0x8e8e86, 0x158991, 0x792aac, 0x35399d, 0x724728, 0x546d1b, 0xa12722, 0x141519,
] as const;

export const WOOL_DYES: readonly HSL[] = WOOL_HEX.map(hexToHsl);

/** Intrinsic colors for materials that do not take dye. */
export const FIXED_COLORS: Record<string, HSL> = {
  glass: hexToHsl(0xc8e6ef),
  ice: hexToHsl(0xafc8f5),
  blue_ice: hexToHsl(0x74a8f0),
  honey: hexToHsl(0xf0a83c),
  glowstone: hexToHsl(0xf6c969),
  sea_lantern: hexToHsl(0x9fe0d8),
  shroomlight: hexToHsl(0xf08a3c),
  froglight: hexToHsl(0xe6e08a),
  redstone_lamp: hexToHsl(0xf08438),
  magma: hexToHsl(0xb5471f),
};

/** Scene colors (day/night endpoints lerped by the cycle phase). */
export const MINE = {
  grassTop: 0x6aa84f,
  dirt: 0x7a5a3a,
  skyDay: 0x79bdef,
  skyNight: 0x0a1130,
  fogDay: 0xbfe0f2,
  fogNight: 0x13203f,
  sun: 0xfff4c2,
  moon: 0xdfe6f2,
  beacon: 0xbafff0,
  torch: 0xffb347,
} as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run web/test/mine-material.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/themes/mine/palette.ts web/test/mine-material.test.ts
git commit -m "feat(mine): wool dye + material + scene palette"
```

---

## Task 3: CAT material resolver (`material.ts`)

**Files:**
- Create: `web/src/themes/mine/material.ts`
- Test: `web/test/mine-material.test.ts` (extend)

- [ ] **Step 1: Add failing tests**

Append to `web/test/mine-material.test.ts`:

```ts
import { resolveCatBlock } from "../src/themes/mine/material.js";

function id(seed: string) {
  return (seed.repeat(64)).slice(0, 64);
}

test("resolveCatBlock is deterministic per asset id", () => {
  const a = resolveCatBlock(id("ab"));
  const b = resolveCatBlock(id("ab"));
  expect(a).toEqual(b);
});

test("opaque is the most common family, emissive the rarest", () => {
  const counts = { opaque: 0, transparent: 0, emissive: 0 };
  for (let i = 0; i < 2000; i++) {
    const hex = i.toString(16).padStart(8, "0") + "00".repeat(28);
    counts[resolveCatBlock(hex).family]++;
  }
  expect(counts.opaque).toBeGreaterThan(counts.transparent);
  expect(counts.transparent).toBeGreaterThan(counts.emissive);
  expect(counts.emissive).toBeGreaterThan(0);
});

test("dyed materials index the 16-dye set; fixed materials are not dyed", () => {
  for (let i = 0; i < 500; i++) {
    const hex = (i * 2654435761 >>> 0).toString(16).padStart(8, "0") + "00".repeat(28);
    const b = resolveCatBlock(hex);
    if (b.dyed) expect(b.dyeIndex).toBeGreaterThanOrEqual(0), expect(b.dyeIndex).toBeLessThan(16);
    else expect(b.dyeIndex).toBeUndefined();
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run web/test/mine-material.test.ts`
Expected: FAIL — cannot find module `mine/material.js`.

- [ ] **Step 3: Create `material.ts`**

```ts
// web/src/themes/mine/material.ts
import { WOOL_DYES, FIXED_COLORS, type HSL } from "./palette.js";

export type CatFamily = "opaque" | "transparent" | "emissive";

export interface CatBlock {
  family: CatFamily;
  material: string;
  dyed: boolean;
  dyeIndex?: number; // present only when dyed
  color: HSL;
}

// Family weights (cumulative thresholds over a 0..1 hash). Opaque common,
// emissive rarest — the "ooh, a glowing one" feel.
const OPAQUE_MAX = 0.66;
const TRANSPARENT_MAX = 0.88; // remainder (0.12) is emissive

const OPAQUE_MATERIALS = ["wool", "concrete", "terracotta"]; // all dyed
const TRANSPARENT_DYED = ["stained_glass"];
const TRANSPARENT_FIXED = ["glass", "ice", "blue_ice", "honey"];
const EMISSIVE_MATERIALS = ["glowstone", "sea_lantern", "shroomlight", "froglight", "redstone_lamp", "magma"];

/** Two independent 0..1 hashes from disjoint slices of the asset id. */
function hashUnit(hex: string, start: number): number {
  const slice = (hex + "0".repeat(16)).slice(start, start + 8);
  return parseInt(slice, 16) / 0x100000000;
}

function pick<T>(arr: readonly T[], u: number): T {
  return arr[Math.min(arr.length - 1, Math.floor(u * arr.length))];
}

export function resolveCatBlock(assetIdHex: string): CatBlock {
  const familyU = hashUnit(assetIdHex, 0);
  const materialU = hashUnit(assetIdHex, 8);
  const dyeU = hashUnit(assetIdHex, 16);

  if (familyU < OPAQUE_MAX) {
    const material = pick(OPAQUE_MATERIALS, materialU);
    const dyeIndex = Math.min(15, Math.floor(dyeU * 16));
    return { family: "opaque", material, dyed: true, dyeIndex, color: WOOL_DYES[dyeIndex] };
  }
  if (familyU < TRANSPARENT_MAX) {
    // split transparent into dyed (stained glass) vs fixed-tint
    if (materialU < 0.5) {
      const dyeIndex = Math.min(15, Math.floor(dyeU * 16));
      return { family: "transparent", material: "stained_glass", dyed: true, dyeIndex, color: WOOL_DYES[dyeIndex] };
    }
    const material = pick(TRANSPARENT_FIXED, materialU * 2 - 1);
    return { family: "transparent", material, dyed: false, color: FIXED_COLORS[material] };
  }
  const material = pick(EMISSIVE_MATERIALS, materialU);
  return { family: "emissive", material, dyed: false, color: FIXED_COLORS[material] };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run web/test/mine-material.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/themes/mine/material.ts web/test/mine-material.test.ts
git commit -m "feat(mine): deterministic CAT material+color resolver"
```

---

## Task 4: Layout — chunk spiral + incremental seating (`layout.ts`)

The key constraint: sprouts arrive one at a time, so positions must be **stable as the count grows** (cube N always lands in the same spot regardless of how many follow). Floor cells fill a fixed-size spiral (center-first); specials reuse the same cell order but stack onto layers ≥ 1.

**Files:**
- Create: `web/src/themes/mine/layout.ts`
- Test: `web/test/mine-layout.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/test/mine-layout.test.ts
import { expect, test } from "vitest";
import { chunkPosition, FLOOR_TILES, floorCell, seatCell, cellLocal, cellKey } from "../src/themes/mine/layout.js";

test("chunks spiral outward monotonically", () => {
  const r = (i: number) => Math.hypot(chunkPosition(i).x, chunkPosition(i).z);
  expect(r(40)).toBeGreaterThan(r(4));
  expect(r(4)).toBeGreaterThan(r(0));
});

test("floor fills a fixed footprint, center first, no repeats within a layer", () => {
  const seen = new Set<string>();
  for (let i = 0; i < FLOOR_TILES; i++) {
    const c = floorCell(i);
    seen.add(cellKey(c));
  }
  expect(seen.size).toBe(FLOOR_TILES);
  // cell 0 is the center
  expect(floorCell(0)).toEqual({ col: 0, row: 0 });
});

test("seating stays on layer 0..0 until the footprint fills, then stacks", () => {
  expect(seatCell(0).layer).toBe(1);
  expect(seatCell(FLOOR_TILES - 1).layer).toBe(1);
  expect(seatCell(FLOOR_TILES).layer).toBe(2);
});

test("a seat index always maps to the same cell (stable as count grows)", () => {
  expect(seatCell(5)).toEqual(seatCell(5));
});

test("cellLocal spaces cubes by one unit and lifts by layer", () => {
  const a = cellLocal({ col: 0, row: 0 }, 1);
  const b = cellLocal({ col: 1, row: 0 }, 1);
  expect(Math.abs(b.x - a.x)).toBeCloseTo(1);
  expect(a.y).toBeCloseTo(1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run web/test/mine-layout.test.ts`
Expected: FAIL — cannot find module `mine/layout.js`.

- [ ] **Step 3: Create `layout.ts`**

```ts
// web/src/themes/mine/layout.ts
import type { XZ } from "../shared/util.js";

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const SPREAD = 3.0; // chunks overlap slightly into one contiguous landmass

/** Block index → chunk center on a phyllotaxis spiral. */
export function chunkPosition(index: number): XZ {
  const angle = index * GOLDEN_ANGLE;
  const radius = SPREAD * Math.sqrt(index);
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}

export interface Cell {
  col: number;
  row: number;
}

const FLOOR_SIDE = 6; // 6×6 footprint per layer
export const FLOOR_TILES = FLOOR_SIDE * FLOOR_SIDE;
const SPACING = 1; // unit cubes
const CUBE = 1;

export function cellKey(c: Cell): string {
  return `${c.col},${c.row}`;
}

// Outward ring (Chebyshev) ordering centered at (0,0): center first, then
// rings of growing radius. Deterministic and independent of total count.
const FLOOR_ORDER: Cell[] = (() => {
  const cells: Cell[] = [];
  const half = (FLOOR_SIDE - 1) / 2; // 2.5 for side 6 → cols span -2..3
  const lo = -Math.floor(FLOOR_SIDE / 2); // -3
  const hi = lo + FLOOR_SIDE - 1; // 2
  const all: Cell[] = [];
  for (let col = lo; col <= hi; col++) for (let row = lo; row <= hi; row++) all.push({ col, row });
  all.sort((a, b) => {
    const ra = Math.max(Math.abs(a.col + 0.5 - 0), Math.abs(a.row + 0.5 - 0));
    const rb = Math.max(Math.abs(b.col + 0.5 - 0), Math.abs(b.row + 0.5 - 0));
    if (ra !== rb) return ra - rb;
    return Math.atan2(a.row, a.col) - Math.atan2(b.row, b.col);
  });
  void half;
  return all;
})();

/** Floor tile (layer 0) for the n-th ground cube, center-first. */
export function floorCell(n: number): Cell {
  return FLOOR_ORDER[n % FLOOR_TILES];
}

export interface Seat {
  col: number;
  row: number;
  layer: number; // ≥ 1: specials sit above the floor
}

/** Special (CAT/NFT/DID) seating: fill the footprint at layer 1, then stack. */
export function seatCell(seatIndex: number): Seat {
  const cell = FLOOR_ORDER[seatIndex % FLOOR_TILES];
  const layer = 1 + Math.floor(seatIndex / FLOOR_TILES);
  return { col: cell.col, row: cell.row, layer };
}

/** Cell + layer → local offset (relative to the chunk center). */
export function cellLocal(cell: Cell, layer: number): { x: number; z: number; y: number } {
  return { x: cell.col * SPACING, z: cell.row * SPACING, y: layer * CUBE };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run web/test/mine-layout.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/themes/mine/layout.ts web/test/mine-layout.test.ts
git commit -m "feat(mine): chunk spiral + count-stable incremental seating"
```

---

## Task 5: Day-night phase math (`sky.ts` pure exports)

Add the testable cycle math first; the scene objects/lights are wired in Task 7.

**Files:**
- Create: `web/src/themes/mine/sky.ts`
- Test: `web/test/mine-sky.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/test/mine-sky.test.ts
import { expect, test } from "vitest";
import { cyclePhase, sunHeight, daylight, netspaceSun } from "../src/themes/mine/sky.js";

test("cyclePhase wraps within [0,1)", () => {
  expect(cyclePhase(0, 100)).toBeCloseTo(0);
  expect(cyclePhase(50, 100)).toBeCloseTo(0.5);
  expect(cyclePhase(150, 100)).toBeCloseTo(0.5);
});

test("sunHeight peaks at midday and dips at night", () => {
  expect(sunHeight(0.25)).toBeCloseTo(1); // noon
  expect(sunHeight(0.75)).toBeCloseTo(-1); // midnight
});

test("daylight is ~1 at noon and ~0 at night", () => {
  expect(daylight(0.25)).toBeGreaterThan(0.9);
  expect(daylight(0.75)).toBeLessThan(0.05);
});

test("netspaceSun grows with netspace and stays bounded", () => {
  const small = netspaceSun("0");
  const big = netspaceSun((100n * 1024n ** 6n).toString()); // ~100 EiB
  expect(big).toBeGreaterThan(small);
  expect(big).toBeLessThanOrEqual(1.3);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run web/test/mine-sky.test.ts`
Expected: FAIL — cannot find module `mine/sky.js`.

- [ ] **Step 3: Create `sky.ts` (pure math + a stub scene object; lights wired in Task 7)**

```ts
// web/src/themes/mine/sky.ts
import * as THREE from "three";
import { safeBigInt } from "../shared/util.js";
import { MINE } from "./palette.js";

export const CYCLE_SECONDS = 150;

export function cyclePhase(t: number, cycle = CYCLE_SECONDS): number {
  return ((t % cycle) + cycle) % cycle / cycle;
}

/** -1 (midnight) .. +1 (noon). Phase 0 = sunrise. */
export function sunHeight(phase: number): number {
  return Math.sin(phase * Math.PI * 2);
}

/** 0 at night .. 1 at noon, with a soft dawn/dusk ramp. */
export function daylight(phase: number): number {
  return Math.max(0, Math.min(1, (sunHeight(phase) + 0.15) / 0.9));
}

/** Netspace (bytes) → sun peak/brightness multiplier (matches grove's curve). */
export function netspaceSun(bytes: string): number {
  const eib = Number(safeBigInt(bytes) >> 50n) / 1024;
  return Math.min(1.3, Math.max(0.8, 0.85 + (eib - 10) * 0.012));
}

export interface MineSky {
  update(dt: number, t: number): void;
  setNetspace(bytes: string): void;
  setSignalLost(lost: boolean): void;
  /** current daylight 0..1, read by the renderer for ambient tone. */
  daylight: number;
}

/**
 * Day-night scene: a vertex-colored sky dome, sun + moon sprites with a shared
 * directional light, a star field that fades in at night, and fog whose color
 * lerps day↔night. Pure math above is unit-tested; this wires it to objects.
 */
export function createMineSky(scene: THREE.Scene, reducedMotion = false): MineSky {
  const skyDay = new THREE.Color(MINE.skyDay);
  const skyNight = new THREE.Color(MINE.skyNight);
  const fogDay = new THREE.Color(MINE.fogDay);
  const fogNight = new THREE.Color(MINE.fogNight);
  const bg = new THREE.Color();
  scene.background = bg;
  scene.fog = new THREE.FogExp2(MINE.fogDay, 0.012);

  // sun + moon
  const sun = new THREE.DirectionalLight(0xfff4c2, 1);
  scene.add(sun);
  const sunSprite = sprite(MINE.sun, 16);
  const moonSprite = sprite(MINE.moon, 12);
  scene.add(sunSprite, moonSprite);

  // stars (fade in at night)
  const stars = makeStars();
  scene.add(stars);
  const starMat = stars.material as THREE.PointsMaterial;

  function sprite(color: number, size: number): THREE.Sprite {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ color, fog: false, transparent: true, depthWrite: false }));
    s.scale.setScalar(size);
    return s;
  }
  function makeStars(): THREE.Points {
    const n = 600;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2;
      const phi = Math.acos(0.1 + Math.random() * 0.9);
      pos[i * 3] = 200 * Math.sin(phi) * Math.cos(th);
      pos[i * 3 + 1] = 200 * Math.cos(phi);
      pos[i * 3 + 2] = 200 * Math.sin(phi) * Math.sin(th);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return new THREE.Points(g, new THREE.PointsMaterial({ size: 1.4, color: 0xdfe6f2, transparent: true, opacity: 0, depthWrite: false, fog: false }));
  }

  let netspace = 1;
  let signalLost = false;
  const out: MineSky = {
    daylight: 1,
    update(_dt, t) {
      const phase = reducedMotion ? 0.2 : cyclePhase(t);
      const h = sunHeight(phase);
      const day = daylight(phase) * (signalLost ? 0.5 : 1);
      out.daylight = day;
      bg.copy(skyNight).lerp(skyDay, day);
      (scene.fog as THREE.FogExp2).color.copy(fogNight).lerp(fogDay, day);
      // sun rides an arc; moon opposite
      const R = 140;
      sun.position.set(Math.cos(phase * Math.PI * 2) * R, h * R, -40);
      sun.intensity = Math.max(0.05, day) * netspace;
      sunSprite.position.copy(sun.position);
      (sunSprite.material as THREE.SpriteMaterial).opacity = Math.max(0, h);
      moonSprite.position.set(-sun.position.x, -h * R, -40);
      (moonSprite.material as THREE.SpriteMaterial).opacity = Math.max(0, -h);
      starMat.opacity = Math.max(0, -h) * 0.9;
      stars.rotation.y = t * 0.003;
    },
    setNetspace(bytes) {
      netspace = netspaceSun(bytes);
    },
    setSignalLost(lost) {
      signalLost = lost;
    },
  };
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run web/test/mine-sky.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/themes/mine/sky.ts web/test/mine-sky.test.ts
git commit -m "feat(mine): day-night cycle math + sky scene objects"
```

---

## Task 6: Theme scaffolding — runtime, registration, empty scene

Makes `mine` selectable with a working camera + sky (no blocks yet). Models `mine.ts` on `grove.ts` and `index.ts` on `grove/index.ts`.

**Files:**
- Create: `web/src/themes/mine/mine.ts`, `web/src/themes/mine/index.ts`
- Modify: `web/src/themes/index.ts`, `web/src/style.css`
- Test: `web/test/themes.test.ts` (extend)

- [ ] **Step 1: Add failing test**

Append to `web/test/themes.test.ts`:

```ts
test("mine theme is registered and resolvable", () => {
  expect(THEMES.map((t) => t.id)).toContain("mine");
  expect(resolveTheme("?theme=mine", null).id).toBe("mine");
  expect(resolveTheme("", "mine").id).toBe("mine");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run web/test/themes.test.ts`
Expected: FAIL — `mine` not in THEMES.

- [ ] **Step 3a: Create `mine.ts` runtime**

```ts
// web/src/themes/mine/mine.ts
import * as THREE from "three";
import type { GroveEvent, SproutEvent } from "@grove/shared";
import type { GroveFeed } from "../../net/feed.js";
import type { XZ } from "../shared/util.js";
import { createOrbitControl } from "../shared/orbit.js";
import { createPostFx } from "../shared/postfx.js";
import { chunkPosition } from "./layout.js";
import { createMineSky } from "./sky.js";

const MAX_BLOCK_SLOTS = 400;

export function startMine(canvas: HTMLCanvasElement, feed: GroveFeed) {
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.setSize(innerWidth, innerHeight);

  const orbit = createOrbitControl(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 600);

  scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x3a3326, 0.6));
  const sky = createMineSky(scene, reducedMotion);

  const postfx = createPostFx(renderer, scene, camera, {
    toneMapping: THREE.ACESFilmicToneMapping,
    exposure: 1.05,
    bloomStrength: 0.18,
    bloomRadius: 0.5,
    bloomThreshold: 0.65,
  });

  // wired up by later tasks (island/cats/structures/vfx via index.ts)
  let onSprout = (_event: SproutEvent, _chunk: XZ, _height: number) => {};
  let onAmbientExtra = (_mempoolSize: number) => {};
  let onBlockExtra = (_chunk: XZ) => {};
  let onReorgExtra = (_forkHeight: number) => {};
  let extraUpdate = (_dt: number, _t: number) => {};

  let blockIndex = 0;
  let currentChunk = chunkPosition(0);

  feed.onEvent((event: GroveEvent) => {
    switch (event.type) {
      case "block":
        currentChunk = chunkPosition(blockIndex);
        blockIndex = (blockIndex + 1) % MAX_BLOCK_SLOTS;
        sky.update(0, 0); // no-op safety; real update in frame loop
        onBlockExtra(currentChunk);
        break;
      case "sprout":
        onSprout(event, currentChunk, event.height);
        break;
      case "ambient":
        sky.setNetspace(event.netspace);
        onAmbientExtra(event.mempoolSize);
        break;
      case "reorg":
        onReorgExtra(event.forkHeight);
        break;
    }
  });
  feed.onStatus((status) => sky.setSignalLost(status === "stale"));

  const timer = new THREE.Timer();
  function frame(): void {
    requestAnimationFrame(frame);
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.1);
    const t = timer.getElapsed();

    const angle = (reducedMotion ? 0.8 : t * 0.015) + orbit.getOffset();
    const radius = 46 + (reducedMotion ? 0 : Math.sin(t * 0.06) * 3);
    camera.position.set(Math.cos(angle) * radius, 26 + Math.sin(t * 0.04) * 1.2, Math.sin(angle) * radius);
    camera.lookAt(0, 1.5, 0);

    sky.update(dt, t);
    extraUpdate(dt, t);
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
    { renderer, camera, scene, sky },
    {
      setSproutHandler: (fn: typeof onSprout) => (onSprout = fn),
      setAmbientHandler: (fn: typeof onAmbientExtra) => (onAmbientExtra = fn),
      setBlockHandler: (fn: typeof onBlockExtra) => (onBlockExtra = fn),
      setReorgHandler: (fn: typeof onReorgExtra) => (onReorgExtra = fn),
      setUpdateHandler: (fn: typeof extraUpdate) => (extraUpdate = fn),
      isDragging: () => orbit.isDragging(),
      reducedMotion,
    }
  );
}

export type MineRuntime = ReturnType<typeof startMine>;
```

- [ ] **Step 3b: Create `index.ts` (Visualization; systems added in later tasks)**

```ts
// web/src/themes/mine/index.ts
import type { Visualization } from "../types.js";
import { startMine } from "./mine.js";

export const mine: Visualization = {
  id: "mine",
  label: "mineworld",
  legend: [
    ["sw-land", "land — XCH spend (the island)"],
    ["sw-block", "block — CAT (material + color = asset)"],
    ["sw-painting", "painting — NFT (clickable)"],
    ["sw-villager", "villager — DID"],
    ["sw-beacon", "beacon — mint"],
    ["sw-torch", "torches — mempool"],
    ["sw-suncycle", "sun / moon — netspace + time"],
    ["sw-creeper", "creeper — reorg"],
  ],
  start(canvas, feed) {
    const runtime = startMine(canvas, feed);
    const frameCallbacks: Array<() => void> = [];
    runtime.setUpdateHandler((_dt, _t) => {
      for (const fn of frameCallbacks) fn();
    });
    return {
      camera: runtime.camera,
      onFrame: (fn) => frameCallbacks.push(fn),
      isDragging: () => runtime.isDragging(),
      pickables: () => [],
      metaFor: () => null,
      setHovered: () => {},
    };
  },
};
```

- [ ] **Step 3c: Register in `web/src/themes/index.ts`**

Add the import and array entry:

```ts
import { mine } from "./mine/index.js";
```

```ts
export const THEMES: readonly Visualization[] = [grove, farm, gallery, mine];
```

- [ ] **Step 3d: Add legend swatches to `web/src/style.css`**

Append after the existing `.sw-crow` block:

```css
.sw-land {
  width: 4px;
  height: 13px;
  border-radius: 2px;
  background: linear-gradient(to top, #7a5a3a, #6aa84f);
}
.sw-block {
  background: #3aafd9;
  box-shadow: 0 0 5px rgba(58, 175, 217, 0.7);
}
.sw-painting {
  background: #e3a0c8;
  border: 1px solid #5a3d23;
}
.sw-villager {
  background: #7a6a52;
}
.sw-beacon {
  background: #bafff0;
  box-shadow: 0 0 7px rgba(186, 255, 240, 0.9);
}
.sw-torch {
  width: 6px;
  height: 6px;
  margin: 0 2px;
  background: #ffb347;
  box-shadow: 0 0 6px rgba(255, 179, 71, 0.9);
}
.sw-suncycle {
  background: #fff4c2;
  box-shadow: 0 0 6px rgba(255, 244, 194, 0.8);
}
.sw-creeper {
  background: #5bbb5b;
  border: 1px solid rgba(0, 0, 0, 0.3);
}
```

- [ ] **Step 4: Verify**

Run: `npx vitest run web/test/themes.test.ts && npm run typecheck`
Expected: PASS; typecheck clean.
Manual: `npm run dev:web`, open `http://localhost:5173/?theme=mine&demo=1` → orbiting empty sky with a day-night cycle, theme picker lists "mineworld".

- [ ] **Step 5: Commit**

```bash
git add web/src/themes/mine/mine.ts web/src/themes/mine/index.ts web/src/themes/index.ts web/src/style.css web/test/themes.test.ts
git commit -m "feat(mine): register theme + runtime scaffolding (empty day-night scene)"
```

---

## Task 7: Island ground system (`island.ts`) — XCH paves land

**Files:**
- Create: `web/src/themes/mine/island.ts`
- Modify: `web/src/themes/mine/index.ts`
- Test: `web/test/mine-geometry.test.ts`

- [ ] **Step 1: Write the failing geometry test**

```ts
// web/test/mine-geometry.test.ts
import * as THREE from "three";
import { expect, test } from "vitest";
import { groundGeometry } from "../src/themes/mine/island.js";

test("ground geometry is a valid renderable cube", () => {
  const g = groundGeometry();
  expect(g).toBeInstanceOf(THREE.BufferGeometry);
  expect(g.getAttribute("position").count).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run web/test/mine-geometry.test.ts`
Expected: FAIL — cannot find module `mine/island.js`.

- [ ] **Step 3: Create `island.ts`**

```ts
// web/src/themes/mine/island.ts
import * as THREE from "three";
import type { SproutEvent } from "@grove/shared";
import type { XZ } from "../shared/util.js";
import { InstancedKind, type Pose } from "../shared/instanced.js";
import { MINE } from "./palette.js";
import { floorCell, cellLocal, type Cell } from "./layout.js";

const GROUND_CAP = 2000;

/** Unit cube whose base sits at y=0 so it grows upward from its seat. */
export function groundGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  return g;
}

const FLAT_POSE = (): Pose => ({ height: 1, rotY: 0, tiltX: 0, tiltZ: 0, swayPhase: 0 });

export class Island {
  private readonly ground: InstancedKind;
  private readonly grass = new THREE.Color(MINE.grassTop);
  private readonly dirt = new THREE.Color(MINE.dirt);
  // per-current-block occupancy + floor cursor (reset on each new block)
  private occupied = new Set<string>();
  private floorCursor = 0;
  private chunk: XZ = { x: 0, z: 0 };

  constructor(scene: THREE.Scene) {
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
    this.ground = new InstancedKind(scene, groundGeometry(), material, GROUND_CAP, 0, 140, 1);
  }

  /** Begin a new block's chunk. */
  startBlock(chunk: XZ): void {
    this.chunk = chunk;
    this.occupied = new Set();
    this.floorCursor = 0;
  }

  /** XCH spend → next grass floor tile. */
  placeGrass(event: SproutEvent, t: number): void {
    const cell = floorCell(this.floorCursor++);
    this.place(event, cell, this.grass, t);
  }

  /** Ensure a ground cube under a special's cell (dirt if XCH didn't pave it). */
  ensureGround(event: SproutEvent, cell: Cell, t: number): void {
    this.place(event, cell, this.dirt, t);
  }

  private place(event: SproutEvent, cell: Cell, color: THREE.Color, t: number): void {
    const key = `${cell.col},${cell.row}`;
    if (this.occupied.has(key)) return;
    this.occupied.add(key);
    const local = cellLocal(cell, 0);
    const pose = FLAT_POSE();
    pose.color = color;
    pose.y = local.y;
    this.ground.plant(event, this.chunk.x + local.x, this.chunk.z + local.z, t, pose);
  }

  update(t: number): void {
    this.ground.update(t, 1);
  }

  clearAbove(forkHeight: number): void {
    this.ground.clearWhere((m) => m.height >= forkHeight);
  }

  pickables(): THREE.Object3D[] {
    return [this.ground.mesh];
  }
  metaFor(object: THREE.Object3D, instanceId: number | undefined): SproutEvent | null {
    return object === this.ground.mesh ? this.ground.metaAt(instanceId ?? -1) : null;
  }
}
```

- [ ] **Step 4: Wire into `index.ts`**

In `mine/index.ts`, import and instantiate the Island, route XCH sprouts to it, and start a block. Replace the `start()` body so far with this richer version (it grows again in later tasks):

```ts
  start(canvas, feed) {
    const runtime = startMine(canvas, feed);
    const island = new Island(runtime.scene);
    const clock = { t: 0 };

    runtime.setBlockHandler((chunk) => island.startBlock(chunk));
    runtime.setSproutHandler((event, _chunk, _height) => {
      if (event.kind === "xch") island.placeGrass(event, clock.t);
      // CAT/NFT/DID added in later tasks
    });
    runtime.setReorgHandler((forkHeight) => island.clearAbove(forkHeight));

    const frameCallbacks: Array<() => void> = [];
    runtime.setUpdateHandler((_dt, t) => {
      clock.t = t;
      island.update(t);
      for (const fn of frameCallbacks) fn();
    });
    return {
      camera: runtime.camera,
      onFrame: (fn) => frameCallbacks.push(fn),
      isDragging: () => runtime.isDragging(),
      pickables: () => island.pickables(),
      metaFor: (object, instanceId) => island.metaFor(object, instanceId),
      setHovered: () => {},
    };
  },
```

Add the import at the top: `import { Island } from "./island.js";`

> Note: the first `block` event arrives before any sprout, so `startBlock` runs first. If a demo sends sprouts before any block, `island` still has a valid default chunk from construction.

- [ ] **Step 5: Verify + commit**

Run: `npx vitest run web/test/mine-geometry.test.ts && npm run typecheck`
Manual: `?theme=mine&demo=1` → a grass/dirt island spreads as blocks arrive.

```bash
git add web/src/themes/mine/island.ts web/src/themes/mine/index.ts web/test/mine-geometry.test.ts
git commit -m "feat(mine): XCH ground system paves the island"
```

---

## Task 8: CAT block families (`cats.ts`)

**Files:**
- Create: `web/src/themes/mine/cats.ts`
- Modify: `web/src/themes/mine/index.ts`
- Test: `web/test/mine-geometry.test.ts` (extend)

- [ ] **Step 1: Add failing test**

```ts
import { cubeGeometry } from "../src/themes/mine/cats.js";

test("cat cube geometry is a valid renderable cube", () => {
  const g = cubeGeometry();
  expect(g.getAttribute("position").count).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run web/test/mine-geometry.test.ts`
Expected: FAIL — cannot find module `mine/cats.js`.

- [ ] **Step 3: Create `cats.ts`**

```ts
// web/src/themes/mine/cats.ts
import * as THREE from "three";
import type { SproutEvent } from "@grove/shared";
import type { XZ } from "../shared/util.js";
import { mulberry32 } from "../shared/util.js";
import { InstancedKind, type Pose } from "../shared/instanced.js";
import { resolveCatBlock, type CatFamily } from "./material.js";
import { seatCell, cellLocal } from "./layout.js";

const CAPS: Record<CatFamily, number> = { opaque: 400, transparent: 120, emissive: 80 };
const SPECIAL_BUDGET = 192; // cap cubes placed per block (airdrops stay bounded)

export function cubeGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(0.92, 0.92, 0.92);
  g.translate(0, 0.46, 0);
  return g;
}

function opaqueMaterial(): THREE.Material {
  return new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true });
}
function transparentMaterial(): THREE.Material {
  return new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.55, depthWrite: false, flatShading: true });
}
function emissiveMaterial(): THREE.Material {
  const m = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffffff, emissiveIntensity: 1.4, roughness: 0.5 });
  // route per-instance color into the emissive term (same trick as grove mushrooms)
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      "#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= vColor.rgb;"
    );
  };
  return m;
}

export class CatBlocks {
  private readonly fam: Record<CatFamily, InstancedKind>;
  private readonly color = new THREE.Color();
  private chunk: XZ = { x: 0, z: 0 };
  private seatIndex = 0;
  /** index.ts calls this to know which cell to ground before placing. */
  lastSeat = { col: 0, row: 0, layer: 1 };

  constructor(scene: THREE.Scene) {
    this.fam = {
      opaque: new InstancedKind(scene, cubeGeometry(), opaqueMaterial(), CAPS.opaque, 0, 140, 1),
      transparent: new InstancedKind(scene, cubeGeometry(), transparentMaterial(), CAPS.transparent, 0, 140, 1),
      emissive: new InstancedKind(scene, cubeGeometry(), emissiveMaterial(), CAPS.emissive, 0, 140, 1),
    };
  }

  startBlock(chunk: XZ): void {
    this.chunk = chunk;
    this.seatIndex = 0;
  }

  /** Returns the seat cell so the caller can ground it; null if over budget. */
  nextSeat(): { col: number; row: number; layer: number } | null {
    if (this.seatIndex >= SPECIAL_BUDGET) return null;
    const seat = seatCell(this.seatIndex++);
    this.lastSeat = seat;
    return seat;
  }

  plant(event: SproutEvent, seat: { col: number; row: number; layer: number }, t: number): void {
    const block = resolveCatBlock(event.assetId ?? "0".repeat(64));
    const rand = mulberry32(parseInt(event.coinId.slice(8, 16) || "0", 16));
    this.color.setHSL(block.color.h, block.color.s, block.color.l);
    const local = cellLocal({ col: seat.col, row: seat.row }, seat.layer);
    const pose: Pose = {
      height: 1,
      rotY: 0,
      tiltX: 0,
      tiltZ: 0,
      swayPhase: 0,
      y: local.y,
      color: this.color,
    };
    const jx = (rand() - 0.5) * 0.06;
    const jz = (rand() - 0.5) * 0.06;
    this.fam[block.family].plant(event, this.chunk.x + local.x + jx, this.chunk.z + local.z + jz, t, pose);
  }

  update(t: number): void {
    for (const k of Object.values(this.fam)) k.update(t, 1);
  }
  clearAbove(forkHeight: number): void {
    for (const k of Object.values(this.fam)) k.clearWhere((m) => m.height >= forkHeight);
  }
  pickables(): THREE.Object3D[] {
    return Object.values(this.fam).map((k) => k.mesh);
  }
  metaFor(object: THREE.Object3D, instanceId: number | undefined): SproutEvent | null {
    const k = Object.values(this.fam).find((f) => f.mesh === object);
    return k ? k.metaAt(instanceId ?? -1) : null;
  }
  setHighlight(object: THREE.Object3D, instanceId: number, on: boolean): boolean {
    const k = Object.values(this.fam).find((f) => f.mesh === object);
    if (!k) return false;
    k.setHighlight(instanceId, on);
    return true;
  }
}
```

- [ ] **Step 4: Wire into `index.ts`**

Import `import { CatBlocks } from "./cats.js";`, instantiate `const cats = new CatBlocks(runtime.scene);`, add `cats.startBlock(chunk)` in the block handler, and extend the sprout handler:

```ts
    runtime.setSproutHandler((event, _chunk, _height) => {
      if (event.kind === "xch") {
        island.placeGrass(event, clock.t);
        return;
      }
      if (event.kind === "cat") {
        const seat = cats.nextSeat();
        if (!seat) return;
        island.ensureGround(event, { col: seat.col, row: seat.row }, clock.t);
        cats.plant(event, seat, clock.t);
      }
      // NFT/DID added next
    });
```

Add `cats.update(t)` to the update handler, `cats.clearAbove(forkHeight)` to the reorg handler, and include cats in `pickables`/`metaFor`. Update the returned handle:

```ts
      pickables: () => [...island.pickables(), ...cats.pickables()],
      metaFor: (object, instanceId) =>
        island.metaFor(object, instanceId) ?? cats.metaFor(object, instanceId),
      setHovered: (object, instanceId) => {
        if (object && instanceId !== undefined) cats.setHighlight(object, instanceId, true);
      },
```

> For correct hover clearing, track the last highlighted (object, instanceId) in a closure variable and clear it before setting a new one — mirror grove's `setHovered`. Concretely:

```ts
    let hovered: { object: THREE.Object3D; index: number } | null = null;
    // inside setHovered:
    if (hovered) { cats.setHighlight(hovered.object, hovered.index, false); hovered = null; }
    if (object && instanceId !== undefined && cats.setHighlight(object, instanceId, true)) {
      hovered = { object, index: instanceId };
    }
```

(Add `import * as THREE from "three";` to `index.ts` for the closure type.)

- [ ] **Step 5: Verify + commit**

Run: `npx vitest run web/test/mine-geometry.test.ts && npm run typecheck`
Manual: `?theme=mine&demo=1` → colored CAT cubes on the island; transparent/emissive variants appear; an airdrop-heavy block stacks into a spire. Hovering a CAT highlights it; clicking shows the detail card.

```bash
git add web/src/themes/mine/cats.ts web/src/themes/mine/index.ts web/test/mine-geometry.test.ts
git commit -m "feat(mine): CAT block families (opaque/transparent/emissive) with stacking"
```

---

## Task 9: Structures — DID villagers (`structures.ts`)

**Files:**
- Create: `web/src/themes/mine/structures.ts`
- Modify: `web/src/themes/mine/index.ts`
- Test: `web/test/mine-geometry.test.ts` (extend)

- [ ] **Step 1: Add failing test**

```ts
import { villagerGeometry } from "../src/themes/mine/structures.js";

test("villager geometry is valid and renderable", () => {
  const g = villagerGeometry();
  expect(g.getAttribute("position").count).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run web/test/mine-geometry.test.ts`
Expected: FAIL — cannot find module `mine/structures.js`.

- [ ] **Step 3: Create `structures.ts` (villagers now; NFT frames in Task 10)**

```ts
// web/src/themes/mine/structures.ts
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { SproutEvent } from "@grove/shared";
import type { XZ } from "../shared/util.js";
import { cellLocal } from "./layout.js";

const VILLAGER_CAP = 80;

/** Blocky villager (robe body, head, big nose) merged into one geometry. */
export function villagerGeometry(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(0.5, 0.7, 0.35);
  body.translate(0, 0.35, 0);
  const head = new THREE.BoxGeometry(0.45, 0.45, 0.45);
  head.translate(0, 0.92, 0);
  const nose = new THREE.BoxGeometry(0.14, 0.28, 0.18);
  nose.translate(0, 0.86, 0.22);
  return mergeGeometries([body, head, nose]);
}

interface Villager {
  mesh: THREE.Mesh;
  meta: SproutEvent | null;
  bornAt: number;
}

export class Villagers {
  private readonly pool: Villager[];
  private next = 0;
  private readonly group = new THREE.Group();

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    const geometry = villagerGeometry();
    const material = new THREE.MeshStandardMaterial({ color: 0x7a6a52, roughness: 0.9, flatShading: true });
    this.pool = Array.from({ length: VILLAGER_CAP }, () => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      this.group.add(mesh);
      return { mesh, meta: null, bornAt: 0 };
    });
  }

  plant(event: SproutEvent, chunk: XZ, seat: { col: number; row: number; layer: number }, t: number): void {
    const v = this.pool[this.next];
    this.next = (this.next + 1) % VILLAGER_CAP;
    const local = cellLocal({ col: seat.col, row: seat.row }, seat.layer);
    v.mesh.position.set(chunk.x + local.x, local.y, chunk.z + local.z);
    v.mesh.visible = true;
    v.meta = event;
    v.bornAt = t;
  }

  update(t: number): void {
    for (const v of this.pool) {
      if (!v.meta) continue;
      const p = Math.min((t - v.bornAt) / 0.6, 1);
      v.mesh.scale.setScalar(p); // pop-in
    }
  }
  clearAbove(forkHeight: number): void {
    for (const v of this.pool) {
      if (v.meta && v.meta.height >= forkHeight) {
        v.meta = null;
        v.mesh.visible = false;
      }
    }
  }
  pickables(): THREE.Object3D[] {
    return this.pool.filter((v) => v.meta).map((v) => v.mesh);
  }
  metaFor(object: THREE.Object3D): SproutEvent | null {
    return this.pool.find((v) => v.mesh === object)?.meta ?? null;
  }
}
```

- [ ] **Step 4: Wire into `index.ts`**

Import `Villagers`, instantiate, add to the DID branch of the sprout handler (reusing the seat machinery from cats so DIDs also seat + ground):

```ts
      if (event.kind === "did") {
        const seat = cats.nextSeat();
        if (!seat) return;
        island.ensureGround(event, { col: seat.col, row: seat.row }, clock.t);
        villagers.plant(event, chunk, seat, clock.t);
      }
```

Note: the sprout handler's second parameter is the chunk — rename `_chunk` to `chunk` in the handler signature. Add `villagers.update(t)` to the update handler, `villagers.clearAbove(forkHeight)` to reorg, and include villager pickables/metaFor in the handle.

- [ ] **Step 5: Verify + commit**

Run: `npx vitest run web/test/mine-geometry.test.ts && npm run typecheck`
Manual: `?theme=mine&demo=1` → villagers appear for DID spends and are clickable.

```bash
git add web/src/themes/mine/structures.ts web/src/themes/mine/index.ts web/test/mine-geometry.test.ts
git commit -m "feat(mine): DID villagers"
```

---

## Task 10: NFT framed paintings (`structures.ts`)

**Files:**
- Modify: `web/src/themes/mine/structures.ts`, `web/src/themes/mine/index.ts`
- Reference: `web/src/themes/gallery/media.ts` (existing NFT texture-loading + proxy pattern — follow it for the URL and `THREE.TextureLoader` usage)

- [ ] **Step 1: Add a `Paintings` class to `structures.ts`**

```ts
const PAINTING_CAP = 40;

interface Painting {
  group: THREE.Group;
  panel: THREE.Mesh;
  meta: SproutEvent | null;
}

export class Paintings {
  private readonly pool: Painting[];
  private next = 0;
  private readonly loader = new THREE.TextureLoader();

  constructor(scene: THREE.Scene) {
    const frameGeo = new THREE.BoxGeometry(1.1, 1.3, 0.12);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x5a3d23, roughness: 0.8, flatShading: true });
    const panelGeo = new THREE.PlaneGeometry(0.9, 1.1);
    this.pool = Array.from({ length: PAINTING_CAP }, () => {
      const group = new THREE.Group();
      const frame = new THREE.Mesh(frameGeo, frameMat);
      const panel = new THREE.Mesh(panelGeo, new THREE.MeshBasicMaterial({ color: 0x9fb6c9 }));
      panel.position.z = 0.07;
      group.add(frame, panel);
      group.visible = false;
      scene.add(group);
      return { group, panel, meta: null };
    });
  }

  plant(event: SproutEvent, chunk: XZ, seat: { col: number; row: number; layer: number }): void {
    const p = this.pool[this.next];
    this.next = (this.next + 1) % PAINTING_CAP;
    const local = cellLocal({ col: seat.col, row: seat.row }, seat.layer);
    p.group.position.set(chunk.x + local.x, local.y + 0.65, chunk.z + local.z);
    p.group.visible = true;
    p.meta = event;
    // load the art onto the panel; keep the placeholder if it fails
    if (event.imageUrl) {
      this.loader.load(
        event.imageUrl,
        (tex) => {
          tex.magFilter = THREE.NearestFilter;
          tex.colorSpace = THREE.SRGBColorSpace;
          (p.panel.material as THREE.MeshBasicMaterial).map = tex;
          (p.panel.material as THREE.MeshBasicMaterial).color.set(0xffffff);
          (p.panel.material as THREE.MeshBasicMaterial).needsUpdate = true;
        },
        undefined,
        () => {}
      );
    }
  }

  /** Face the painting toward the orbiting camera each frame. */
  update(camera: THREE.Camera): void {
    for (const p of this.pool) {
      if (p.meta) p.group.lookAt(camera.position.x, p.group.position.y, camera.position.z);
    }
  }
  clearAbove(forkHeight: number): void {
    for (const p of this.pool) {
      if (p.meta && p.meta.height >= forkHeight) { p.meta = null; p.group.visible = false; }
    }
  }
  pickables(): THREE.Object3D[] {
    return this.pool.filter((p) => p.meta).map((p) => p.panel);
  }
  metaFor(object: THREE.Object3D): SproutEvent | null {
    return this.pool.find((p) => p.panel === object)?.meta ?? null;
  }
}
```

- [ ] **Step 2: Wire into `index.ts`**

Instantiate `Paintings`, add the NFT branch:

```ts
      if (event.kind === "nft") {
        const seat = cats.nextSeat();
        if (!seat) return;
        island.ensureGround(event, { col: seat.col, row: seat.row }, clock.t);
        paintings.plant(event, chunk, seat);
      }
```

Add `paintings.update(runtime.camera)` to the update handler, `paintings.clearAbove(forkHeight)` to reorg, and include painting pickables/metaFor in the handle (so the detail card's MintGarden link works via the shared picker — `metaFor` returns the `SproutEvent` with `nftId`/`imageUrl`).

- [ ] **Step 3: Verify + commit**

Run: `npm run typecheck`
Manual: `?theme=mine&demo=1` → framed paintings show NFT art (or a placeholder), face the camera, and clicking opens the detail card with the MintGarden link.

```bash
git add web/src/themes/mine/structures.ts web/src/themes/mine/index.ts
git commit -m "feat(mine): NFT framed paintings with MintGarden detail card"
```

---

## Task 11: VFX — mint beacon beams + mempool rim torches (`vfx.ts`)

**Files:**
- Create: `web/src/themes/mine/vfx.ts`
- Modify: `web/src/themes/mine/index.ts`
- Test: `web/test/mine-geometry.test.ts` (extend with torch geometry)

- [ ] **Step 1: Add failing test**

```ts
import { torchGeometry } from "../src/themes/mine/vfx.js";

test("torch geometry is valid and renderable", () => {
  expect(torchGeometry().getAttribute("position").count).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run web/test/mine-geometry.test.ts`
Expected: FAIL — cannot find module `mine/vfx.js`.

- [ ] **Step 3: Create `vfx.ts`**

```ts
// web/src/themes/mine/vfx.ts
import * as THREE from "three";
import type { XZ } from "../shared/util.js";
import { MINE } from "./palette.js";

const BEACON_CAP = 12;
const TORCH_CAP = 60;

export function torchGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(0.12, 0.6, 0.12);
  g.translate(0, 0.3, 0);
  return g;
}

interface Beacon {
  mesh: THREE.Mesh;
  bornAt: number;
  active: boolean;
}

export class Vfx {
  private readonly beacons: Beacon[];
  private nextBeacon = 0;
  private readonly torches: THREE.Mesh[];
  private readonly flames: THREE.Sprite[];
  private litCount = 0;

  constructor(
    scene: THREE.Scene,
    private readonly sky: { daylight: number }
  ) {
    const beamGeo = new THREE.CylinderGeometry(0.18, 0.18, 60, 8, 1, true);
    beamGeo.translate(0, 30, 0);
    this.beacons = Array.from({ length: BEACON_CAP }, () => {
      const mesh = new THREE.Mesh(
        beamGeo,
        new THREE.MeshBasicMaterial({ color: MINE.beacon, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false })
      );
      mesh.visible = false;
      scene.add(mesh);
      return { mesh, bornAt: 0, active: false };
    });

    const torchGeo = torchGeometry();
    const torchMat = new THREE.MeshStandardMaterial({ color: 0x5a3d23, roughness: 0.9 });
    const flameMat = () => new THREE.SpriteMaterial({ color: MINE.torch, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.torches = [];
    this.flames = [];
    for (let i = 0; i < TORCH_CAP; i++) {
      const angle = (i / TORCH_CAP) * Math.PI * 2;
      const r = 40;
      const torch = new THREE.Mesh(torchGeo, torchMat);
      torch.position.set(Math.cos(angle) * r, 0, Math.sin(angle) * r);
      torch.visible = false;
      scene.add(torch);
      const flame = new THREE.Sprite(flameMat());
      flame.scale.setScalar(0.9);
      flame.position.copy(torch.position).setY(0.7);
      scene.add(flame);
      this.torches.push(torch);
      this.flames.push(flame);
    }
  }

  /** Mint flag → fire a beacon beam from the block's chunk. */
  beacon(chunk: XZ, t: number): void {
    const b = this.beacons[this.nextBeacon];
    this.nextBeacon = (this.nextBeacon + 1) % BEACON_CAP;
    b.mesh.position.set(chunk.x, 0, chunk.z);
    b.mesh.visible = true;
    b.active = true;
    b.bornAt = t;
  }

  /** Mempool size → number of lit rim torches. */
  setMempool(size: number): void {
    this.litCount = Math.max(0, Math.min(TORCH_CAP, Math.round(size / 4)));
  }

  update(t: number): void {
    for (const b of this.beacons) {
      if (!b.active) continue;
      const age = t - b.bornAt;
      const op = Math.max(0, 0.7 - age * 0.25);
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = op;
      if (op <= 0) { b.active = false; b.mesh.visible = false; }
    }
    const night = 1 - this.sky.daylight;
    for (let i = 0; i < TORCH_CAP; i++) {
      const lit = i < this.litCount;
      this.torches[i].visible = lit;
      const flicker = 0.7 + 0.3 * Math.sin(t * 6 + i);
      (this.flames[i].material as THREE.SpriteMaterial).opacity = lit ? night * flicker : 0;
    }
  }
}
```

- [ ] **Step 4: Wire into `index.ts`**

Instantiate `const vfx = new Vfx(runtime.scene, runtime.sky);`. In the sprout handler, when `event.mint` is true, fire a beacon: `if (event.mint) vfx.beacon(chunk, clock.t);`. Route ambient mempool: `runtime.setAmbientHandler((mempoolSize) => vfx.setMempool(mempoolSize));`. Add `vfx.update(t)` to the update handler.

- [ ] **Step 5: Verify + commit**

Run: `npx vitest run web/test/mine-geometry.test.ts && npm run typecheck`
Manual: `?theme=mine&demo=1` → minted singletons shoot a beacon beam; rim torches light up at night and scale with mempool.

```bash
git add web/src/themes/mine/vfx.ts web/src/themes/mine/index.ts web/test/mine-geometry.test.ts
git commit -m "feat(mine): mint beacon beams + mempool rim torches"
```

---

## Task 12: Reorg creeper burst + full cull wiring

The cull methods (`clearAbove`) already exist on Island, CatBlocks, Villagers, Paintings. This task adds the creeper explosion particle burst and confirms all systems cull together.

**Files:**
- Modify: `web/src/themes/mine/vfx.ts`, `web/src/themes/mine/index.ts`

- [ ] **Step 1: Add a particle burst to `vfx.ts`**

Add a small additive `THREE.Points` burst (a pooled cloud of green creeper-ish particles) with a `creeper(at: XZ, t)` method that activates it, and advance it in `update` (expand + fade over ~0.8 s). Concretely, add to the `Vfx` class:

```ts
  private burst!: THREE.Points;
  private burstVel!: Float32Array;
  private burstStart = -1;
```

In the constructor, after the torches:

```ts
    const N = 80;
    const pos = new Float32Array(N * 3);
    this.burstVel = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const dir = new THREE.Vector3().randomDirection();
      this.burstVel[i * 3] = dir.x * 6;
      this.burstVel[i * 3 + 1] = Math.abs(dir.y) * 6 + 2;
      this.burstVel[i * 3 + 2] = dir.z * 6;
    }
    const bg = new THREE.BufferGeometry();
    bg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.burst = new THREE.Points(bg, new THREE.PointsMaterial({ color: 0x5bbb5b, size: 0.5, transparent: true, opacity: 0, depthWrite: false }));
    this.burst.visible = false;
    scene.add(this.burst);
```

Add the method:

```ts
  creeper(at: XZ, t: number): void {
    const p = this.burst.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setXYZ(i, at.x, 1, at.z);
    p.needsUpdate = true;
    this.burst.visible = true;
    this.burstStart = t;
  }
```

In `update(t)`, advance the burst:

```ts
    if (this.burstStart >= 0) {
      const age = t - this.burstStart;
      const p = this.burst.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        p.setXYZ(i, p.getX(i) + this.burstVel[i * 3] * 0.016, Math.max(0, p.getY(i) + (this.burstVel[i * 3 + 1] - age * 9) * 0.016), p.getZ(i) + this.burstVel[i * 3 + 2] * 0.016);
      }
      p.needsUpdate = true;
      (this.burst.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - age / 0.8);
      if (age > 0.8) { this.burst.visible = false; this.burstStart = -1; }
    }
```

- [ ] **Step 2: Wire reorg in `index.ts`**

Update the reorg handler to cull everything and fire the burst at the most-recent chunk:

```ts
    runtime.setReorgHandler((forkHeight) => {
      island.clearAbove(forkHeight);
      cats.clearAbove(forkHeight);
      villagers.clearAbove(forkHeight);
      paintings.clearAbove(forkHeight);
      vfx.creeper(currentChunkRef.value, clock.t);
    });
```

`currentChunkRef` is a `{ value: XZ }` updated in the block handler (`runtime.setBlockHandler((chunk) => { currentChunkRef.value = chunk; island.startBlock(chunk); cats.startBlock(chunk); })`). Initialize `const currentChunkRef = { value: { x: 0, z: 0 } as XZ };`.

- [ ] **Step 3: Verify + commit**

Run: `npm run typecheck`
Manual: trigger a reorg in demo mode (or wait for one live) → recent blocks vanish in a green creeper burst.

```bash
git add web/src/themes/mine/vfx.ts web/src/themes/mine/index.ts
git commit -m "feat(mine): reorg creeper burst + cull all systems above fork height"
```

---

## Task 13: Final integration pass — full suite, typecheck, lint, build

**Files:** none (verification only), small fixes as needed.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS (all existing + new mine tests).

- [ ] **Step 2: Typecheck all workspaces**

Run: `npm run typecheck`
Expected: clean. Fix any handler-signature mismatches (the sprout handler now uses `(event, chunk, height)`).

- [ ] **Step 3: Lint + format**

Run: `npm run lint && npm run format`
Expected: clean.

- [ ] **Step 4: Production build**

Run: `npm run build`
Expected: succeeds; `web/dist/` produced.

- [ ] **Step 5: Manual acceptance against the spec**

`npm run dev:web`, open `http://localhost:5173/?theme=mine&demo=1` and confirm:
- island spreads outward as blocks arrive; XCH paves grass, specials get ground under them;
- CATs vary by material/color; transparent + emissive families appear; airdrops stack into a spire;
- NFTs are framed paintings (art or placeholder) and open the detail card with MintGarden link;
- DID villagers appear; mint fires a beacon; mempool lights rim torches at night;
- day-night cycle runs; netspace nudges sun/fog; reorg triggers a creeper burst and removes recent blocks;
- switching themes from the legend persists and reloads; the snapshot replay repopulates the island.

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "chore(mine): integration fixes — full suite, typecheck, lint, build green"
```

---

## Self-review notes (addressed)

- **Spec coverage:** world shape/island growth (Tasks 6–7), XCH-as-land + airdrop ground floor (Task 7 `ensureGround`), CAT material families + determinism (Tasks 3, 8), dense-block stacking + budget (Tasks 4, 8 `SPECIAL_BUDGET`), NFT paintings + MintGarden (Task 10), DID villagers (Task 9), mint beacons / mempool torches / netspace / day-night (Tasks 5, 6, 11), reorg cull + creeper (Tasks 1, 12), picker reuse (Tasks 7–10), registration + legend (Task 6), tests (every pure module). 
- **Type consistency:** the sprout handler signature `(event, chunk, height)` is introduced in Task 6 and used consistently; `seatCell`/`floorCell`/`cellLocal` signatures match across `layout.ts`, `island.ts`, `cats.ts`, `structures.ts`; `clearWhere` (Task 1) backs every `clearAbove`.
- **Known approximations (acceptable, noted in spec §4):** instanced transparent CATs use `depthWrite:false` without per-instance depth sorting; the per-block special budget caps spire height for extreme airdrops.
