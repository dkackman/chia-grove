# Selectable Visualizations + Farm Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the front-end visualization selectable from the legend and add a farm-themed visualization (serpentine crop rows planted by a tractor) alongside the existing grove.

**Architecture:** Theme modules behind a tiny `Visualization` interface + registry (`web/src/themes/`). Each theme owns its whole Three.js scene. Switching persists to localStorage + `?theme=` and reloads; the WebSocket snapshot repopulates the scene. Spec: `docs/superpowers/specs/2026-06-11-farm-visualization-design.md`.

**Tech Stack:** TypeScript, Three.js 0.184, Vite 8, vitest (node environment — tests must not touch `document` at import or construction time; texture-using classes take a `THREE.Texture` parameter).

**Before starting:** run `npm install` at the repo root (node_modules may be absent). All test commands run from the repo root. After each task, the worktree must pass `npx vitest run web/test/` and `npm run typecheck`.

---

## File structure

```
web/src/
  themes/
    types.ts                 NEW  Visualization + VisualizationHandle
    index.ts                 NEW  THEMES registry, resolveTheme, switchTheme
    shared/
      instanced.ts           NEW  InstancedKind/Pose/easeOutCubic (from flora.ts)
      util.ts                NEW  mulberry32, XZ (from scene/layout.ts)
      cat-color.ts           NEW  catColor (from scene/palette.ts)
      scales.ts              NEW  xchHeight, catWidth (from flora.ts)
      textures.ts            MOVED from scene/textures.ts
    grove/
      index.ts               NEW  grove Visualization (wiring from main.ts)
      grove.ts, flora.ts, fireflies.ts, sky.ts, ground.ts,
      layout.ts, palette.ts  MOVED from scene/
    farm/
      palette.ts             NEW  FARM colors
      layout.ts              NEW  FIELD constants, rowZ, rowDirection, plantPosition
      crops.ts               NEW  geometry factories + CropSystem
      tractor.ts             NEW  Tractor
      field.ts               NEW  turf, soil strips, barn
      sky.ts                 NEW  sun, clouds, netspace/signal handling
      chickens.ts            NEW  mempool flock
      crows.ts               NEW  reorg flock
      index.ts               NEW  farm Visualization
  main.ts                    MODIFIED  resolve theme → start → attach shared UI
  ui/legend.ts               MODIFIED  scene <select> + per-theme items
  ui/picker.ts               MODIFIED  takes VisualizationHandle
  style.css                  MODIFIED  scene select + farm swatches
web/test/
  layout.test.ts, palette.test.ts, flora-geometry.test.ts   import paths updated
  themes.test.ts             NEW  registry resolution
  farm-layout.test.ts        NEW  serpentine rows
  farm-geometry.test.ts      NEW  crop geometry validity
  tractor.test.ts            NEW  pass timing
  crops.test.ts              NEW  pending-release planting
web/src/scene/               DELETED (everything moves)
CLAUDE.md                    MODIFIED  architecture paths + theme docs
```

---

### Task 1: Extract theme-neutral helpers to `themes/shared/`

Pure refactor — no behavior change. Existing tests keep passing.

**Files:**
- Create: `web/src/themes/shared/instanced.ts`, `web/src/themes/shared/util.ts`, `web/src/themes/shared/cat-color.ts`, `web/src/themes/shared/scales.ts`, `web/src/themes/shared/textures.ts`
- Modify: `web/src/scene/flora.ts`, `web/src/scene/layout.ts`, `web/src/scene/palette.ts`, `web/src/scene/fireflies.ts`, `web/src/scene/sky.ts`
- Delete: `web/src/scene/textures.ts`

- [ ] **Step 1: Create `web/src/themes/shared/util.ts`**

Move `XZ` and `mulberry32` out of `scene/layout.ts` verbatim:

```ts
export interface XZ {
  x: number;
  z: number;
}

/** Deterministic PRNG (mulberry32) so plant scatter is stable per coin. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

- [ ] **Step 2: Create `web/src/themes/shared/cat-color.ts`**

Move `CAT_HUES` + `catColor` out of `scene/palette.ts` verbatim (including both doc comments). `scene/palette.ts` keeps only `COLORS`.

- [ ] **Step 3: Create `web/src/themes/shared/scales.ts`**

Move `xchHeight` and `catWidth` out of `scene/flora.ts` verbatim (with their doc comments), adding `export` to both.

- [ ] **Step 4: Create `web/src/themes/shared/textures.ts`**

`git mv web/src/scene/textures.ts web/src/themes/shared/textures.ts` (content unchanged).

- [ ] **Step 5: Create `web/src/themes/shared/instanced.ts`**

Move from `scene/flora.ts`, verbatim including all comments: `GROW_SECONDS`, `WHITE`, `HIGHLIGHT_BOOST`, `Slot`, `Pose`, `easeOutCubic`, `makeSlots`, `InstancedKind`. Add `import * as THREE from "three"` and `import type { SproutEvent } from "@grove/shared"`. Export `easeOutCubic`, `InstancedKind`, and `type Pose`.

- [ ] **Step 6: Update the `scene/` files' imports**

`scene/layout.ts`: delete the moved `XZ`/`mulberry32` definitions, add at top:

```ts
import { mulberry32, type XZ } from "../themes/shared/util.js";

export type { XZ };
```

(`layout.ts` still exports `blockPosition` and `sproutOffset`; re-exporting `XZ` keeps `grove.ts`/`fireflies.ts` imports working.)

`scene/flora.ts`: delete the moved code; imports become:

```ts
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { SproutEvent } from "@grove/shared";
import { mulberry32, type XZ } from "../themes/shared/util.js";
import { easeOutCubic, InstancedKind, type Pose } from "../themes/shared/instanced.js";
import { catWidth, xchHeight } from "../themes/shared/scales.js";
import { catColor } from "../themes/shared/cat-color.js";
import { COLORS } from "./palette.js";
import { glowTexture } from "../themes/shared/textures.js";
import { sproutOffset } from "./layout.js";
```

(`flora.ts` keeps `GRASS_VARIANT_HEIGHT`, `VARIANTS`, `CAPS`, the geometry factories, `lean`, `Wisp`, and `FloraSystem`. Note `FloraSystem.update` references `easeOutCubic` for wisps and `CAPS.wisp` — both still resolve.)

`scene/palette.ts`: delete `CAT_HUES`/`catColor`, keep `COLORS`.
`scene/fireflies.ts` and `scene/sky.ts`: change `./textures.js` imports to `../themes/shared/textures.js`.
`scene/flora.ts` already covered. `scene/palette.ts` consumers (`grove.ts`, `ground.ts`) are untouched.

- [ ] **Step 7: Update `web/test/palette.test.ts` import**

```ts
import { catColor } from "../src/themes/shared/cat-color.js";
```

- [ ] **Step 8: Verify**

Run: `npx vitest run web/test/ && npm run typecheck`
Expected: all existing tests pass, typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add -A web/
git commit -m "refactor(web): extract theme-neutral helpers into themes/shared"
```

---

### Task 2: Move grove scene files to `themes/grove/`

Mechanical move; no behavior change.

**Files:**
- Move: `web/src/scene/{grove,flora,fireflies,sky,ground,layout,palette}.ts` → `web/src/themes/grove/`
- Modify: `web/src/main.ts`, `web/src/ui/picker.ts`, `web/test/layout.test.ts`, `web/test/flora-geometry.test.ts`

- [ ] **Step 1: Move the files**

```bash
mkdir -p web/src/themes/grove
git mv web/src/scene/grove.ts web/src/scene/flora.ts web/src/scene/fireflies.ts \
       web/src/scene/sky.ts web/src/scene/ground.ts web/src/scene/layout.ts \
       web/src/scene/palette.ts web/src/themes/grove/
rmdir web/src/scene
```

- [ ] **Step 2: Fix relative imports inside the moved files**

Within `themes/grove/` the sibling imports (`./palette.js`, `./layout.js`, …) still resolve. Only depth-sensitive paths change:

- `grove.ts`: `../net/feed.js` → `../../net/feed.js`
- `flora.ts`, `layout.ts`: `../themes/shared/...` → `../shared/...`
- `fireflies.ts`, `sky.ts`: `../themes/shared/textures.js` → `../shared/textures.js`
- `palette.ts`: no imports to change

- [ ] **Step 3: Update consumers**

`web/src/main.ts`: `./scene/grove.js` → `./themes/grove/grove.js`, `./scene/flora.js` → `./themes/grove/flora.js`, `./scene/fireflies.js` → `./themes/grove/fireflies.js`.
`web/src/ui/picker.ts`: `../scene/flora.js` → `../themes/grove/flora.js`.
`web/test/layout.test.ts`: `../src/scene/layout.js` → `../src/themes/grove/layout.js`.
`web/test/flora-geometry.test.ts`: `../src/scene/flora.js` → `../src/themes/grove/flora.js`.

- [ ] **Step 4: Verify**

Run: `npx vitest run web/test/ && npm run typecheck && npm run lint`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add -A web/
git commit -m "refactor(web): move grove scene into themes/grove"
```

---

### Task 3: Theme interfaces, grove theme module, registry

**Files:**
- Create: `web/src/themes/types.ts`, `web/src/themes/grove/index.ts`, `web/src/themes/index.ts`
- Test: `web/test/themes.test.ts`

- [ ] **Step 1: Write the failing test** (`web/test/themes.test.ts`)

```ts
import { expect, test } from "vitest";
import { resolveTheme, THEMES } from "../src/themes/index.js";

test("unknown or missing theme falls back to grove", () => {
  expect(resolveTheme("", null).id).toBe("grove");
  expect(resolveTheme("?theme=bogus", null).id).toBe("grove");
  expect(resolveTheme("", "bogus").id).toBe("grove");
});

test("url param wins over stored value", () => {
  expect(resolveTheme("?theme=grove", "other").id).toBe("grove");
});

test("every theme has an id, label, and non-empty legend", () => {
  expect(THEMES.length).toBeGreaterThanOrEqual(1);
  for (const theme of THEMES) {
    expect(theme.id).toBeTruthy();
    expect(theme.label).toBeTruthy();
    expect(theme.legend.length).toBeGreaterThan(0);
  }
});
```

- [ ] **Step 2: Run it** — `npx vitest run web/test/themes.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Create `web/src/themes/types.ts`**

```ts
import type * as THREE from "three";
import type { SproutEvent } from "@grove/shared";
import type { GroveFeed } from "../net/feed.js";

/** What the shared UI (picker, detail card) needs from a running scene. */
export interface VisualizationHandle {
  camera: THREE.PerspectiveCamera;
  onFrame(fn: () => void): void;
  pickables(): THREE.Object3D[];
  metaFor(object: THREE.Object3D, instanceId: number | undefined): SproutEvent | null;
  setHovered(object: THREE.Object3D | null, instanceId: number | undefined): void;
}

export interface Visualization {
  id: string;
  label: string;
  legend: ReadonlyArray<readonly [swatchClass: string, label: string]>;
  start(canvas: HTMLCanvasElement, feed: GroveFeed): VisualizationHandle;
}
```

- [ ] **Step 4: Create `web/src/themes/grove/index.ts`** (wiring moved from `main.ts`)

```ts
import type { Visualization } from "../types.js";
import { startGrove } from "./grove.js";
import { FloraSystem } from "./flora.js";
import { Fireflies } from "./fireflies.js";

export const grove: Visualization = {
  id: "grove",
  label: "grove",
  legend: [
    ["sw-grass", "grass — XCH spend (taller = larger)"],
    ["sw-cat", "mushroom — CAT transfer (color = asset)"],
    ["sw-nft", "bloom — NFT (bursts on mint)"],
    ["sw-did", "wisp — DID activity"],
    ["sw-firefly", "fireflies — mempool"],
    ["sw-moon", "moonlight — netspace"],
    ["sw-ripple", "ripple — new block"],
  ],
  start(canvas, feed) {
    const runtime = startGrove(canvas, feed);
    const flora = new FloraSystem(runtime.scene);
    const clockRef = { t: 0 };
    runtime.setSproutHandler((event, blockPos) => flora.plant(event, blockPos, clockRef.t));
    const fireflies = new Fireflies(runtime.scene, runtime.reducedMotion ? 150 : 400);
    runtime.setAmbientHandler((mempoolSize, mempoolCost) =>
      fireflies.setMempool(mempoolSize, mempoolCost)
    );
    runtime.setBlockHandler((pos) => {
      fireflies.diveTo(pos, clockRef.t);
      if (!runtime.reducedMotion) flora.gust(clockRef.t);
    });
    runtime.setReorgHandler(() => {
      flora.gust(clockRef.t);
      fireflies.scatter();
    });
    const frameCallbacks: Array<() => void> = [];
    runtime.setUpdateHandler((dt, t) => {
      clockRef.t = t;
      flora.update(t, dt);
      fireflies.update(t);
      for (const fn of frameCallbacks) fn();
    });
    return {
      camera: runtime.camera,
      onFrame: (fn) => frameCallbacks.push(fn),
      pickables: () => flora.pickables(),
      metaFor: (object, instanceId) => flora.metaFor(object, instanceId),
      setHovered: (object, instanceId) => flora.setHovered(object, instanceId),
    };
  },
};
```

- [ ] **Step 5: Create `web/src/themes/index.ts`**

```ts
import type { Visualization } from "./types.js";
import { grove } from "./grove/index.js";

export const THEMES: readonly Visualization[] = [grove];
export const THEME_STORAGE_KEY = "grove.theme";

/** Pure (no DOM access) so it's unit-testable: URL param wins, then stored, then grove. */
export function resolveTheme(search: string, stored: string | null): Visualization {
  const requested = new URLSearchParams(search).get("theme") ?? stored;
  return THEMES.find((theme) => theme.id === requested) ?? THEMES[0];
}

/** Persist + reload; the snapshot replay repopulates the new scene. */
export function switchTheme(id: string): void {
  localStorage.setItem(THEME_STORAGE_KEY, id);
  const url = new URL(location.href);
  url.searchParams.set("theme", id);
  location.assign(url.toString());
}
```

- [ ] **Step 6: Run tests** — `npx vitest run web/test/themes.test.ts` — Expected: PASS. Also `npm run typecheck`.

- [ ] **Step 7: Commit**

```bash
git add web/src/themes/ web/test/themes.test.ts
git commit -m "feat(web): theme interface, registry, grove theme module"
```

---

### Task 4: Rewire `main.ts` and generalize the picker

**Files:**
- Modify: `web/src/main.ts`, `web/src/ui/picker.ts`

- [ ] **Step 1: Rewrite `web/src/ui/picker.ts` signature and lookups**

Replace the imports and signature; the debounce/pin body stays identical except `flora.` → `viz.` and the frame hookup:

```ts
import * as THREE from "three";
import type { SproutEvent } from "@grove/shared";
import type { VisualizationHandle } from "../themes/types.js";
import { hideCard, showCard } from "./detail-card.js";

interface Hit {
  object: THREE.Object3D;
  instanceId: number | undefined;
  meta: SproutEvent;
}

export function attachPicker(canvas: HTMLCanvasElement, viz: VisualizationHandle): void {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  function intersect(eventX: number, eventY: number): Hit | null {
    pointer.set((eventX / innerWidth) * 2 - 1, -(eventY / innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointer, viz.camera);
    const hits = raycaster.intersectObjects(viz.pickables(), false);
    for (const hit of hits) {
      const meta = viz.metaFor(hit.object, hit.instanceId);
      if (meta) return { object: hit.object, instanceId: hit.instanceId, meta };
    }
    return null;
  }
  // ... unchanged debounce/pin code ...
  viz.onFrame(() => {
    // unchanged body, with flora.setHovered → viz.setHovered
  });
  // ... unchanged click handler ...
}
```

(Everything from `const SHOW_DELAY_MS` through the click listener is byte-identical apart from `flora.setHovered(...)` → `viz.setHovered(...)` and `onFrame(...)` → `viz.onFrame(...)`.)

- [ ] **Step 2: Rewrite `web/src/main.ts`**

```ts
import { GroveFeed } from "./net/feed.js";
import { resolveTheme, THEME_STORAGE_KEY } from "./themes/index.js";
import { attachPicker } from "./ui/picker.js";
import { BlockConsole } from "./ui/console.js";
import { initLegend } from "./ui/legend.js";

const canvas = document.getElementById("grove") as HTMLCanvasElement;
const status = document.getElementById("status") as HTMLDivElement;

const theme = resolveTheme(location.search, localStorage.getItem(THEME_STORAGE_KEY));
initLegend();
const blockConsole = new BlockConsole(document.getElementById("console") as HTMLDivElement);

const feed = new GroveFeed();
feed.onStatus((s) => {
  status.hidden = s === "live";
  status.textContent =
    s === "demo" ? "demo" : s === "stale" ? "signal lost" : s === "connecting" ? "connecting" : "";
});

const handle = theme.start(canvas, feed);
attachPicker(canvas, handle);
feed.onEvent((event) => blockConsole.handle(event));
feed.start();
```

(`initLegend()` keeps its no-arg signature until Task 5.)

- [ ] **Step 3: Verify** — `npx vitest run web/test/ && npm run typecheck && npm run lint` — Expected: pass.

- [ ] **Step 4: Smoke test in the browser**

Run: `npm run dev:web`, open `http://localhost:5173/?demo=1`. Expected: the grove renders exactly as before; hover highlights and the detail card still work. Stop the server.

- [ ] **Step 5: Commit**

```bash
git add web/src/main.ts web/src/ui/picker.ts
git commit -m "feat(web): boot through theme registry; picker works on any theme"
```

---

### Task 5: Legend scene picker + per-theme items

**Files:**
- Modify: `web/src/ui/legend.ts`, `web/src/main.ts`, `web/src/style.css`

- [ ] **Step 1: Rewrite `web/src/ui/legend.ts`**

```ts
import { switchTheme, THEMES } from "../themes/index.js";
import type { Visualization } from "../themes/types.js";

const COLLAPSED_KEY = "grove.legend.collapsed";

export function initLegend(active: Visualization): void {
  const legend = document.getElementById("legend") as HTMLDivElement;

  const header = document.createElement("button");
  header.id = "legend-toggle";
  header.type = "button";

  const body = document.createElement("div");

  const picker = document.createElement("label");
  picker.id = "legend-scene";
  picker.append("scene");
  const select = document.createElement("select");
  for (const theme of THEMES) {
    const option = document.createElement("option");
    option.value = theme.id;
    option.textContent = theme.label;
    option.selected = theme.id === active.id;
    select.appendChild(option);
  }
  select.addEventListener("change", () => switchTheme(select.value));
  picker.appendChild(select);

  const list = document.createElement("ul");
  for (const [swatchClass, label] of active.legend) {
    const item = document.createElement("li");
    const swatch = document.createElement("span");
    swatch.className = `sw ${swatchClass}`;
    item.append(swatch, label);
    list.appendChild(item);
  }
  body.append(picker, list);

  let collapsed = localStorage.getItem(COLLAPSED_KEY) === "1";
  const render = () => {
    body.hidden = collapsed;
    header.textContent = collapsed ? "ⓘ" : "chia grove ✕";
    legend.classList.toggle("collapsed", collapsed);
  };
  header.addEventListener("click", () => {
    collapsed = !collapsed;
    localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    render();
  });

  legend.append(header, body);
  render();
  legend.hidden = false;
}
```

- [ ] **Step 2: Pass the theme from `main.ts`** — change `initLegend();` to `initLegend(theme);`.

- [ ] **Step 3: Add CSS** to `web/src/style.css`, after the `#legend ul` rule:

```css
#legend-scene {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}

#legend-scene select {
  background: rgba(4, 17, 10, 0.9);
  color: #eafff2;
  border: 1px solid rgba(61, 220, 132, 0.35);
  border-radius: 6px;
  font: inherit;
  padding: 1px 4px;
}
```

- [ ] **Step 4: Verify** — `npm run typecheck && npm run lint`, then `npm run dev:web` + `?demo=1`: the legend shows a "scene" select with one option (grove), items unchanged, collapse still works. Stop the server.

- [ ] **Step 5: Commit**

```bash
git add web/src/ui/legend.ts web/src/main.ts web/src/style.css
git commit -m "feat(web): legend scene picker driven by theme registry"
```

---

### Task 6: Farm palette + serpentine row layout

**Files:**
- Create: `web/src/themes/farm/palette.ts`, `web/src/themes/farm/layout.ts`
- Test: `web/test/farm-layout.test.ts`

- [ ] **Step 1: Write the failing test** (`web/test/farm-layout.test.ts`)

```ts
import { expect, test } from "vitest";
import {
  FIELD,
  plantPosition,
  ROW_CAPACITY,
  rowDirection,
  rowZ,
} from "../src/themes/farm/layout.js";

test("rows are evenly spaced and centered on z=0", () => {
  expect(rowZ(0)).toBeCloseTo(-rowZ(FIELD.rows - 1));
  expect(rowZ(0) - rowZ(1)).toBeCloseTo(FIELD.rowSpacing);
});

test("serpentine direction alternates", () => {
  expect(rowDirection(0)).toBe(1);
  expect(rowDirection(1)).toBe(-1);
  expect(rowDirection(2)).toBe(1);
});

test("plants advance along the row in opposite directions on alternate rows", () => {
  const coin = "deadbeef" + "00".repeat(28);
  const even = [plantPosition(0, 0, coin), plantPosition(0, 10, coin)];
  const odd = [plantPosition(1, 0, coin), plantPosition(1, 10, coin)];
  expect(even[1].x).toBeGreaterThan(even[0].x);
  expect(odd[1].x).toBeLessThan(odd[0].x);
});

test("positions are deterministic per coin id and stay in the field", () => {
  const coin = "cafebabe" + "00".repeat(28);
  expect(plantPosition(3, 7, coin)).toEqual(plantPosition(3, 7, coin));
  for (const index of [0, 50, ROW_CAPACITY - 1, ROW_CAPACITY + 5]) {
    const p = plantPosition(3, index, coin);
    expect(Math.abs(p.x)).toBeLessThanOrEqual(FIELD.rowLength / 2 + 0.2);
    expect(Math.abs(p.z - rowZ(3))).toBeLessThanOrEqual(0.2);
  }
});

test("overflow wraps back along the row", () => {
  const coin = "deadbeef" + "00".repeat(28);
  const wrapped = plantPosition(0, ROW_CAPACITY, coin);
  const first = plantPosition(0, 0, coin);
  expect(Math.abs(wrapped.x - first.x)).toBeLessThan(0.5);
});
```

- [ ] **Step 2: Run it** — `npx vitest run web/test/farm-layout.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Create `web/src/themes/farm/palette.ts`**

```ts
/** Daylight farm palette — soft blue sky, fresh turf, warm plowed soil. */
export const FARM = {
  sky: 0xbfe3ff,
  haze: 0xdef0f7,
  turf: 0x79a861,
  soil: 0x6f4a26,
  wheatEmissive: 0x3a2c0a,
  sunflowerPetal: 0xffc93c,
  scarecrow: 0xa88a5c,
  chicken: 0xfff4e0,
  crow: 0x23232c,
  sun: 0xfff3c4,
  barn: 0xa63d2f,
  barnRoof: 0x5e2a20,
  tractor: 0xc94f35,
  tractorDark: 0x26262a,
} as const;
```

- [ ] **Step 4: Create `web/src/themes/farm/layout.ts`**

```ts
import { mulberry32, type XZ } from "../shared/util.js";

export const FIELD = {
  rows: 48,
  rowLength: 44, // x extent
  rowSpacing: 0.85, // z gap between rows
  plantSpacing: 0.38,
} as const;

export const ROW_CAPACITY = Math.floor(FIELD.rowLength / FIELD.plantSpacing);

/** Rows centered on z=0; row 0 nearest the camera (+z), later rows toward the barn (−z). */
export function rowZ(row: number): number {
  return ((FIELD.rows - 1) / 2) * FIELD.rowSpacing - row * FIELD.rowSpacing;
}

/** Serpentine: even rows plant left→right (+1), odd rows right→left (−1). */
export function rowDirection(row: number): 1 | -1 {
  return row % 2 === 0 ? 1 : -1;
}

/**
 * Where the i-th spend of a block lands. Busy blocks overflow the row and
 * wrap back along it (crowded rows read as dense blocks). Jitter is seeded
 * from the coin id so replayed snapshots place crops identically.
 */
export function plantPosition(row: number, indexInRow: number, coinIdHex: string): XZ {
  const rand = mulberry32(parseInt(coinIdHex.slice(0, 8), 16));
  const along = (indexInRow % ROW_CAPACITY) * FIELD.plantSpacing;
  const x = rowDirection(row) * (-FIELD.rowLength / 2 + along) + (rand() - 0.5) * 0.22;
  const z = rowZ(row) + (rand() - 0.5) * 0.3;
  return { x, z };
}
```

- [ ] **Step 5: Run tests** — `npx vitest run web/test/farm-layout.test.ts` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/themes/farm/ web/test/farm-layout.test.ts
git commit -m "feat(web): farm palette and serpentine row layout"
```

---

### Task 7: Farm crop geometries

**Files:**
- Create: `web/src/themes/farm/crops.ts` (geometry factories; `CropSystem` comes in Task 9)
- Test: `web/test/farm-geometry.test.ts`

- [ ] **Step 1: Write the failing test** (`web/test/farm-geometry.test.ts`)

```ts
import { expect, test } from "vitest";
import {
  gourdGeometries,
  scarecrowGeometries,
  sunflowerGeometries,
  wheatGeometries,
} from "../src/themes/farm/crops.js";

// mergeGeometries returns null when inputs mix indexed and non-indexed
// geometries; a null geometry crashes the renderer on the first frame.
test.each([
  ["wheat", wheatGeometries],
  ["gourd", gourdGeometries],
  ["sunflower", sunflowerGeometries],
  ["scarecrow", scarecrowGeometries],
])("every %s geometry variant is valid and renderable", (_name, factory) => {
  const geometries = factory();
  expect(geometries.length).toBe(3);
  for (const geometry of geometries) {
    expect(geometry).not.toBeNull();
    expect(geometry.getAttribute("position").count).toBeGreaterThan(0);
  }
});
```

- [ ] **Step 2: Run it** — Expected: FAIL (module not found).

- [ ] **Step 3: Create `web/src/themes/farm/crops.ts`**

```ts
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

function wheatBlade(height: number): THREE.BufferGeometry {
  const stalk = new THREE.CylinderGeometry(0.018, 0.03, height, 4);
  stalk.translate(0, height / 2, 0);
  const head = new THREE.ConeGeometry(0.06, 0.28, 5);
  head.translate(0, height + 0.1, 0);
  return mergeGeometries([stalk, head]);
}

export function wheatGeometries(): THREE.BufferGeometry[] {
  const single = wheatBlade(1);

  const left = wheatBlade(0.8);
  left.rotateZ(0.3);
  const right = wheatBlade(0.9);
  right.rotateZ(-0.26);
  const cluster = mergeGeometries([wheatBlade(1), left, right]);

  const bent = wheatBlade(0.95);
  bent.rotateZ(0.14);

  return [single, cluster, bent];
}

export function gourdGeometries(): THREE.BufferGeometry[] {
  // pumpkin: squashed sphere with a stub stem
  const pumpkinBody = new THREE.SphereGeometry(0.26, 10, 8);
  pumpkinBody.scale(1, 0.72, 1);
  pumpkinBody.translate(0, 0.19, 0);
  const stem = new THREE.CylinderGeometry(0.03, 0.045, 0.14, 5);
  stem.translate(0, 0.42, 0);
  const pumpkin = mergeGeometries([pumpkinBody, stem]);

  // cabbage: low round head
  const cabbage = new THREE.SphereGeometry(0.22, 10, 8);
  cabbage.scale(1, 0.85, 1);
  cabbage.translate(0, 0.19, 0);

  // tall squash
  const squashBody = new THREE.CylinderGeometry(0.12, 0.17, 0.4, 8);
  squashBody.translate(0, 0.2, 0);
  const squashTop = new THREE.SphereGeometry(0.12, 8, 6);
  squashTop.translate(0, 0.4, 0);
  const squash = mergeGeometries([squashBody, squashTop]);

  return [pumpkin, cabbage, squash];
}

function sunflower(height: number, headRadius: number): THREE.BufferGeometry {
  const stalk = new THREE.CylinderGeometry(0.03, 0.05, height, 5);
  stalk.translate(0, height / 2, 0);
  const core = new THREE.CylinderGeometry(headRadius * 0.55, headRadius * 0.55, 0.06, 10);
  core.rotateX(0.45); // tip the face toward the camera side of the field
  core.translate(0, height + 0.02, 0.04);
  const petals = new THREE.TorusGeometry(headRadius * 0.78, headRadius * 0.3, 6, 12);
  petals.rotateX(Math.PI / 2 + 0.45); // same facing as the core disc
  petals.translate(0, height + 0.02, 0.04);
  return mergeGeometries([stalk, core, petals]);
}

export function sunflowerGeometries(): THREE.BufferGeometry[] {
  return [sunflower(0.9, 0.16), sunflower(1.1, 0.13), sunflower(0.7, 0.19)];
}

function scarecrow(armTilt: number, hat: boolean): THREE.BufferGeometry {
  const post = new THREE.CylinderGeometry(0.035, 0.05, 1.05, 5);
  post.translate(0, 0.525, 0);
  const arms = new THREE.BoxGeometry(0.78, 0.055, 0.055);
  arms.rotateZ(armTilt);
  arms.translate(0, 0.78, 0);
  const head = new THREE.SphereGeometry(0.11, 8, 6);
  head.translate(0, 1.0, 0);
  const parts = [post, arms, head];
  if (hat) {
    const cone = new THREE.ConeGeometry(0.14, 0.18, 6);
    cone.translate(0, 1.14, 0);
    parts.push(cone);
  }
  return mergeGeometries(parts);
}

export function scarecrowGeometries(): THREE.BufferGeometry[] {
  return [scarecrow(0, true), scarecrow(0.12, false), scarecrow(-0.08, true)];
}
```

- [ ] **Step 4: Run tests** — `npx vitest run web/test/farm-geometry.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/themes/farm/crops.ts web/test/farm-geometry.test.ts
git commit -m "feat(web): farm crop geometries"
```

---

### Task 8: Tractor

**Files:**
- Create: `web/src/themes/farm/tractor.ts`
- Test: `web/test/tractor.test.ts`

- [ ] **Step 1: Write the failing test** (`web/test/tractor.test.ts`)

```ts
import * as THREE from "three";
import { expect, test } from "vitest";
import { PASS_SECONDS, Tractor } from "../src/themes/farm/tractor.js";

test("crops behind the tractor are passed, ahead are not", () => {
  const tractor = new Tractor(new THREE.Scene());
  tractor.startRow(0, 100); // even row: drives left → right
  const mid = 100 + PASS_SECONDS / 2;
  expect(tractor.hasPassed(0, -20, mid)).toBe(true);
  expect(tractor.hasPassed(0, 20, mid)).toBe(false);
  expect(tractor.hasPassed(0, 20, 100 + PASS_SECONDS + 0.1)).toBe(true);
});

test("odd rows drive right to left", () => {
  const tractor = new Tractor(new THREE.Scene());
  tractor.startRow(1, 0);
  expect(tractor.hasPassed(1, 20, PASS_SECONDS / 2)).toBe(true);
  expect(tractor.hasPassed(1, -20, PASS_SECONDS / 2)).toBe(false);
});

test("rows other than the current one are always passed (replay compression)", () => {
  const tractor = new Tractor(new THREE.Scene());
  tractor.startRow(3, 50);
  expect(tractor.hasPassed(2, 0, 50)).toBe(true);
  expect(tractor.hasPassed(99, 0, 50)).toBe(true);
});
```

- [ ] **Step 2: Run it** — Expected: FAIL (module not found).

- [ ] **Step 3: Create `web/src/themes/farm/tractor.ts`**

```ts
import * as THREE from "three";
import { FIELD, rowDirection, rowZ } from "./layout.js";
import { FARM } from "./palette.js";

export const PASS_SECONDS = 2.5;
/** Start/end just outside the field so crops at the row ends get a pass too. */
const EDGE_X = FIELD.rowLength / 2 + 2;

export class Tractor {
  readonly group = new THREE.Group();
  private row = -1;
  private startedAt = -Infinity;
  private direction: 1 | -1 = 1;
  private readonly wheels: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene) {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.95, 0.42, 0.6),
      new THREE.MeshStandardMaterial({ color: FARM.tractor, roughness: 0.6 })
    );
    body.position.y = 0.45;
    const cab = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.34, 0.5),
      new THREE.MeshStandardMaterial({ color: 0xdddde2, roughness: 0.4 })
    );
    cab.position.set(-0.18, 0.78, 0);
    const pipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.3, 5),
      new THREE.MeshStandardMaterial({ color: FARM.tractorDark })
    );
    pipe.position.set(0.3, 0.8, 0);

    const wheelGeometry = new THREE.CylinderGeometry(0.22, 0.22, 0.1, 10);
    wheelGeometry.rotateX(Math.PI / 2); // axle along z
    const wheelMaterial = new THREE.MeshStandardMaterial({
      color: FARM.tractorDark,
      roughness: 0.9,
    });
    for (const [wx, wz] of [
      [0.3, 0.34],
      [0.3, -0.34],
      [-0.32, 0.34],
      [-0.32, -0.34],
    ]) {
      const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
      wheel.position.set(wx, 0.22, wz);
      this.wheels.push(wheel);
      this.group.add(wheel);
    }
    this.group.add(body, cab, pipe);
    this.group.visible = false;
    scene.add(this.group);
  }

  /** Begin plowing `row`. If a pass is still running it jumps — snapshot replay compresses. */
  startRow(row: number, t: number): void {
    this.row = row;
    this.direction = rowDirection(row);
    this.startedAt = t;
    this.group.visible = true;
  }

  /** Plow x position at time t, clamped to the row ends. */
  private plowX(t: number): number {
    const progress = Math.min(1, Math.max(0, (t - this.startedAt) / PASS_SECONDS));
    return this.direction * (-EDGE_X + progress * 2 * EDGE_X);
  }

  /** Whether the plow has passed x on `row`. Other rows are always passed. */
  hasPassed(row: number, x: number, t: number): boolean {
    if (row !== this.row) return true;
    return this.direction === 1 ? this.plowX(t) >= x : this.plowX(t) <= x;
  }

  update(t: number): void {
    if (this.row < 0) return;
    this.group.position.set(this.plowX(t), 0.04 + Math.sin(t * 14) * 0.012, rowZ(this.row));
    this.group.rotation.y = this.direction === 1 ? 0 : Math.PI;
    for (const wheel of this.wheels) wheel.rotation.z = -this.direction * t * 6;
  }
}
```

- [ ] **Step 4: Run tests** — `npx vitest run web/test/tractor.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/themes/farm/tractor.ts web/test/tractor.test.ts
git commit -m "feat(web): farm tractor with pass timing"
```

---

### Task 9: CropSystem (pending-release planting)

**Files:**
- Modify: `web/src/themes/farm/crops.ts` (append `CropSystem`)
- Test: `web/test/crops.test.ts`

- [ ] **Step 1: Write the failing test** (`web/test/crops.test.ts`)

```ts
import * as THREE from "three";
import { expect, test } from "vitest";
import type { SproutEvent } from "@grove/shared";
import { CropSystem } from "../src/themes/farm/crops.js";
import { PASS_SECONDS, Tractor } from "../src/themes/farm/tractor.js";

const sprout = (kind: SproutEvent["kind"], coinId: string): SproutEvent => ({
  type: "sprout",
  kind,
  height: 1,
  coinId,
  amount: "1000000000000",
});

test("crops wait for the tractor and plant once it passes", () => {
  const scene = new THREE.Scene();
  const tractor = new Tractor(scene);
  // a bare Texture keeps the test off the DOM (no canvas needed)
  const crops = new CropSystem(scene, new THREE.Texture());

  tractor.startRow(0, 0);
  crops.plant(sprout("xch", "00000001" + "00".repeat(28)), 0, 0); // near row start
  crops.plant(sprout("cat", "00000002" + "00".repeat(28)), 0, 100); // near row end
  expect(crops.pendingCount()).toBe(2);

  crops.update(0.2, 0.2, tractor); // tractor barely started
  expect(crops.pendingCount()).toBeGreaterThan(0);

  crops.update(PASS_SECONDS + 0.1, 0.1, tractor); // pass complete
  expect(crops.pendingCount()).toBe(0);
});

test("crops on older rows plant immediately", () => {
  const scene = new THREE.Scene();
  const tractor = new Tractor(scene);
  const crops = new CropSystem(scene, new THREE.Texture());

  tractor.startRow(5, 0);
  crops.plant(sprout("nft", "00000003" + "00".repeat(28)), 4, 0);
  crops.update(0.01, 0.01, tractor);
  expect(crops.pendingCount()).toBe(0);
});
```

- [ ] **Step 2: Run it** — Expected: FAIL (`CropSystem` not exported).

- [ ] **Step 3: Append `CropSystem` to `web/src/themes/farm/crops.ts`**

Add imports at the top of the file:

```ts
import type { SproutEvent } from "@grove/shared";
import { InstancedKind, type Pose } from "../shared/instanced.js";
import { mulberry32 } from "../shared/util.js";
import { catColor } from "../shared/cat-color.js";
import { catWidth, xchHeight } from "../shared/scales.js";
import { plantPosition } from "./layout.js";
import { FARM } from "./palette.js";
import type { Tractor } from "./tractor.js";
```

Then the system:

```ts
const CAPS = { wheat: 800, gourd: 140, sunflower: 40, scarecrow: 80 } as const;
const VARIANTS = 3;

interface PendingCrop {
  kinds: InstancedKind[];
  variant: number;
  event: SproutEvent;
  x: number;
  z: number;
  row: number;
  pose: Pose;
  /** sunflower only: glow opacity once planted (mint shines brighter) */
  glowOpacity?: number;
}

export class CropSystem {
  private readonly wheat: InstancedKind[];
  private readonly gourd: InstancedKind[];
  private readonly sunflower: InstancedKind[];
  private readonly scarecrow: InstancedKind[];
  private readonly sunflowerGlows: THREE.Sprite[][];
  private pending: PendingCrop[] = [];
  private wiltUntil = 0;

  constructor(scene: THREE.Scene, glowMap: THREE.Texture) {
    const wheatMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff, // tinted per instance (golden shade variation)
      emissive: FARM.wheatEmissive,
      roughness: 0.8,
    });
    this.wheat = wheatGeometries().map(
      (geometry) => new InstancedKind(scene, geometry, wheatMaterial, CAPS.wheat, 0.07)
    );

    const gourdMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff, // tinted per instance from assetId
      emissive: 0x141008,
      roughness: 0.55,
    });
    this.gourd = gourdGeometries().map(
      (geometry) => new InstancedKind(scene, geometry, gourdMaterial, CAPS.gourd, 0.008)
    );

    const sunflowerMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x33260a,
      roughness: 0.5,
    });
    this.sunflower = sunflowerGeometries().map(
      (geometry) => new InstancedKind(scene, geometry, sunflowerMaterial, CAPS.sunflower, 0.035)
    );

    const scarecrowMaterial = new THREE.MeshStandardMaterial({
      color: FARM.scarecrow,
      roughness: 0.9,
    });
    this.scarecrow = scarecrowGeometries().map(
      (geometry) => new InstancedKind(scene, geometry, scarecrowMaterial, CAPS.scarecrow, 0.012)
    );

    this.sunflowerGlows = this.sunflower.map(() =>
      Array.from({ length: CAPS.sunflower }, () => {
        const sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: glowMap,
            color: FARM.sunflowerPetal,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          })
        );
        scene.add(sprite);
        return sprite;
      })
    );
  }

  private allKinds(): InstancedKind[] {
    return [...this.wheat, ...this.gourd, ...this.sunflower, ...this.scarecrow];
  }

  /** Queue a crop; it sprouts when the tractor has plowed past its spot. */
  plant(event: SproutEvent, row: number, indexInRow: number): void {
    const { x, z } = plantPosition(row, indexInRow, event.coinId);
    // separate hash slice from plantPosition's so pose doesn't correlate with position
    const rand = mulberry32(parseInt(event.coinId.slice(8, 16), 16));
    const variant = Math.floor(rand() * VARIANTS);
    const pose: Pose = {
      height: 1,
      rotY: rand() * Math.PI * 2,
      tiltX: (rand() - 0.5) * 0.14,
      tiltZ: (rand() - 0.5) * 0.14,
      swayPhase: rand() * Math.PI * 2,
    };
    // pose.color must be a fresh Color per crop: pending crops outlive this call
    let kinds: InstancedKind[];
    let glowOpacity: number | undefined;
    switch (event.kind) {
      case "xch":
        pose.color = new THREE.Color().setHSL(
          0.12 + rand() * 0.03,
          0.55 + rand() * 0.2,
          0.45 + rand() * 0.12
        );
        pose.height = xchHeight(event.amount) * (0.85 + rand() * 0.3);
        kinds = this.wheat;
        break;
      case "cat": {
        const { h } = catColor(event.assetId ?? "0".repeat(64));
        pose.color = new THREE.Color().setHSL(h, 0.6 + rand() * 0.2, 0.48 + rand() * 0.12);
        pose.height = 0.9 + rand() * 0.3;
        pose.width = catWidth(event.amount);
        kinds = this.gourd;
        break;
      }
      case "nft":
        pose.color = new THREE.Color().setHSL(0.13 + rand() * 0.03, 0.85, 0.6 + rand() * 0.1);
        pose.height = (event.mint ? 1.4 : 1) * (0.9 + rand() * 0.25);
        kinds = this.sunflower;
        glowOpacity = event.mint ? 0.9 : 0.5;
        break;
      case "did":
        pose.height = 0.95 + rand() * 0.2;
        kinds = this.scarecrow;
        break;
    }
    this.pending.push({ kinds, variant, event, x, z, row, pose, glowOpacity });
  }

  pendingCount(): number {
    return this.pending.length;
  }

  private release(tractor: Tractor, t: number): void {
    if (this.pending.length === 0) return;
    const keep: PendingCrop[] = [];
    for (const crop of this.pending) {
      if (!tractor.hasPassed(crop.row, crop.x, t)) {
        keep.push(crop);
        continue;
      }
      const index = crop.kinds[crop.variant].plant(crop.event, crop.x, crop.z, t, crop.pose);
      if (crop.glowOpacity !== undefined) {
        const glow = this.sunflowerGlows[this.sunflower.indexOf(crop.kinds[crop.variant])][index];
        glow.position.set(crop.x, 0.95 * crop.pose.height, crop.z);
        glow.material.opacity = crop.glowOpacity;
        glow.scale.setScalar(crop.glowOpacity > 0.6 ? 2.4 : 1.6);
      }
    }
    this.pending = keep;
  }

  /** Crows make the field flinch: recent crops dip for a couple of seconds. */
  wilt(t: number): void {
    this.wiltUntil = t + 2;
  }

  update(t: number, dt: number, tractor: Tractor): void {
    this.release(tractor, t);
    const remaining = Math.max(0, this.wiltUntil - t);
    const dip =
      remaining > 0
        ? 1 - 0.22 * Math.min(1, remaining / 2) * Math.abs(Math.sin(remaining * 5))
        : 1;
    for (const kind of this.allKinds()) kind.update(t, dip);
    for (const glows of this.sunflowerGlows) {
      for (const glow of glows) {
        if (glow.material.opacity > 0.5) {
          glow.material.opacity = Math.max(0.5, glow.material.opacity - dt * 0.12);
        }
      }
    }
  }

  pickables(): THREE.Object3D[] {
    return this.allKinds().map((kind) => kind.mesh);
  }

  metaFor(object: THREE.Object3D, instanceId: number | undefined): SproutEvent | null {
    const kind = this.allKinds().find((k) => k.mesh === object);
    return kind ? kind.metaAt(instanceId ?? -1) : null;
  }

  private hovered: { kind: InstancedKind; index: number } | null = null;

  setHovered(object: THREE.Object3D | null, instanceId: number | undefined): void {
    if (this.hovered) {
      this.hovered.kind.setHighlight(this.hovered.index, false);
      this.hovered = null;
    }
    if (!object || instanceId === undefined) return;
    const kind = this.allKinds().find((k) => k.mesh === object);
    if (kind) {
      kind.setHighlight(instanceId, true);
      this.hovered = { kind, index: instanceId };
    }
  }
}
```

Note: `crop.kinds[crop.variant].plant(...)` requires `kinds` to be definitely assigned — the `switch` covers all four `SproutKind` values, so TypeScript accepts it via the `let kinds: InstancedKind[]` + exhaustive switch. If tsc complains, initialize `let kinds: InstancedKind[] = this.wheat;`.

- [ ] **Step 4: Run tests** — `npx vitest run web/test/crops.test.ts && npm run typecheck` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/themes/farm/crops.ts web/test/crops.test.ts
git commit -m "feat(web): farm crop system with tractor-gated planting"
```

---

### Task 10: Field (turf, soil rows, barn) + farm sky

Visual-only modules; verified by typecheck here and by eye in Task 12.

**Files:**
- Create: `web/src/themes/farm/field.ts`, `web/src/themes/farm/sky.ts`

- [ ] **Step 1: Create `web/src/themes/farm/field.ts`**

```ts
import * as THREE from "three";
import { FIELD, rowZ } from "./layout.js";
import { FARM } from "./palette.js";

export interface Field {
  /** Reveal the soil strip for a row the first time the tractor plows it. */
  plow(row: number): void;
}

export function createField(scene: THREE.Scene): Field {
  const turf = new THREE.Mesh(
    new THREE.CircleGeometry(90, 48),
    new THREE.MeshStandardMaterial({ color: FARM.turf, roughness: 1 })
  );
  turf.rotation.x = -Math.PI / 2;
  scene.add(turf);

  const stripGeometry = new THREE.PlaneGeometry(FIELD.rowLength + 1.4, FIELD.rowSpacing * 0.78);
  const stripMaterial = new THREE.MeshStandardMaterial({ color: FARM.soil, roughness: 1 });
  const strips = Array.from({ length: FIELD.rows }, (_, row) => {
    const strip = new THREE.Mesh(stripGeometry, stripMaterial);
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(0, 0.02, rowZ(row));
    strip.visible = false;
    scene.add(strip);
    return strip;
  });

  // barn beyond the far edge of the field
  const barnZ = rowZ(FIELD.rows - 1) - 6;
  const barn = new THREE.Mesh(
    new THREE.BoxGeometry(7, 3.4, 4.6),
    new THREE.MeshStandardMaterial({ color: FARM.barn, roughness: 0.8 })
  );
  barn.position.set(-10, 1.7, barnZ);
  scene.add(barn);
  const roof = new THREE.Mesh(
    new THREE.CylinderGeometry(0, 3.9, 2.4, 4), // pyramid; close enough at distance
    new THREE.MeshStandardMaterial({ color: FARM.barnRoof, roughness: 0.8 })
  );
  roof.rotation.y = Math.PI / 4;
  roof.position.set(-10, 4.6, barnZ);
  scene.add(roof);

  return {
    plow(row) {
      strips[row].visible = true;
    },
  };
}
```

- [ ] **Step 2: Create `web/src/themes/farm/sky.ts`**

```ts
import * as THREE from "three";
import { FARM } from "./palette.js";
import { glowTexture } from "../shared/textures.js";

function safeBigInt(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

export interface FarmSky {
  update(dt: number, t: number): void;
  setNetspace(bytes: string): void;
  setSignalLost(lost: boolean): void;
}

export function createFarmSky(scene: THREE.Scene): FarmSky {
  const glowMap = glowTexture();

  const sun = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowMap, color: FARM.sun, transparent: true, depthWrite: false })
  );
  sun.position.set(40, 55, -80);
  sun.scale.setScalar(30);
  scene.add(sun);

  const sunLight = new THREE.DirectionalLight(0xfff2d0, 1.1);
  sunLight.position.copy(sun.position);
  scene.add(sunLight);

  const clouds = Array.from({ length: 6 }, (_, i) => {
    const cloud = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowMap,
        color: 0xffffff,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
      })
    );
    cloud.position.set(-120 + i * 45, 38 + (i % 3) * 7, -110 - (i % 2) * 25);
    cloud.scale.set(34, 12, 1);
    scene.add(cloud);
    return cloud;
  });

  let sunTarget = 1.0;
  let signalLost = false;

  return {
    update(dt, _t) {
      const target = signalLost ? sunTarget * 0.35 : sunTarget;
      sunLight.intensity += (target - sunLight.intensity) * Math.min(dt, 1);
      sun.material.opacity += (target * 0.9 - sun.material.opacity) * Math.min(dt, 1);
      for (const cloud of clouds) {
        cloud.position.x += dt * 1.2;
        if (cloud.position.x > 140) cloud.position.x = -140;
      }
    },
    setNetspace(bytes) {
      // same EiB mapping shape as the grove moon, tuned for daylight
      const eib = Number(safeBigInt(bytes) >> 50n) / 1024;
      sunTarget = Math.min(1.35, Math.max(0.7, 0.7 + (eib - 10) * 0.02));
    },
    setSignalLost(lost) {
      signalLost = lost;
    },
  };
}
```

- [ ] **Step 3: Verify** — `npm run typecheck && npm run lint` — Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add web/src/themes/farm/field.ts web/src/themes/farm/sky.ts
git commit -m "feat(web): farm field, barn, and daylight sky"
```

---

### Task 11: Chickens (mempool) and crows (reorg)

**Files:**
- Create: `web/src/themes/farm/chickens.ts`, `web/src/themes/farm/crows.ts`

- [ ] **Step 1: Create `web/src/themes/farm/chickens.ts`**

```ts
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { FIELD, rowZ } from "./layout.js";
import { FARM } from "./palette.js";

const CHASE_SECONDS = 2.5;
// the flock's home range, on the turf near the barn
const HOME = { x: -14, z: rowZ(FIELD.rows - 1) - 3, spread: 7 };

interface Hen {
  x: number;
  z: number;
  wx: number;
  wz: number;
  phase: number;
  speed: number;
  chaseUntil: number;
}

function chickenGeometry(): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(0.16, 8, 6);
  body.scale(1.2, 1, 1);
  body.translate(0, 0.16, 0);
  const head = new THREE.SphereGeometry(0.08, 8, 6);
  head.translate(0.16, 0.32, 0);
  const beak = new THREE.ConeGeometry(0.03, 0.08, 4);
  beak.rotateZ(-Math.PI / 2);
  beak.translate(0.26, 0.32, 0);
  return mergeGeometries([body, head, beak]);
}

export class Chickens {
  private readonly mesh: THREE.InstancedMesh;
  private readonly hens: Hen[];
  private visible = 8;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3(1, 1, 1);
  private readonly euler = new THREE.Euler();

  constructor(scene: THREE.Scene, private readonly max: number) {
    this.mesh = new THREE.InstancedMesh(
      chickenGeometry(),
      new THREE.MeshStandardMaterial({ color: FARM.chicken, roughness: 0.8 }),
      max
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) this.mesh.setMatrixAt(i, zero);
    scene.add(this.mesh);
    this.hens = Array.from({ length: max }, () => ({
      x: HOME.x + (Math.random() - 0.5) * HOME.spread,
      z: HOME.z + (Math.random() - 0.5) * HOME.spread,
      wx: HOME.x + (Math.random() - 0.5) * HOME.spread,
      wz: HOME.z + (Math.random() - 0.5) * HOME.spread,
      phase: Math.random() * Math.PI * 2,
      speed: 0.6 + Math.random() * 0.5,
      chaseUntil: 0,
    }));
  }

  /** Flock size tracks pending transactions. */
  setMempool(size: number): void {
    this.visible = Math.max(8, Math.min(this.max, 8 + Math.round(size / 4)));
  }

  /** A new block: some hens run toward the freshly plowed row. */
  chase(x: number, z: number, t: number): void {
    for (const hen of this.hens) {
      if (Math.random() < 0.4) {
        hen.chaseUntil = t + CHASE_SECONDS;
        hen.wx = x + (Math.random() - 0.5) * 6;
        hen.wz = z + (Math.random() - 0.5) * 2;
      }
    }
  }

  update(t: number, dt: number): void {
    for (let i = 0; i < this.hens.length; i++) {
      const hen = this.hens[i];
      if (i >= this.visible) {
        this.matrix.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this.matrix);
        continue;
      }
      const dx = hen.wx - hen.x;
      const dz = hen.wz - hen.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.2) {
        // arrived: peck a while, then wander home range
        if (t > hen.chaseUntil) {
          hen.wx = HOME.x + (Math.random() - 0.5) * HOME.spread;
          hen.wz = HOME.z + (Math.random() - 0.5) * HOME.spread;
        }
      } else {
        const step = (hen.chaseUntil > t ? 2.2 : 0.8) * hen.speed * dt;
        hen.x += (dx / dist) * step;
        hen.z += (dz / dist) * step;
      }
      const peck = Math.max(0, Math.sin(t * 5 * hen.speed + hen.phase)) * 0.07;
      this.quaternion.setFromEuler(this.euler.set(0, Math.atan2(dx, dz) + Math.PI / 2, 0));
      this.matrix.compose(
        this.position.set(hen.x, -peck, hen.z),
        this.quaternion,
        this.scale
      );
      this.mesh.setMatrixAt(i, this.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
```

- [ ] **Step 2: Create `web/src/themes/farm/crows.ts`**

```ts
import * as THREE from "three";
import { FARM } from "./palette.js";

const FLIGHT_SECONDS = 3;
const SPAN_X = 32; // sweep from +x to −x across the field

export class Crows {
  private readonly mesh: THREE.InstancedMesh;
  private startedAt = -Infinity;
  private zMin = 0;
  private zMax = 0;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly offsets: Array<{ dz: number; dy: number; dphase: number }>;

  constructor(scene: THREE.Scene, private readonly count: number) {
    const wing = new THREE.ConeGeometry(0.18, 0.5, 3);
    wing.rotateX(Math.PI / 2); // point along −z, flat-ish silhouette
    wing.scale(1, 0.25, 1);
    this.mesh = new THREE.InstancedMesh(
      wing,
      new THREE.MeshBasicMaterial({ color: FARM.crow }),
      count
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < count; i++) this.mesh.setMatrixAt(i, zero);
    scene.add(this.mesh);
    this.offsets = Array.from({ length: count }, () => ({
      dz: Math.random(),
      dy: Math.random() * 1.4,
      dphase: Math.random() * Math.PI * 2,
    }));
  }

  /** Reorg: sweep the flock across the band of recently planted rows. */
  fly(zMin: number, zMax: number, t: number): void {
    this.zMin = zMin;
    this.zMax = zMax;
    this.startedAt = t;
  }

  update(t: number): void {
    const progress = (t - this.startedAt) / FLIGHT_SECONDS;
    for (let i = 0; i < this.count; i++) {
      if (progress < 0 || progress > 1) {
        this.matrix.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this.matrix);
        continue;
      }
      const o = this.offsets[i];
      const flap = 1 + Math.sin(t * 11 + o.dphase) * 0.5;
      this.position.set(
        SPAN_X - progress * 2 * SPAN_X + Math.sin(o.dphase) * 3,
        2.2 + o.dy + Math.sin(t * 9 + o.dphase) * 0.25,
        this.zMin + o.dz * (this.zMax - this.zMin)
      );
      this.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
      this.matrix.compose(this.position, this.quaternion, this.scale.set(flap, 1, 1));
      this.mesh.setMatrixAt(i, this.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
```

- [ ] **Step 3: Verify** — `npm run typecheck && npm run lint` — Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add web/src/themes/farm/chickens.ts web/src/themes/farm/crows.ts
git commit -m "feat(web): farm chickens (mempool) and crows (reorg)"
```

---

### Task 12: Farm theme module, registration, legend swatches

**Files:**
- Create: `web/src/themes/farm/index.ts`
- Modify: `web/src/themes/index.ts`, `web/src/style.css`, `web/test/themes.test.ts`

- [ ] **Step 1: Extend the registry test** (`web/test/themes.test.ts`) — add:

```ts
test("farm theme is registered and resolvable", () => {
  expect(THEMES.map((t) => t.id)).toContain("farm");
  expect(resolveTheme("?theme=farm", null).id).toBe("farm");
  expect(resolveTheme("", "farm").id).toBe("farm");
});
```

- [ ] **Step 2: Run it** — `npx vitest run web/test/themes.test.ts` — Expected: new test FAILS.

- [ ] **Step 3: Create `web/src/themes/farm/index.ts`**

```ts
import * as THREE from "three";
import type { Visualization } from "../types.js";
import { glowTexture } from "../shared/textures.js";
import { FIELD, rowZ } from "./layout.js";
import { FARM } from "./palette.js";
import { CropSystem } from "./crops.js";
import { Tractor } from "./tractor.js";
import { createField } from "./field.js";
import { createFarmSky } from "./sky.js";
import { Chickens } from "./chickens.js";
import { Crows } from "./crows.js";

export const farm: Visualization = {
  id: "farm",
  label: "farm",
  legend: [
    ["sw-wheat", "wheat — XCH spend (taller = larger)"],
    ["sw-gourd", "gourd — CAT transfer (color = asset, plumper = larger)"],
    ["sw-sunflower", "sunflower — NFT (blooms big on mint)"],
    ["sw-scarecrow", "scarecrow — DID activity"],
    ["sw-chicken", "chickens — mempool"],
    ["sw-sun", "sunlight — netspace"],
    ["sw-tractor", "tractor pass — new block"],
    ["sw-crow", "crows — reorg"],
  ],
  start(canvas, feed) {
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    renderer.setSize(innerWidth, innerHeight);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(FARM.sky);
    scene.fog = new THREE.FogExp2(FARM.haze, 0.007);

    const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 500);
    scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x3f5a33, 0.85));

    const sky = createFarmSky(scene);
    const field = createField(scene);
    const crops = new CropSystem(scene, glowTexture());
    const tractor = new Tractor(scene);
    const chickens = new Chickens(scene, reducedMotion ? 40 : 120);
    const crows = new Crows(scene, reducedMotion ? 10 : 24);

    let blockIndex = 0;
    let currentRow = 0;
    let plantIndex = 0;
    let clockT = 0;
    const frameCallbacks: Array<() => void> = [];

    feed.onEvent((event) => {
      switch (event.type) {
        case "block":
          currentRow = blockIndex % FIELD.rows;
          blockIndex += 1;
          plantIndex = 0;
          tractor.startRow(currentRow, clockT);
          field.plow(currentRow);
          chickens.chase(0, rowZ(currentRow), clockT);
          break;
        case "sprout":
          crops.plant(event, currentRow, plantIndex);
          plantIndex += 1;
          break;
        case "ambient":
          sky.setNetspace(event.netspace);
          chickens.setMempool(event.mempoolSize);
          break;
        case "reorg": {
          // sweep the crows over the last ~6 plowed rows
          const newest = rowZ(currentRow);
          const oldest = rowZ(Math.max(0, currentRow - 5));
          crows.fly(Math.min(newest, oldest), Math.max(newest, oldest), clockT);
          crops.wilt(clockT);
          break;
        }
      }
    });
    feed.onStatus((status) => sky.setSignalLost(status === "stale"));

    const clock = new THREE.Clock();
    function frame(): void {
      requestAnimationFrame(frame);
      const dt = Math.min(clock.getDelta(), 0.1);
      const t = clock.elapsedTime;
      clockT = t;

      // drift along the field's near edge, looking across the rows at the barn
      const x = reducedMotion ? 8 : Math.sin(t * 0.02) * 16;
      const z = rowZ(0) + 14 + (reducedMotion ? 0 : Math.cos(t * 0.013) * 2);
      camera.position.set(x, 11 + Math.sin(t * 0.05) * 0.6, z);
      camera.lookAt(0, 1, -6);

      sky.update(dt, t);
      tractor.update(t);
      crops.update(t, dt, tractor);
      chickens.update(t, dt);
      crows.update(t);
      for (const fn of frameCallbacks) fn();
      renderer.render(scene, camera);
    }
    frame();

    addEventListener("resize", () => {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight);
    });

    return {
      camera,
      onFrame: (fn) => frameCallbacks.push(fn),
      pickables: () => crops.pickables(),
      metaFor: (object, instanceId) => crops.metaFor(object, instanceId),
      setHovered: (object, instanceId) => crops.setHovered(object, instanceId),
    };
  },
};
```

- [ ] **Step 4: Register it** — in `web/src/themes/index.ts`:

```ts
import { farm } from "./farm/index.js";

export const THEMES: readonly Visualization[] = [grove, farm];
```

- [ ] **Step 5: Add farm swatches** to `web/src/style.css` after `.sw-ripple`:

```css
.sw-wheat {
  width: 4px;
  height: 13px;
  border-radius: 2px;
  background: linear-gradient(to top, #8a6a1f, #e8c95a);
}

.sw-gourd {
  background: #e8853c;
  box-shadow: 0 0 5px rgba(232, 133, 60, 0.7);
}

.sw-sunflower {
  background: #ffc93c;
  box-shadow: 0 0 7px rgba(255, 201, 60, 0.9);
}

.sw-scarecrow {
  background: #a88a5c;
}

.sw-chicken {
  width: 6px;
  height: 6px;
  margin: 0 2px;
  background: #fff4e0;
  box-shadow: 0 0 6px rgba(255, 244, 224, 0.9);
}

.sw-sun {
  background: #ffe9a8;
  box-shadow: 0 0 6px rgba(255, 233, 168, 0.8);
}

.sw-tractor {
  background: #c94f35;
  border-radius: 3px;
}

.sw-crow {
  background: #23232c;
  border: 1px solid rgba(255, 255, 255, 0.25);
}
```

- [ ] **Step 6: Run tests** — `npx vitest run web/test/ && npm run typecheck && npm run lint` — Expected: all pass.

- [ ] **Step 7: Visual verification**

Run `npm run dev:web`, open `http://localhost:5173/?demo=1&theme=farm`. Expected: daylight field, tractor plows a row on each block with crops sprouting behind it, chickens near the barn, legend shows the farm items, scene select switches back to grove (page reloads, grove repopulates). Check hover + click detail card on a wheat stalk and a gourd. Stop the server.

- [ ] **Step 8: Commit**

```bash
git add web/src/themes/ web/src/style.css web/test/themes.test.ts
git commit -m "feat(web): farm visualization — tractor-planted serpentine crop rows"
```

---

### Task 13: Docs + final verification

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md**

In the "Web/scene internals" section, update paths (`web/src/scene/` → `web/src/themes/grove/`) and add:

```markdown
### Web/scene internals

- The frontend supports multiple visualizations ("themes") behind the
  `Visualization` interface in `web/src/themes/types.ts`. The registry in
  `web/src/themes/index.ts` resolves `?theme=` / `localStorage["grove.theme"]`
  (default `grove`); switching from the legend persists and reloads, and the
  WebSocket snapshot repopulates the scene. Themes own their entire scene;
  shared helpers (instancing, textures, CAT colors, amount scales) live in
  `web/src/themes/shared/`.
- **grove** (`web/src/themes/grove/`): phyllotaxis spiral, flora instancing,
  fireflies, moonlit sky — as before, paths updated.
- **farm** (`web/src/themes/farm/`): serpentine crop rows; each block is a row
  plowed by a tractor, crops sprout behind it (wheat=XCH, gourd=CAT,
  sunflower=NFT, scarecrow=DID); chickens=mempool, sun=netspace, crows=reorg.
```

(Adjust the existing bullets rather than duplicating them — keep the existing flora/layout/palette/sky details under the grove bullet with corrected paths.)

- [ ] **Step 2: Full verification**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all green; Vite build succeeds.

- [ ] **Step 3: Final visual pass**

`npm run dev:web`; check `?demo=1` (grove default), `?demo=1&theme=farm`, switching both directions via the legend select, and that the choice sticks across a plain reload (localStorage). Stop the server.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: theme architecture in CLAUDE.md"
```
