# Lake Legibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the lake theme tell a legible story — pending transactions churn near the surface, each new block is a visible descent into a countable, labelled band, and the camera stops fighting the depth cue.

**Architecture:** Two new lake systems (`pending.ts` for the mempool churn layer, `bands.ts` for rim rings and height labels), a reshaped depth column (18 thicker bands instead of 40 thin ones), an adaptive camera driven by pure fit math, and creature entry animations. Pure logic lives in `layout.ts` / `camera.ts` / `motion.ts` and is unit-tested; scene classes are tested against a real `THREE.Scene` in Node with no renderer and no DOM, exactly as `lake-shoal.test.ts` already does.

**Tech Stack:** TypeScript, Three.js (r160+ API as already used), Vite, vitest. Node ≥ 24. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-12-lake-legibility-design.md`

## Global Constraints

- **No server or `@grove/shared` change.** `PROTOCOL_VERSION` is untouched. The only server-side edit in this plan is an added assertion in `server/test/classify.test.ts`.
- **Determinism.** Every visual property must derive from a coin id, a slot index, or elapsed time — **never `Math.random`**. The WebSocket snapshot replays on every theme switch and reconnect, and the lake must rebuild identically. Seeded randomness uses `mulberry32` from `web/src/themes/shared/util.js` with a literal seed.
- **No new per-frame allocations** in `update()` paths. Reuse the pre-allocated `THREE.Matrix4` / `Vector3` / `Color` scratch objects the existing classes already hold.
- **Pool classes take an optional `cap` constructor parameter** (default in a module constant) so tests can force a wrap, as `Shoal` and `Paintings` already do.
- **Tests run in plain vitest** — no renderer, no DOM, no WebGL. Scene classes are constructed against `new THREE.Scene()`. Anything needing a canvas must be behind a guard or not tested at that level.
- **Verification after every task:** `npm run typecheck && npm run lint && npm test` must all pass before committing.
- Commit messages follow the repo's existing convention: `feat(lake): …`, `fix(lake): …`, `refactor: …`, `test: …`.

---

## File Structure

**New files**

| File                                                                                                                    | Responsibility                                                                  |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `web/src/themes/lake/bands.ts`                                                                                          | Band ring buffer, rim ring `InstancedMesh`, height-label sprites, `clearAbove`. |
| `web/src/themes/lake/pending.ts`                                                                                        | Mempool churn layer and the `release(n)` descent.                               |
| `web/src/themes/lake/camera.ts`                                                                                         | Pure camera framing math (`filledDepth`, `frameTarget`).                        |
| `web/src/themes/lake/strip.ts`                                                                                          | The mempool/netspace DOM strip.                                                 |
| `web/src/themes/shared/fit.ts`                                                                                          | `fitDistance()`, moved out of `board/`.                                         |
| `web/src/ui/gauges.ts`                                                                                                  | `mempoolGauge()` + `netspaceText()`, lifted out of `board/header.ts`.           |
| `web/test/lake-bands.test.ts`, `lake-pending.test.ts`, `lake-camera.test.ts`, `lake-strip.test.ts`, `ui-gauges.test.ts` | Tests for the above.                                                            |

**Modified files**

| File                                                                                                                 | Change                                                              |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `web/src/themes/lake/layout.ts`                                                                                      | Column constants reshaped; `RIM_RADIUS`, `PENDING_Y_MIN/MAX` added. |
| `web/src/themes/lake/lake.ts`                                                                                        | Handler signatures carry full events; camera rework; orbit rate.    |
| `web/src/themes/lake/index.ts`                                                                                       | Wiring for bands, pending, strip; legend rewrite.                   |
| `web/src/themes/lake/shoal.ts`                                                                                       | Entry animation; lower cap; derived bounding sphere.                |
| `web/src/themes/lake/jellies.ts`, `turtles.ts`                                                                       | Entry animation.                                                    |
| `web/src/themes/lake/motion.ts`                                                                                      | Wander amplitudes reduced.                                          |
| `web/src/themes/lake/vfx.ts`                                                                                         | Bubbles demoted to fixed-density scenery; `setMempool` removed.     |
| `web/src/themes/lake/palette.ts`                                                                                     | Ring, label and pending colors.                                     |
| `web/src/themes/board/fit.ts`                                                                                        | Deleted; re-exported from `themes/shared/fit.ts`.                   |
| `web/src/themes/board/header.ts`                                                                                     | Imports the lifted formatters.                                      |
| `web/index.html`                                                                                                     | `<div id="lake-strip" hidden>`.                                     |
| `web/src/style.css`                                                                                                  | Strip styling; legend swatches.                                     |
| `web/test/lake-layout.test.ts`, `lake-motion.test.ts`, `lake-vfx.test.ts`, `lake-shoal.test.ts`, `board-fit.test.ts` | Updated for the above.                                              |
| `server/test/classify.test.ts`                                                                                       | Assert `BlockEvent` precedes its spends.                            |

---

### Task 1: Reshape the depth column

Eighteen thick bands instead of forty thin ones, and a gap opened under the surface for the churn layer. Everything else in the theme reads these constants, so this lands first.

**Files:**

- Modify: `web/src/themes/lake/layout.ts:13-19`
- Test: `web/test/lake-layout.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `MAX_BANDS = 18`, `BAND_STEP = 2.6`, `TOP_BAND_Y = -12`, `BED_Y = -58.8`, `RIM_RADIUS = 28`, `PENDING_Y_MIN = -9`, `PENDING_Y_MAX = -2`. `bandDepth(age: number): number` and `seatOffset(coinIdHex: string): Seat` keep their current signatures and behaviour.

- [ ] **Step 1: Write the failing tests**

Replace the existing `"the whole column fits in a viewable depth"` test in `web/test/lake-layout.test.ts` and append the rest:

```ts
test("the whole column fits in a viewable depth", () => {
  // 18 bands at 2.6 units is a 46.8-unit descent — fewer, thicker, countable
  // bands rather than 40 the eye cannot separate.
  expect(TOP_BAND_Y - BED_Y).toBeCloseTo(MAX_BANDS * BAND_STEP, 5);
  expect(TOP_BAND_Y - BED_Y).toBeLessThanOrEqual(70);
});

test("bands are thick enough to read as separate strata", () => {
  expect(MAX_BANDS).toBe(18);
  expect(BAND_STEP).toBeGreaterThanOrEqual(2.5);
});

test("the churn layer sits clear of the surface and of band 0", () => {
  expect(PENDING_Y_MAX).toBeLessThan(SURFACE_Y);
  expect(PENDING_Y_MIN).toBeLessThan(PENDING_Y_MAX);
  // a full band step of clearance so a descending silhouette visibly crosses
  // into the newest band rather than starting inside it
  expect(PENDING_Y_MIN - bandDepth(0)).toBeGreaterThanOrEqual(BAND_STEP);
});

test("the rim rings sit outside the creatures and inside the god rays", () => {
  expect(RIM_RADIUS).toBeGreaterThan(BAND_RADIUS_MAX);
  expect(RIM_RADIUS).toBeLessThan(42); // the nearest god-ray cone
});
```

Extend the import at the top of the file:

```ts
import {
  MAX_BANDS,
  BAND_STEP,
  TOP_BAND_Y,
  BED_Y,
  BAND_RADIUS_MIN,
  BAND_RADIUS_MAX,
  RIM_RADIUS,
  PENDING_Y_MIN,
  PENDING_Y_MAX,
  bandDepth,
  seatOffset,
  easeBlocks,
} from "../src/themes/lake/layout.js";
import { SURFACE_Y } from "../src/themes/lake/water.js";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run web/test/lake-layout.test.ts`
Expected: FAIL — `RIM_RADIUS`, `PENDING_Y_MIN`, `PENDING_Y_MAX` are not exported, and `MAX_BANDS` is 40.

- [ ] **Step 3: Update the constants**

In `web/src/themes/lake/layout.ts`, replace lines 3–19 (the doc comment and the constant block) with:

```ts
/**
 * Depth strata. One band per block: the newest sits below the churn layer and
 * every older band is one step deeper, so history reads as depth.
 *
 * MAX_BANDS is 18 rather than the 40 the theme shipped with. Forty 1.5-unit
 * bands were indistinguishable at any framing that fit the column, so the one
 * cue the theme is built on could not be seen. Eighteen 2.6-unit bands keep
 * roughly the same column height (46.8 units) while being countable, at the
 * cost of history depth: ~5.5 minutes of chain at 18.75 s blocks rather than
 * ~12. That trade is deliberate — see the legibility design spec.
 */
export const MAX_BANDS = 18;
export const BAND_STEP = 2.6;

/**
 * The top band hangs well below the surface (0) to leave y in
 * [PENDING_Y_MIN, PENDING_Y_MAX] for the mempool churn layer, so pending
 * silhouettes visibly cross into the newest band when a block confirms.
 */
export const TOP_BAND_Y = -12;
export const PENDING_Y_MIN = -9;
export const PENDING_Y_MAX = -2;

export const BED_Y = TOP_BAND_Y - MAX_BANDS * BAND_STEP;

export const BAND_RADIUS_MIN = 6;
export const BAND_RADIUS_MAX = 26;

/**
 * Where the per-band rim rings sit: outside the creature annulus so they never
 * intersect a fish, and inside the god-ray cones (parked at 42–66) so the
 * camera has somewhere to stand between the two.
 */
export const RIM_RADIUS = 28;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run web/test/lake-layout.test.ts`
Expected: PASS, including the untouched `bandDepth` / `seatOffset` / `easeBlocks` tests.

- [ ] **Step 5: Fix the now-stale bounding sphere in `shoal.ts`**

`web/src/themes/lake/shoal.ts:82` hard-codes `new THREE.Sphere(new THREE.Vector3(0, -33, 0), 70)` against the old column. Derive it so it cannot drift again:

```ts
// An InstancedMesh caches its bounding sphere on first raycast, which would
// otherwise happen while every slot is still scale-0 and leave a radius-0
// sphere that makes every later pick miss. Derived from the column so a
// reshaped column cannot silently break picking.
this.mesh.boundingSphere = new THREE.Sphere(
  new THREE.Vector3(0, (TOP_BAND_Y + BED_Y) / 2, 0),
  (TOP_BAND_Y - BED_Y) / 2 + BAND_RADIUS_MAX + 8
);
```

and extend the import on line 3:

```ts
import { BAND_RADIUS_MAX, BED_Y, TOP_BAND_Y, bandDepth, seatOffset } from "./layout.js";
```

- [ ] **Step 6: Run the full suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS. If `lake-vfx.test.ts` or `lake-bed.test.ts` assert on absolute Y values tied to the old `BED_Y`, update those assertions to derive from `BED_Y` rather than restating a literal.

- [ ] **Step 7: Commit**

```bash
git add web/src/themes/lake/layout.ts web/src/themes/lake/shoal.ts web/test/
git commit -m "feat(lake): fewer, thicker bands and a gap for the churn layer"
```

---

### Task 2: Lift the gauge formatters out of `board/`

`mempoolGauge()` is exported from `board/header.ts`; `netspaceText()` is private there. The lake strip needs both, and duplicating them would give the two themes drifting formatters.

**Files:**

- Create: `web/src/ui/gauges.ts`
- Create: `web/test/ui-gauges.test.ts`
- Modify: `web/src/themes/board/header.ts:6-25`

**Interfaces:**

- Consumes: nothing.
- Produces: `mempoolGauge(size: number, width: number, full?: number): string` and `netspaceText(bytes: string): string`, both pure.

- [ ] **Step 1: Write the failing test**

Create `web/test/ui-gauges.test.ts`:

```ts
import { expect, test } from "vitest";
import { mempoolGauge, netspaceText } from "../src/ui/gauges.js";

test("the gauge fills in proportion to mempool size", () => {
  expect(mempoolGauge(0, 5)).toBe("·····");
  expect(mempoolGauge(5000, 5)).toBe("▮▮▮▮▮");
  expect(mempoolGauge(2500, 5)).toBe("▮▮▮··");
});

test("the gauge clamps past full and survives junk input", () => {
  expect(mempoolGauge(99999, 5)).toBe("▮▮▮▮▮");
  expect(mempoolGauge(-10, 5)).toBe("·····");
  expect(mempoolGauge(NaN, 5)).toBe("·····");
});

test("netspace prints in the largest unit that fits", () => {
  expect(netspaceText("0")).toBe("0.0 B");
  expect(netspaceText(String(1024 ** 6 * 25))).toBe("25.0 EIB");
  expect(netspaceText(String(1024 ** 4))).toBe("1.0 TIB");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run web/test/ui-gauges.test.ts`
Expected: FAIL — `Cannot find module '../src/ui/gauges.js'`.

- [ ] **Step 3: Create the module**

Create `web/src/ui/gauges.ts` with the two functions moved verbatim from `board/header.ts` (only the `export` on `netspaceText` is new):

```ts
/** A `▮`/`·` fill bar `width` chars wide. Pure. */
export function mempoolGauge(size: number, width: number, full = 5000): string {
  const raw = Math.round(Math.min(1, size / full) * width);
  const filled = Number.isFinite(raw) ? Math.max(0, Math.min(width, raw)) : 0;
  return "▮".repeat(filled) + "·".repeat(width - filled);
}

/** Pretty-print a netspace byte count (string) as e.g. "38.2 EIB". */
export function netspaceText(bytes: string): string {
  const units = ["B", "KIB", "MIB", "GIB", "TIB", "PIB", "EIB"];
  let v = Number(bytes);
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(1)} ${units[u]}`;
}
```

- [ ] **Step 4: Point `board/header.ts` at the shared module**

Delete both function bodies from `web/src/themes/board/header.ts` (lines 8–25) and add to its imports:

```ts
import { mempoolGauge, netspaceText } from "../../ui/gauges.js";
```

`mempoolGauge` was a named export of `header.ts`. Keep that export alive so `board-header.test.ts` and any other importer are unaffected:

```ts
export { mempoolGauge };
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run web/test/ui-gauges.test.ts web/test/board-header.test.ts`
Expected: PASS. `board-header.test.ts` must pass **unchanged** — if it does not, the move altered behaviour and the diff is wrong.

- [ ] **Step 6: Run the full suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/ui/gauges.ts web/src/themes/board/header.ts web/test/ui-gauges.test.ts
git commit -m "refactor: lift mempool and netspace formatters into ui/gauges"
```

---

### Task 3: The mempool/netspace strip

`BlockConsole` already prints height, per-kind spend counts and fees for every theme, and block height is about to be in-world on the band labels. The only genuinely missing on-screen numbers are mempool and netspace.

**Files:**

- Create: `web/src/themes/lake/strip.ts`
- Create: `web/test/lake-strip.test.ts`
- Modify: `web/index.html:15`
- Modify: `web/src/style.css` (append)

**Interfaces:**

- Consumes: `mempoolGauge`, `netspaceText` from Task 2.
- Produces: `createLakeStrip(root: HTMLElement): LakeStrip` where `interface LakeStrip { setMempool(size: number): void; setNetspace(bytes: string): void }`, and the pure `stripText(mempoolSize: number, netspaceBytes: string): string`.

- [ ] **Step 1: Write the failing test**

Create `web/test/lake-strip.test.ts`. Only the pure formatter is unit-tested — the DOM wiring is three lines of `textContent` and is not worth a jsdom dependency the repo does not currently carry:

```ts
import { expect, test } from "vitest";
import { stripText } from "../src/themes/lake/strip.js";

test("the strip shows both gauges on one line", () => {
  expect(stripText(2500, String(1024 ** 6 * 25))).toBe(
    "MEMPOOL ▮▮▮▮▮····· 2500   NETSPACE 25.0 EIB"
  );
});

test("an empty mempool and unknown netspace still render", () => {
  expect(stripText(0, "0")).toBe("MEMPOOL ·········· 0   NETSPACE 0.0 B");
  expect(stripText(NaN, "")).toBe("MEMPOOL ·········· —   NETSPACE 0.0 B");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run web/test/lake-strip.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the strip**

Create `web/src/themes/lake/strip.ts`:

```ts
import { mempoolGauge, netspaceText } from "../../ui/gauges.js";

const GAUGE_WIDTH = 10;

export interface LakeStrip {
  setMempool(size: number): void;
  setNetspace(bytes: string): void;
}

/**
 * One line of chain weather. Pure, so the formatting is testable without a DOM.
 * A non-finite mempool size prints an em dash rather than "NaN" — the strip
 * renders before the first AmbientEvent arrives.
 */
export function stripText(mempoolSize: number, netspaceBytes: string): string {
  const size = Number.isFinite(mempoolSize) ? String(mempoolSize) : "—";
  const gauge = mempoolGauge(mempoolSize, GAUGE_WIDTH);
  return `MEMPOOL ${gauge} ${size}   NETSPACE ${netspaceText(netspaceBytes)}`;
}

/** Mount the strip into `root` (the `#lake-strip` div) and return its setters. */
export function createLakeStrip(root: HTMLElement): LakeStrip {
  let mempoolSize = NaN;
  let netspaceBytes = "0";
  root.hidden = false;
  const render = () => {
    root.textContent = stripText(mempoolSize, netspaceBytes);
  };
  render();
  return {
    setMempool(size) {
      mempoolSize = size;
      render();
    },
    setNetspace(bytes) {
      netspaceBytes = bytes;
      render();
    },
  };
}
```

- [ ] **Step 4: Add the host element**

In `web/index.html`, after the `#console` div:

```html
<div id="lake-strip" hidden></div>
```

- [ ] **Step 5: Style it**

Append to `web/src/style.css`, matching the existing overlay conventions (check `#console`'s rule and mirror its font stack, color and z-index rather than inventing new values):

```css
#lake-strip {
  position: fixed;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 12px;
  border-radius: 4px;
  background: rgba(10, 36, 54, 0.72);
  color: #a8e0f5;
  font:
    12px/1.4 ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
  letter-spacing: 0.06em;
  white-space: pre;
  pointer-events: none;
  z-index: 3;
}

@media (max-width: 640px) {
  #lake-strip {
    font-size: 10px;
    padding: 4px 8px;
  }
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run web/test/lake-strip.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the full suite and commit**

Run: `npm run typecheck && npm run lint && npm test`

```bash
git add web/src/themes/lake/strip.ts web/test/lake-strip.test.ts web/index.html web/src/style.css
git commit -m "feat(lake): mempool and netspace strip"
```

Wiring into the theme happens in Task 11 — the strip is inert until then.

---

### Task 4: Hand full events to the lake's handlers

The block handler currently receives only `blocksSeen` and the ambient handler only `mempoolSize`, so `spendCount`, `fees` and `mempoolCost` never reach the theme. Everything downstream needs them.

**Files:**

- Modify: `web/src/themes/lake/lake.ts:50-89`
- Modify: `web/src/themes/lake/index.ts:70-71`
- Modify: `server/test/classify.test.ts` (append)

**Interfaces:**

- Consumes: nothing.
- Produces: `setBlockHandler((event: BlockEvent, blocksSeen: number) => void)` and `setAmbientHandler((event: AmbientEvent) => void)` on `LakeRuntime`. Every later task depends on these signatures.

- [ ] **Step 1: Write the failing server test**

The descent in Task 8 depends on the `BlockEvent` arriving before its spends. That is a server guarantee, so pin it. Append to `server/test/classify.test.ts` (reuse whatever block-fixture helper the file already defines rather than building a new one):

```ts
test("a block's summary event precedes every one of its spends", () => {
  const events = classifyBlock(blockWithSpends());
  expect(events[0].type).toBe("block");
  expect(events.slice(1).every((e) => e.type !== "block")).toBe(true);
});
```

- [ ] **Step 2: Run it to verify it passes**

Run: `npx vitest run server/test/classify.test.ts`
Expected: PASS immediately — this is a characterization test locking in existing behaviour, not a driver for new code. If it fails, stop: the ordering assumption behind Task 8 is wrong and the design needs revisiting.

- [ ] **Step 3: Widen the handler signatures**

In `web/src/themes/lake/lake.ts`, change the import on line 2 and the handler declarations on lines 51–52:

```ts
import type { AmbientEvent, BlockEvent, GroveEvent, SproutEvent } from "@grove/shared";
```

```ts
let onBlockExtra = (_event: BlockEvent, _blocksSeen: number) => {};
let onAmbientExtra = (_event: AmbientEvent) => {};
```

and the dispatch on lines 71–80:

```ts
      case "block":
        blocksSeen++;
        onBlockExtra(event, blocksSeen);
        break;
      case "sprout":
        onSprout(event, blocksSeen);
        break;
      case "ambient":
        water.setNetspace(event.netspace);
        onAmbientExtra(event);
        break;
```

- [ ] **Step 4: Update the one existing caller**

In `web/src/themes/lake/index.ts`, lines 70–71 become:

```ts
runtime.setBlockHandler(() => runtime.water.ripple(clock.t));
runtime.setAmbientHandler((event) => vfx.setMempool(event.mempoolSize));
```

Behaviour is unchanged; only the shape of what the handlers receive has widened.

- [ ] **Step 5: Run the full suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS with no visual change.

- [ ] **Step 6: Commit**

```bash
git add web/src/themes/lake/lake.ts web/src/themes/lake/index.ts server/test/classify.test.ts
git commit -m "refactor(lake): pass whole block and ambient events to handlers"
```

---

### Task 5: Rim rings — bands become visible objects

**Files:**

- Create: `web/src/themes/lake/bands.ts`
- Create: `web/test/lake-bands.test.ts`
- Modify: `web/src/themes/lake/palette.ts`

**Interfaces:**

- Consumes: `bandDepth`, `RIM_RADIUS`, `MAX_BANDS` (Task 1).
- Produces:
  - `ringBrightness(spendCount: number): number` — pure, 0..1.
  - `feeWarmth(fees: string): number` — pure, 0..1.
  - `class Bands` with `push(event: BlockEvent, bornBlock: number): void`, `update(blocksSmooth: number, camera: THREE.Camera): void`, `clearAbove(forkHeight: number): void`, `count(): number`, and test seams `entryAt(i: number): BandEntry | null` and `ringColorAt(i: number): THREE.Color`.
- Task 6 adds labels to this same class; Task 11 wires it into `index.ts`.

- [ ] **Step 1: Add the palette colors**

In `web/src/themes/lake/palette.ts`, add three entries to the `LAKE` object:

```ts
  rim: 0x7fd4e8, // rim rings marking each block's band
  rimWarm: 0xe8c07f, // fee-heavy blocks shade the ring warm
  pending: 0x1c4a63, // mempool silhouettes: barely above the fog
```

- [ ] **Step 2: Write the failing test**

Create `web/test/lake-bands.test.ts`:

```ts
import * as THREE from "three";
import { expect, test } from "vitest";
import type { BlockEvent } from "@grove/shared";
import { Bands, ringBrightness, feeWarmth } from "../src/themes/lake/bands.js";
import { MAX_BANDS, RIM_RADIUS, bandDepth } from "../src/themes/lake/layout.js";

const block = (height: number, spendCount = 10, fees = "0"): BlockEvent => ({
  type: "block",
  height,
  headerHash: height.toString(16).padStart(64, "0"),
  timestamp: 1_700_000_000 + height,
  spendCount,
  fees,
});

test("busier blocks get brighter rings, bounded at both ends", () => {
  expect(ringBrightness(0)).toBeGreaterThan(0);
  expect(ringBrightness(500)).toBeLessThanOrEqual(1);
  expect(ringBrightness(50)).toBeGreaterThan(ringBrightness(5));
  expect(ringBrightness(NaN)).toBeGreaterThan(0);
  expect(Number.isFinite(ringBrightness(-3))).toBe(true);
});

test("fee-heavy blocks shade warm, bounded, and junk fees read as zero", () => {
  expect(feeWarmth("0")).toBe(0);
  expect(feeWarmth("")).toBe(0);
  expect(feeWarmth("not-a-number")).toBe(0);
  expect(feeWarmth("100000000000")).toBeLessThanOrEqual(1);
  expect(feeWarmth("10000000000")).toBeGreaterThan(feeWarmth("1000000"));
});

test("one ring per block, wrapping at the column depth", () => {
  const bands = new Bands(new THREE.Scene());
  for (let h = 0; h < MAX_BANDS + 5; h++) bands.push(block(h), h);
  expect(bands.count()).toBe(MAX_BANDS);
  // the oldest entries were overwritten, not the newest
  const heights = Array.from({ length: MAX_BANDS }, (_, i) => bands.entryAt(i)?.height);
  expect(Math.max(...(heights as number[]))).toBe(MAX_BANDS + 4);
});

test("rings sit at their band's depth and sink as blocks arrive", () => {
  const scene = new THREE.Scene();
  const bands = new Bands(scene);
  bands.push(block(100), 1);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(40, -30, 0);

  const yAt = (blocksSmooth: number) => {
    bands.update(blocksSmooth, camera);
    const m = new THREE.Matrix4();
    bands.mesh.getMatrixAt(0, m);
    return new THREE.Vector3().setFromMatrixPosition(m).y;
  };

  expect(yAt(1)).toBeCloseTo(bandDepth(0), 4);
  expect(yAt(4)).toBeCloseTo(bandDepth(3), 4);
  expect(yAt(4)).toBeLessThan(yAt(1));
});

test("rings ring the creature annulus rather than sitting inside it", () => {
  const bands = new Bands(new THREE.Scene());
  const box = new THREE.Box3().setFromBufferAttribute(
    bands.mesh.geometry.getAttribute("position") as THREE.BufferAttribute
  );
  expect(box.max.x).toBeCloseTo(RIM_RADIUS, 0);
  expect(box.max.y).toBeLessThan(1); // lies flat, not standing up
});

test("a reorg drops the orphaned bands and shrinks the draw count", () => {
  const scene = new THREE.Scene();
  const bands = new Bands(scene);
  for (let h = 100; h < 105; h++) bands.push(block(h), h - 99);
  bands.clearAbove(103);
  expect(bands.count()).toBe(3);
  expect(bands.mesh.count).toBeLessThanOrEqual(3);
});

test("a cap of 1 forces a wrap on the second block", () => {
  const bands = new Bands(new THREE.Scene(), 1);
  bands.push(block(1), 1);
  bands.push(block(2), 2);
  expect(bands.count()).toBe(1);
  expect(bands.entryAt(0)?.height).toBe(2);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run web/test/lake-bands.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `bands.ts`**

Create `web/src/themes/lake/bands.ts`:

```ts
import * as THREE from "three";
import type { BlockEvent } from "@grove/shared";
import { MAX_BANDS, RIM_RADIUS, bandDepth } from "./layout.js";
import { LAKE } from "./palette.js";

/** Fee level (mojos) at which a ring is fully warm. ~10 XCH of fees. */
const FEE_FULL = 1e10;
/** Spend count at which a ring is fully bright. */
const SPENDS_FULL = 120;
const RING_TUBE = 0.07;
/** How far down the column a ring has faded to nothing. */
const FADE_BANDS = MAX_BANDS;

export interface BandEntry {
  height: number;
  spendCount: number;
  fees: string;
  bornBlock: number;
}

/**
 * Spend count → ring brightness in 0..1. Square-rooted rather than linear so
 * the difference between a quiet block and an average one is visible; a linear
 * ramp buries everything below ~40 spends in the same dim band.
 */
export function ringBrightness(spendCount: number): number {
  const n = Number.isFinite(spendCount) ? Math.max(0, spendCount) : 0;
  return 0.25 + 0.75 * Math.sqrt(Math.min(1, n / SPENDS_FULL));
}

/** Block fees (mojos, as a string) → 0..1 warmth. Junk reads as zero. */
export function feeWarmth(fees: string): number {
  const mojos = Number(fees);
  if (!Number.isFinite(mojos) || mojos <= 0) return 0;
  return Math.min(1, Math.log10(1 + mojos) / Math.log10(1 + FEE_FULL));
}

/**
 * The visible strata. The original lake deliberately kept no per-band state —
 * depth was `bandDepth(blocksSeen - bornBlock)` and nothing else. That was
 * right while a band was invisible; now the band must *be* something, so this
 * class holds one entry per block. `bandDepth` is untouched and still drives
 * every position, including these rings — this is presentation state layered
 * on top of the subtraction, not a replacement for it.
 *
 * Rings are additively blended, so brightness rides entirely in the instance
 * color and a dark ring is simply invisible. That lets one material fade all
 * eighteen rings independently with no per-instance opacity.
 */
export class Bands {
  readonly mesh: THREE.InstancedMesh;
  private readonly entries: (BandEntry | null)[];
  private next = 0;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private readonly base = new THREE.Color(LAKE.rim);
  private readonly warm = new THREE.Color(LAKE.rimWarm);

  constructor(scene: THREE.Scene, cap = MAX_BANDS) {
    const geometry = new THREE.TorusGeometry(RIM_RADIUS, RING_TUBE, 6, 120);
    geometry.rotateX(Math.PI / 2); // lie flat in the XZ plane
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false, // depth fade is explicit below; fog would double-dim it
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.entries = Array.from({ length: cap }, () => null);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < cap; i++) {
      this.mesh.setMatrixAt(i, zero);
      this.mesh.setColorAt(i, this.base);
    }
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  push(event: BlockEvent, bornBlock: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.entries.length;
    if (i + 1 > this.mesh.count) this.mesh.count = i + 1;
    this.entries[i] = {
      height: event.height,
      spendCount: event.spendCount,
      fees: event.fees,
      bornBlock,
    };
  }

  update(blocksSmooth: number, _camera: THREE.Camera): void {
    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      if (!entry) continue;
      const age = blocksSmooth - entry.bornBlock;
      this.position.set(0, bandDepth(age), 0);
      // vertical scale thickens the tube for a busy block without moving the
      // ring's radius, which a uniform scale would
      const brightness = ringBrightness(entry.spendCount);
      this.scale.set(1, 1 + brightness * 2.5, 1);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      this.mesh.setMatrixAt(i, this.matrix);

      const fade = Math.max(0, 1 - Math.max(0, age) / FADE_BANDS);
      this.color.copy(this.base).lerp(this.warm, feeWarmth(entry.fees));
      this.color.multiplyScalar(brightness * fade * fade);
      this.mesh.setColorAt(i, this.color);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Reorg: drop the orphaned bands and shrink the draw count. */
  clearAbove(forkHeight: number): void {
    let highestActive = -1;
    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      if (entry && entry.height >= forkHeight) {
        this.entries[i] = null;
        this.matrix.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this.matrix);
      } else if (entry) {
        highestActive = i;
      }
    }
    this.mesh.count = Math.min(this.mesh.count, highestActive + 1);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  count(): number {
    return this.entries.reduce((n, e) => (e ? n + 1 : n), 0);
  }

  /** Test seam. */
  entryAt(i: number): BandEntry | null {
    return this.entries[i] ?? null;
  }

  /** Test seam. */
  ringColorAt(i: number): THREE.Color {
    const c = new THREE.Color();
    this.mesh.getColorAt(i, c);
    return c;
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run web/test/lake-bands.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full suite and commit**

Run: `npm run typecheck && npm run lint && npm test`

```bash
git add web/src/themes/lake/bands.ts web/src/themes/lake/palette.ts web/test/lake-bands.test.ts
git commit -m "feat(lake): rim rings make each block's band visible"
```

---

### Task 6: Height labels on the newest bands

A ring says "a block happened here"; a label says _which_ block. Labels ride the near edge of the ring so they stay legible as the camera orbits.

**Files:**

- Modify: `web/src/themes/lake/bands.ts`
- Modify: `web/test/lake-bands.test.ts` (append)

**Interfaces:**

- Consumes: `Bands` from Task 5.
- Produces: `labelOpacity(age: number): number` — pure, 0..1. `Bands.update` gains real use of its `camera` parameter. No signature changes.

- [ ] **Step 1: Write the failing test**

Append to `web/test/lake-bands.test.ts`:

```ts
test("only the newest bands are labelled", () => {
  expect(labelOpacity(0)).toBe(1);
  expect(labelOpacity(6)).toBe(0);
  expect(labelOpacity(2)).toBeGreaterThan(0);
  expect(labelOpacity(2)).toBeLessThanOrEqual(1);
  expect(labelOpacity(-1)).toBe(1); // smoothed counter can dip below zero
});

test("labels ride the near edge of the ring as the camera orbits", () => {
  const bands = new Bands(new THREE.Scene());
  bands.push(block(4200), 1);
  const camera = new THREE.PerspectiveCamera();

  camera.position.set(40, -20, 0);
  bands.update(1, camera);
  const east = bands.labelPosition(0).clone();

  camera.position.set(0, -20, 40);
  bands.update(1, camera);
  const north = bands.labelPosition(0).clone();

  expect(east.x).toBeGreaterThan(east.z);
  expect(north.z).toBeGreaterThan(north.x);
  // always just outside the ring, never inside the creature annulus
  expect(Math.hypot(east.x, east.z)).toBeGreaterThan(RIM_RADIUS);
});

test("a culled band takes its label with it", () => {
  const bands = new Bands(new THREE.Scene());
  bands.push(block(100), 1);
  expect(bands.labelVisible(0)).toBe(true);
  bands.clearAbove(100);
  expect(bands.labelVisible(0)).toBe(false);
});
```

Extend the import: `import { Bands, ringBrightness, feeWarmth, labelOpacity } from "../src/themes/lake/bands.js";`

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run web/test/lake-bands.test.ts`
Expected: FAIL — `labelOpacity`, `labelPosition`, `labelVisible` are not exported.

- [ ] **Step 3: Implement the labels**

Add to `web/src/themes/lake/bands.ts`. Note the canvas guard: vitest runs in Node with no `document`, so texture creation must degrade rather than throw, while positions and opacity stay fully testable.

```ts
/** Labels only on the newest few bands; the deep column stays quiet. */
const LABELLED_BANDS = 5;
const LABEL_RADIUS = RIM_RADIUS + 2.5;

/** Band age (in blocks) → label opacity. Pure. */
export function labelOpacity(age: number): number {
  if (age <= 0) return 1;
  if (age >= LABELLED_BANDS) return 0;
  return 1 - age / LABELLED_BANDS;
}

/**
 * A block height drawn to a canvas texture. Redrawn once per block — at 18.75 s
 * a block this is free. Returns null under Node (tests), where the sprite is
 * still created and positioned but carries no texture.
 */
function labelTexture(height: number): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.font = "600 34px ui-monospace, Menlo, monospace";
  ctx.fillStyle = "#a8e0f5";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(height), 128, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
```

Inside the class, add fields and construct one sprite per slot:

```ts
  private readonly labels: THREE.Sprite[];
```

At the end of the constructor:

```ts
this.labels = Array.from({ length: cap }, () => {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ transparent: true, depthWrite: false, fog: false, opacity: 0 })
  );
  sprite.scale.set(7, 1.75, 1);
  sprite.visible = false;
  scene.add(sprite);
  return sprite;
});
```

In `push()`, after writing the entry, swap the texture:

```ts
const sprite = this.labels[i];
const material = sprite.material as THREE.SpriteMaterial;
material.map?.dispose(); // the recycled slot's texture is now unreachable
material.map = labelTexture(event.height);
material.needsUpdate = true;
sprite.visible = true;
```

In `update()`, inside the per-entry loop (replace the `_camera` parameter name with `camera`):

```ts
const sprite = this.labels[i];
const opacity = labelOpacity(age);
sprite.visible = opacity > 0;
if (sprite.visible) {
  // ride the near edge: the bearing of the camera, so an orbiting camera
  // always reads the label face-on rather than watching it swing behind
  const bearing = Math.atan2(camera.position.z, camera.position.x);
  sprite.position.set(
    Math.cos(bearing) * LABEL_RADIUS,
    bandDepth(age),
    Math.sin(bearing) * LABEL_RADIUS
  );
  (sprite.material as THREE.SpriteMaterial).opacity = opacity;
}
```

In `clearAbove()`, in the branch that nulls an entry:

```ts
this.labels[i].visible = false;
```

And the two test seams:

```ts
  /** Test seam. */
  labelPosition(i: number): THREE.Vector3 {
    return this.labels[i].position;
  }

  /** Test seam. */
  labelVisible(i: number): boolean {
    return this.labels[i].visible;
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run web/test/lake-bands.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite and commit**

Run: `npm run typecheck && npm run lint && npm test`

```bash
git add web/src/themes/lake/bands.ts web/test/lake-bands.test.ts
git commit -m "feat(lake): label the newest bands with their block height"
```

---

### Task 7: The mempool churn layer

Pending transactions move from bubble vents on the bed — the deep past — to a restless layer under the surface, where the future belongs.

**Files:**

- Create: `web/src/themes/lake/pending.ts`
- Create: `web/test/lake-pending.test.ts`

**Interfaces:**

- Consumes: `PENDING_Y_MIN`, `PENDING_Y_MAX`, `BAND_RADIUS_MIN/MAX` (Task 1); `fishGeometry`, `applySwimShader` (`bodies.ts`, unchanged).
- Produces:
  - `litCount(mempoolSize: number, cap: number): number` — pure.
  - `churnRate(mempoolSize: number, mempoolCost: number): number` — pure, ≥ 0.5.
  - `class Pending` with `setMempool(size: number, cost: number): void`, `update(dt: number, t: number): void`, `lit(): number`. `release()` arrives in Task 8.

- [ ] **Step 1: Write the failing test**

Create `web/test/lake-pending.test.ts`:

```ts
import * as THREE from "three";
import { expect, test } from "vitest";
import { Pending, litCount, churnRate } from "../src/themes/lake/pending.js";
import { PENDING_Y_MIN, PENDING_Y_MAX } from "../src/themes/lake/layout.js";

test("lit silhouettes scale with mempool size and clamp at the cap", () => {
  expect(litCount(0, 600)).toBe(0);
  expect(litCount(5000, 600)).toBe(600);
  expect(litCount(2500, 600)).toBe(300);
  expect(litCount(99999, 600)).toBe(600);
  expect(litCount(-5, 600)).toBe(0);
  expect(litCount(NaN, 600)).toBe(0);
});

test("congestion turns into agitation, never into stillness", () => {
  const calm = churnRate(1000, 1000 * 1e7);
  const congested = churnRate(1000, 1000 * 5e8);
  expect(congested).toBeGreaterThan(calm);
  expect(calm).toBeGreaterThanOrEqual(0.5);
  expect(churnRate(0, 0)).toBeGreaterThanOrEqual(0.5);
  expect(Number.isFinite(churnRate(0, 500))).toBe(true);
  expect(Number.isFinite(churnRate(NaN, NaN))).toBe(true);
});

test("silhouettes churn inside the layer, never in a band or above the surface", () => {
  const pending = new Pending(new THREE.Scene(), 40);
  pending.setMempool(5000, 5000 * 1e7);
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  for (let step = 0; step < 40; step++) {
    pending.update(0.05, step * 0.05);
    for (let i = 0; i < pending.lit(); i++) {
      pending.mesh.getMatrixAt(i, m);
      v.setFromMatrixPosition(m);
      expect(v.y).toBeGreaterThanOrEqual(PENDING_Y_MIN - 0.6);
      expect(v.y).toBeLessThanOrEqual(PENDING_Y_MAX + 0.6);
    }
  }
});

test("a shrinking mempool unlights silhouettes", () => {
  const pending = new Pending(new THREE.Scene(), 600);
  pending.setMempool(5000, 5000 * 1e7);
  expect(pending.lit()).toBe(600);
  pending.setMempool(500, 500 * 1e7);
  expect(pending.lit()).toBe(60);
});

test("the layer is deterministic across rebuilds", () => {
  const read = () => {
    const p = new Pending(new THREE.Scene(), 20);
    p.setMempool(5000, 5000 * 1e7);
    p.update(0.05, 1.0);
    const m = new THREE.Matrix4();
    p.mesh.getMatrixAt(3, m);
    return new THREE.Vector3().setFromMatrixPosition(m).toArray();
  };
  expect(read()).toEqual(read());
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run web/test/lake-pending.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `pending.ts`**

Create `web/src/themes/lake/pending.ts`:

```ts
import * as THREE from "three";
import { mulberry32 } from "../shared/util.js";
import { BAND_RADIUS_MIN, BAND_RADIUS_MAX, PENDING_Y_MIN, PENDING_Y_MAX } from "./layout.js";
import { LAKE } from "./palette.js";
import { fishGeometry, applySwimShader } from "./bodies.js";

/** Mempool size that fills the layer — the same "full" the board gauge uses. */
const MEMPOOL_FULL = 5000;
/** Average cost per pending spend at which churn is fully agitated. */
const COST_FULL = 5e8;
const CHURN_CAP = 600;
const SILHOUETTE_SIZE = 0.32;

/** Mempool size → how many silhouettes are lit. Pure. */
export function litCount(mempoolSize: number, cap: number): number {
  if (!Number.isFinite(mempoolSize) || mempoolSize <= 0) return 0;
  return Math.min(cap, Math.round((mempoolSize / MEMPOOL_FULL) * cap));
}

/**
 * Average cost per pending spend → churn speed multiplier in 0.5..1.5.
 * A congested mempool is a turbulent one. Never returns 0: an idle layer
 * should still drift, or it reads as frozen rather than calm.
 */
export function churnRate(mempoolSize: number, mempoolCost: number): number {
  if (!Number.isFinite(mempoolSize) || !Number.isFinite(mempoolCost) || mempoolSize <= 0) {
    return 0.5;
  }
  const avg = mempoolCost / mempoolSize;
  if (!Number.isFinite(avg) || avg <= 0) return 0.5;
  return 0.5 + Math.min(1, avg / COST_FULL);
}

interface ChurnSlot {
  radius: number;
  angle: number;
  speed: number;
  bob: number;
  y: number;
}

/**
 * The mempool, rendered where the mempool belongs: a restless layer under the
 * surface, above the newest band. The silhouettes are deliberately anonymous —
 * small, dark, uncolored, unpickable. The server reports mempool size, cost and
 * fees and never reports *what* is pending, so giving these a kind or an asset
 * color would be inventing data the chain did not send.
 *
 * Slots are seeded from a fixed PRNG, so a snapshot replay rebuilds the same
 * layer rather than reshuffling it.
 */
export class Pending {
  readonly mesh: THREE.InstancedMesh;
  private readonly slots: ChurnSlot[];
  private readonly swim: { uniforms: { uTime: { value: number } } };
  private litSlots = 0;
  private rate = 0.5;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly scale = new THREE.Vector3();

  constructor(scene: THREE.Scene, cap = CHURN_CAP) {
    const material = new THREE.MeshStandardMaterial({
      color: LAKE.pending,
      roughness: 0.9,
      metalness: 0,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
    });
    this.swim = applySwimShader(material, {
      instanced: true,
      amp: 0.1,
      freq: 8.0, // faster than a real fish: these are agitated, not swimming
      waveLen: 3.2,
      nose: 0.6,
      span: 1.2,
    });
    this.mesh = new THREE.InstancedMesh(fishGeometry(), material, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    const phase = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    this.mesh.geometry.setAttribute("aSwimPhase", phase);

    const rand = mulberry32(0x9a7e1c03);
    this.slots = Array.from({ length: cap }, (_, i) => {
      phase.setX(i, rand() * Math.PI * 2);
      return {
        radius: BAND_RADIUS_MIN + Math.sqrt(rand()) * (BAND_RADIUS_MAX - BAND_RADIUS_MIN),
        angle: rand() * Math.PI * 2,
        speed: (0.12 + rand() * 0.28) * (rand() < 0.5 ? -1 : 1), // both bearings: churn, not a parade
        bob: rand() * Math.PI * 2,
        y: PENDING_Y_MIN + rand() * (PENDING_Y_MAX - PENDING_Y_MIN),
      };
    });
    phase.needsUpdate = true;

    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < cap; i++) this.mesh.setMatrixAt(i, zero);
    this.mesh.count = cap;
    scene.add(this.mesh);
  }

  setMempool(size: number, cost: number): void {
    this.litSlots = litCount(size, this.slots.length);
    this.rate = churnRate(size, cost);
  }

  lit(): number {
    return this.litSlots;
  }

  update(_dt: number, t: number): void {
    this.swim.uniforms.uTime.value = t;
    for (let i = 0; i < this.slots.length; i++) {
      if (i >= this.litSlots) {
        this.matrix.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this.matrix);
        continue;
      }
      const slot = this.slots[i];
      const angle = slot.angle + t * slot.speed * this.rate;
      // a shallow vertical mill inside the layer, never leaving it
      const span = (PENDING_Y_MAX - PENDING_Y_MIN) / 2;
      const mid = (PENDING_Y_MAX + PENDING_Y_MIN) / 2;
      const y = mid + Math.sin(t * 0.6 * this.rate + slot.bob) * span;
      const heading = -(angle + Math.PI / 2);
      this.euler.set(0, heading, 0);
      this.quaternion.setFromEuler(this.euler);
      this.matrix.compose(
        this.position.set(Math.cos(angle) * slot.radius, y, Math.sin(angle) * slot.radius),
        this.quaternion,
        this.scale.setScalar(SILHOUETTE_SIZE)
      );
      this.mesh.setMatrixAt(i, this.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run web/test/lake-pending.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite and commit**

Run: `npm run typecheck && npm run lint && npm test`

```bash
git add web/src/themes/lake/pending.ts web/test/lake-pending.test.ts
git commit -m "feat(lake): mempool churns beneath the surface, not on the bed"
```

---

### Task 8: The descent — a block resolves the pending layer

**Files:**

- Modify: `web/src/themes/lake/pending.ts`
- Modify: `web/test/lake-pending.test.ts` (append)

**Interfaces:**

- Consumes: `Pending` from Task 7.
- Produces: `Pending.release(count: number, t: number): number` (returns how many actually fell) and `Pending.falling(): number`. `update` gains the falling pass. Task 11 calls `release` from the block handler.

- [ ] **Step 1: Write the failing test**

Append to `web/test/lake-pending.test.ts`:

```ts
import { TOP_BAND_Y } from "../src/themes/lake/layout.js";

test("a block releases silhouettes, which sink past the newest band and vanish", () => {
  const pending = new Pending(new THREE.Scene(), 100);
  pending.setMempool(5000, 5000 * 1e7);
  expect(pending.release(20, 0)).toBe(20);
  expect(pending.falling()).toBe(20);

  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const firstFalling = pending.fallSlotIndex(0);
  pending.update(0.05, 0.05);
  pending.mesh.getMatrixAt(firstFalling, m);
  const early = v.setFromMatrixPosition(m).y;

  for (let step = 2; step <= 12; step++) pending.update(0.1, step * 0.1);
  pending.mesh.getMatrixAt(firstFalling, m);
  const late = v.setFromMatrixPosition(m).y;

  expect(late).toBeLessThan(early);
  expect(late).toBeLessThanOrEqual(TOP_BAND_Y);

  // the descent finishes and the slots return to the pool
  for (let step = 13; step <= 60; step++) pending.update(0.1, step * 0.1);
  expect(pending.falling()).toBe(0);
});

test("a block bigger than the mempool releases what there is and no more", () => {
  const pending = new Pending(new THREE.Scene(), 100);
  pending.setMempool(250, 250 * 1e7); // 5 lit
  expect(pending.lit()).toBe(5);
  expect(pending.release(400, 0)).toBe(5);
  expect(pending.falling()).toBe(5);
});

test("releasing from an empty mempool is a no-op, not a crash", () => {
  const pending = new Pending(new THREE.Scene(), 100);
  pending.setMempool(0, 0);
  expect(pending.release(30, 0)).toBe(0);
  expect(pending.falling()).toBe(0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run web/test/lake-pending.test.ts`
Expected: FAIL — `release`, `falling`, `fallSlotIndex` are not defined.

- [ ] **Step 3: Implement the descent**

The falling silhouettes need their own instance slots so a shrinking `litSlots` cannot yank one mid-fall. Reserve a tail region of the same mesh rather than adding a second draw call.

In `web/src/themes/lake/pending.ts`, add constants and state:

```ts
const FALL_CAP = 200;
const FALL_SECONDS = 1.1;
/** How far below the newest band a released silhouette fades out. */
const FALL_DEPTH = 3;
```

```ts
interface FallSlot {
  fromY: number;
  radius: number;
  angle: number;
  bornAt: number;
  active: boolean;
}
```

Change the constructor to allocate `cap + FALL_CAP` instances while keeping `this.slots.length === cap`, so `litCount` and every existing test still see the churn cap:

```ts
this.mesh = new THREE.InstancedMesh(fishGeometry(), material, cap + FALL_CAP);
```

```ts
const phase = new THREE.InstancedBufferAttribute(new Float32Array(cap + FALL_CAP), 1);
```

```ts
this.falls = Array.from({ length: FALL_CAP }, () => ({
  fromY: 0,
  radius: 0,
  angle: 0,
  bornAt: 0,
  active: false,
}));
```

```ts
const zero = new THREE.Matrix4().makeScale(0, 0, 0);
for (let i = 0; i < cap + FALL_CAP; i++) this.mesh.setMatrixAt(i, zero);
this.mesh.count = cap + FALL_CAP;
```

Add the fields, the public methods and the falling pass:

```ts
  private readonly falls: FallSlot[];
  private nextFall = 0;
  private activeFalls = 0;

  /**
   * A block confirmed: detach `count` silhouettes from the churn layer and sink
   * them through the newest band. Releases `min(count, lit, FALL_CAP)` — a big
   * block can outrun a small mempool, and a snapshot replay arrives with no
   * ambient history at all, so this is a gesture rather than an accounting.
   *
   * @returns how many actually fell.
   */
  release(count: number, t: number): number {
    if (!Number.isFinite(count) || count <= 0) return 0;
    const n = Math.min(Math.floor(count), this.litSlots, FALL_CAP);
    for (let k = 0; k < n; k++) {
      // take from the churn layer's tail so the visible thinning reads as the
      // layer being drained rather than punched through the middle
      const source = this.slots[this.litSlots - 1 - k];
      const fall = this.falls[this.nextFall];
      this.nextFall = (this.nextFall + 1) % FALL_CAP;
      if (!fall.active) this.activeFalls++;
      fall.fromY = (PENDING_Y_MAX + PENDING_Y_MIN) / 2;
      fall.radius = source.radius;
      fall.angle = source.angle + t * source.speed * this.rate;
      fall.bornAt = t;
      fall.active = true;
    }
    return n;
  }

  /** How many silhouettes are mid-descent. Test seam. */
  falling(): number {
    return this.activeFalls;
  }

  /** Instance index of the nth fall slot. Test seam. */
  fallSlotIndex(n: number): number {
    return this.slots.length + n;
  }
```

At the end of `update()`, before the `needsUpdate` write:

```ts
// the descent: released silhouettes sink past the newest band and fade
const target = TOP_BAND_Y - FALL_DEPTH;
for (let k = 0; k < this.falls.length; k++) {
  const fall = this.falls[k];
  const index = this.slots.length + k;
  if (!fall.active) {
    this.matrix.makeScale(0, 0, 0);
    this.mesh.setMatrixAt(index, this.matrix);
    continue;
  }
  const p = (t - fall.bornAt) / FALL_SECONDS;
  if (p >= 1) {
    fall.active = false;
    this.activeFalls--;
    this.matrix.makeScale(0, 0, 0);
    this.mesh.setMatrixAt(index, this.matrix);
    continue;
  }
  // ease-in: hesitates, then commits — a sinking motion, not a drop
  const eased = p * p;
  const y = fall.fromY + (target - fall.fromY) * eased;
  const heading = -(fall.angle + Math.PI / 2);
  this.euler.set(0, heading, 0);
  this.quaternion.setFromEuler(this.euler);
  this.matrix.compose(
    this.position.set(Math.cos(fall.angle) * fall.radius, y, Math.sin(fall.angle) * fall.radius),
    this.quaternion,
    this.scale.setScalar(SILHOUETTE_SIZE * (1 - eased)) // shrink away as it crosses
  );
  this.mesh.setMatrixAt(index, this.matrix);
}
```

Extend the layout import with `TOP_BAND_Y`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run web/test/lake-pending.test.ts`
Expected: PASS, including the Task 7 tests — `litCount` still measures against the churn cap, not the enlarged mesh.

- [ ] **Step 5: Run the full suite and commit**

Run: `npm run typecheck && npm run lint && npm test`

```bash
git add web/src/themes/lake/pending.ts web/test/lake-pending.test.ts
git commit -m "feat(lake): a block sinks the pending layer into the newest band"
```

---

### Task 9: Creatures arrive instead of appearing

The other half of the descent: sprouts must resolve into the band rather than popping in at full size.

**Files:**

- Create: `web/src/themes/lake/entry.ts`
- Modify: `web/src/themes/lake/shoal.ts`, `jellies.ts`, `turtles.ts`
- Modify: `web/src/themes/lake/index.ts` (pass `clock.t` to `plant`)
- Create: `web/test/lake-entry.test.ts`
- Modify: `web/test/lake-shoal.test.ts` (append)

**Interfaces:**

- Consumes: nothing.
- Produces: `entryScale(age: number): number` and `entryDrop(age: number): number`, both pure. `Shoal.plant(event, bornBlock, size, color, member, bornAt)`, `Jellies.plant(event, bornBlock, bornAt)`, `Turtles.plant(event, bornBlock, bornAt)` — the new `bornAt` is the last parameter on each and defaults to `0`.

- [ ] **Step 1: Write the failing test**

Create `web/test/lake-entry.test.ts`:

```ts
import { expect, test } from "vitest";
import { entryScale, entryDrop, ENTRY_SECONDS } from "../src/themes/lake/entry.js";

test("a creature grows from nothing to full size and stays there", () => {
  expect(entryScale(0)).toBeCloseTo(0, 5);
  expect(entryScale(ENTRY_SECONDS)).toBeCloseTo(1, 5);
  expect(entryScale(ENTRY_SECONDS * 10)).toBe(1);
  expect(entryScale(0.4)).toBeGreaterThan(entryScale(0.2));
});

test("a creature settles down into its band and stops", () => {
  expect(entryDrop(0)).toBeGreaterThan(0);
  expect(entryDrop(ENTRY_SECONDS)).toBeCloseTo(0, 5);
  expect(entryDrop(ENTRY_SECONDS * 10)).toBe(0);
  expect(entryDrop(0.2)).toBeGreaterThan(entryDrop(0.4));
});

test("a negative age (replay clock skew) is treated as not yet arrived", () => {
  expect(entryScale(-1)).toBe(0);
  expect(entryDrop(-1)).toBeGreaterThan(0);
});
```

Append to `web/test/lake-shoal.test.ts`:

```ts
test("a planted fish scales up into its band rather than popping in", () => {
  const scene = new THREE.Scene();
  const shoal = new Shoal(scene, 0xffffff, 4);
  shoal.plant(sprout("aa".repeat(32), 100), 1, 1.0, null, 0, 10);

  const m = new THREE.Matrix4();
  const scale = new THREE.Vector3();
  const position = new THREE.Vector3();

  shoal.update(10, 1);
  shoal.mesh.getMatrixAt(0, m);
  m.decompose(position, new THREE.Quaternion(), scale);
  const startScale = scale.x;
  const startY = position.y;

  shoal.update(11, 1); // a full second later — the entry has finished
  shoal.mesh.getMatrixAt(0, m);
  m.decompose(position, new THREE.Quaternion(), scale);

  expect(startScale).toBeLessThan(0.1);
  expect(scale.x).toBeCloseTo(1.0, 2);
  expect(position.y).toBeLessThan(startY); // settled down into the band
});

test("the entry envelope is idempotent across repeated updates", () => {
  const shoal = new Shoal(new THREE.Scene(), 0xffffff, 4);
  shoal.plant(sprout("bb".repeat(32), 100), 1, 1.0, null, 0, 0);
  const read = () => {
    shoal.update(5, 1);
    const m = new THREE.Matrix4();
    shoal.mesh.getMatrixAt(0, m);
    return new THREE.Vector3().setFromMatrixPosition(m).toArray();
  };
  expect(read()).toEqual(read());
});
```

Use whatever `sprout(...)` fixture helper `lake-shoal.test.ts` already defines; do not add a second one.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run web/test/lake-entry.test.ts web/test/lake-shoal.test.ts`
Expected: FAIL — `entry.js` not found; `plant` takes five parameters.

- [ ] **Step 3: Implement the envelope**

Create `web/src/themes/lake/entry.ts`:

```ts
/**
 * The arrival envelope. A confirmed spend resolves out of the descending
 * pending layer rather than blinking into existence at full size, so it grows
 * from nothing while settling down the last few units into its band.
 *
 * Both functions are pure functions of age in seconds, so replay is safe: a
 * snapshot plants hundreds of sprouts across a handful of frames and every one
 * of them animating in is correct — they genuinely are arriving.
 */
export const ENTRY_SECONDS = 0.8;
/** How far above its band a creature starts. */
const ENTRY_RISE = 2.4;

/** Age (seconds) → 0..1 size multiplier. Smoothstep, so there is no pop. */
export function entryScale(age: number): number {
  if (!(age > 0)) return 0;
  if (age >= ENTRY_SECONDS) return 1;
  const p = age / ENTRY_SECONDS;
  return p * p * (3 - 2 * p);
}

/** Age (seconds) → how far above its band the creature still is. */
export function entryDrop(age: number): number {
  if (!(age > 0)) return ENTRY_RISE;
  if (age >= ENTRY_SECONDS) return 0;
  return ENTRY_RISE * (1 - entryScale(age));
}
```

- [ ] **Step 4: Apply it in `Shoal`**

In `web/src/themes/lake/shoal.ts`: add `bornAt: number` to `FishSlot`, seed it in the slot factory (`bornAt: 0`), add the parameter to `plant`:

```ts
  plant(
    event: SproutEvent,
    bornBlock: number,
    size: number,
    color: THREE.Color | null,
    member = 0,
    bornAt = 0
  ): void {
```

set `slot.bornAt = bornAt;` alongside `slot.bornBlock`, and in `update()` replace the `y` and `scale` lines:

```ts
const entryAge = t - slot.bornAt;
const y =
  bandDepth(blocksSeen - slot.bornBlock) +
  Math.sin(t * 0.8 + seat.bob) * BOB_AMPLITUDE +
  entryDrop(entryAge);
```

```ts
this.scale.setScalar(slot.size * entryScale(entryAge));
```

Import: `import { entryScale, entryDrop } from "./entry.js";`

- [ ] **Step 5: Apply it in `Jellies` and `Turtles`**

Both classes hold a slot record with `bornBlock` and compose a matrix or set `group.scale` / `group.position.y` in `update()`. Make the identical change in each:

1. Add `bornAt: number` to the slot interface, defaulting to `0`.
2. Add `bornAt = 0` as the final parameter of `plant()` and store it.
3. In `update()`, compute `const entryAge = t - slot.bornAt;`, add `entryDrop(entryAge)` to the Y the slot is placed at, and multiply the slot's final scale by `entryScale(entryAge)`.

For `Jellies`, multiply the existing bell pulse scale rather than replacing it — the entry envelope and the medusa pulse compose. For `Turtles`, multiply the group scale, leaving the flipper stroke untouched.

- [ ] **Step 6: Pass the clock at plant time**

In `web/src/themes/lake/index.ts`, thread `clock.t` through every `plant` call in the sprout handler:

```ts
if (event.kind === "xch") {
  xchFish.plant(event, blocksSeen, fishSize(event.amount), null, 0, clock.t);
  return;
}
if (event.kind === "cat") {
  const { h, s, l } = catColor(event.assetId ?? "0".repeat(64));
  schoolColor.setHSL(h, s, l);
  const count = schoolSize(event.amount);
  for (let member = 0; member < count; member++) {
    catFish.plant(event, blocksSeen, 0.5, schoolColor, member, clock.t);
  }
  return;
}
if (event.kind === "nft") {
  if (event.launcherId && jellies.has(event.launcherId)) return;
  jellies.plant(event, blocksSeen, clock.t);
  return;
}
if (event.kind === "did") turtles.plant(event, blocksSeen, clock.t);
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run web/test/lake-entry.test.ts web/test/lake-shoal.test.ts web/test/lake-jellies.test.ts web/test/lake-turtles.test.ts`
Expected: PASS. Existing tests that call `plant` with the old arity still compile — `bornAt` defaults to `0` — but any that assert an exact scale immediately after planting will now read ~0. Update those to advance the clock past `ENTRY_SECONDS` first rather than deleting the assertion.

- [ ] **Step 8: Run the full suite and commit**

Run: `npm run typecheck && npm run lint && npm test`

```bash
git add web/src/themes/lake/entry.ts web/src/themes/lake/shoal.ts web/src/themes/lake/jellies.ts web/src/themes/lake/turtles.ts web/src/themes/lake/index.ts web/test/
git commit -m "feat(lake): creatures resolve into their band instead of popping in"
```

---

### Task 10: A camera that stops fighting the depth cue

**Files:**

- Create: `web/src/themes/shared/fit.ts` (moved from `board/fit.ts`)
- Create: `web/src/themes/lake/camera.ts`
- Create: `web/test/lake-camera.test.ts`
- Delete: `web/src/themes/board/fit.ts`
- Modify: `web/src/themes/board/board.ts` (or whichever file imports `fit.js` — grep first)
- Modify: `web/test/board-fit.test.ts` (import path only)
- Modify: `web/src/themes/lake/lake.ts:18-19, 33, 100-107`

**Interfaces:**

- Consumes: `MAX_BANDS`, `BAND_STEP`, `RIM_RADIUS`, `PENDING_Y_MAX`, `bandDepth` (Task 1).
- Produces: `frameTarget(bandCount: number, vFovDeg: number, aspect: number): { distance: number; centerY: number }` — pure. `LAKE_FOV = 55` and `ORBIT_RATE = 0.012` exported from `camera.ts`.

- [ ] **Step 1: Move `fit.ts` to shared**

```bash
git mv web/src/themes/board/fit.ts web/src/themes/shared/fit.ts
grep -rn "board/fit.js\|from \"./fit.js\"" web/src web/test
```

Update every hit: importers inside `board/` become `../shared/fit.js`; `web/test/board-fit.test.ts` becomes `../src/themes/shared/fit.js`. Consider renaming that test to `web/test/fit.test.ts` in the same move.

Run: `npx vitest run web/test/` — expected PASS with no behaviour change.

- [ ] **Step 2: Write the failing camera test**

Create `web/test/lake-camera.test.ts`:

```ts
import { expect, test } from "vitest";
import { frameTarget, LAKE_FOV } from "../src/themes/lake/camera.js";
import { MAX_BANDS, RIM_RADIUS, PENDING_Y_MAX, bandDepth } from "../src/themes/lake/layout.js";

const ASPECT = 16 / 9;

test("an empty lake frames the churn layer and the newest bands, not empty water", () => {
  const empty = frameTarget(0, LAKE_FOV, ASPECT);
  const full = frameTarget(MAX_BANDS, LAKE_FOV, ASPECT);
  expect(empty.centerY).toBeGreaterThan(full.centerY);
  expect(empty.distance).toBeLessThanOrEqual(full.distance);
});

test("the camera pulls back as the column fills, monotonically", () => {
  let previous = 0;
  for (let n = 0; n <= MAX_BANDS; n++) {
    const { distance } = frameTarget(n, LAKE_FOV, ASPECT);
    expect(distance).toBeGreaterThanOrEqual(previous);
    previous = distance;
  }
});

test("the framing never pulls the camera inside the rim rings", () => {
  for (let n = 0; n <= MAX_BANDS; n++) {
    expect(frameTarget(n, LAKE_FOV, ASPECT).distance).toBeGreaterThan(RIM_RADIUS);
  }
});

test("the look target stays inside the column", () => {
  for (let n = 0; n <= MAX_BANDS; n++) {
    const { centerY } = frameTarget(n, LAKE_FOV, ASPECT);
    expect(centerY).toBeLessThanOrEqual(PENDING_Y_MAX);
    expect(centerY).toBeGreaterThanOrEqual(bandDepth(MAX_BANDS));
  }
});

test("framing is a pure function of fill depth — it cannot oscillate over time", () => {
  // regression guard on the deleted camera bob: nothing here takes a clock, so
  // the camera cannot move on the axis the theme uses to mean time
  expect(frameTarget(7, LAKE_FOV, ASPECT)).toEqual(frameTarget(7, LAKE_FOV, ASPECT));
});

test("a tall narrow viewport still fits the column", () => {
  const portrait = frameTarget(MAX_BANDS, LAKE_FOV, 0.5);
  const landscape = frameTarget(MAX_BANDS, LAKE_FOV, 2.0);
  expect(portrait.distance).toBeGreaterThanOrEqual(landscape.distance);
});

test("a nonsense band count degrades to the empty framing", () => {
  expect(frameTarget(-5, LAKE_FOV, ASPECT)).toEqual(frameTarget(0, LAKE_FOV, ASPECT));
  expect(Number.isFinite(frameTarget(NaN, LAKE_FOV, ASPECT).distance)).toBe(true);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run web/test/lake-camera.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `camera.ts`**

Create `web/src/themes/lake/camera.ts`:

```ts
import { fitDistance } from "../shared/fit.js";
import { MAX_BANDS, RIM_RADIUS, PENDING_Y_MAX, bandDepth } from "./layout.js";

/**
 * Narrower than the 84° the lake shipped with. The wide FOV existed so a camera
 * parked at the column midpoint caught both the surface and the bed at once;
 * with eighteen thicker bands and adaptive framing it no longer has to, and 84°
 * was costing heavy edge distortion on every creature.
 */
export const LAKE_FOV = 55;

/** Slower than the 0.02 rad/s the lake shipped with: ~8.7 min per revolution. */
export const ORBIT_RATE = 0.012;

/** Never inside the rim rings — the camera would clip straight through them. */
const MIN_DISTANCE = RIM_RADIUS + 8;

/**
 * Where the camera should stand to frame everything that currently exists:
 * the churn layer at the top down to the deepest occupied band. An empty lake
 * frames the shallows; a full one pulls back to the whole column. This is the
 * lever `mine.ts` pulls when it eases `camDist` toward the spiral's extent.
 *
 * Pure, and deliberately takes no clock. The theme communicates through
 * vertical position — the whole lake glides down one band per block — so a
 * camera that also moved vertically over time would cancel the one cue the
 * theme is built on. The shipped camera did exactly that with a ±2.2-unit,
 * 125-second sine; it is gone, and this signature is what keeps it gone.
 */
export function frameTarget(
  bandCount: number,
  vFovDeg: number,
  aspect: number
): { distance: number; centerY: number } {
  const filled = Number.isFinite(bandCount)
    ? Math.max(0, Math.min(MAX_BANDS, Math.floor(bandCount)))
    : 0;
  const top = PENDING_Y_MAX;
  const bottom = bandDepth(filled);
  const contentH = top - bottom;
  const contentW = RIM_RADIUS * 2;
  const distance = Math.max(MIN_DISTANCE, fitDistance(contentW, contentH, vFovDeg, aspect));
  return { distance, centerY: (top + bottom) / 2 };
}
```

- [ ] **Step 5: Rework the camera in `lake.ts`**

Delete the `CAM_Y` and `CAM_RADIUS` constants on lines 18–19 along with their doc comment, and add to the imports at the top of the file:

```ts
import { LAKE_FOV, ORBIT_RATE, frameTarget } from "./camera.js";
import { MAX_BANDS, easeBlocks } from "./layout.js";
```

Inside `startLake`, alongside the `blocksSeen` / `blocksSmooth` declarations, add the eased camera state:

```ts
// Eased camera state. Neither is a function of time — see frameTarget.
let camDistance = 0;
let camCenterY = 0;
```

Replace the camera construction on line 33:

```ts
const camera = new THREE.PerspectiveCamera(LAKE_FOV, innerWidth / innerHeight, 0.1, 400);
```

Replace the camera block in `frame()` (lines 100–107):

```ts
const target = frameTarget(Math.min(blocksSeen, MAX_BANDS), LAKE_FOV, camera.aspect);
// ease at the same rate the bands sink, so framing and sinking read as one
// motion rather than two systems arguing
const k = 1 - Math.exp(-dt * 0.8);
camDistance += (target.distance - camDistance) * k;
camCenterY += (target.centerY - camCenterY) * k;

const angle = (reducedMotion ? 0.6 : t * ORBIT_RATE) + orbit.getOffset();
camera.position.set(Math.cos(angle) * camDistance, camCenterY, Math.sin(angle) * camDistance);
camera.lookAt(0, camCenterY, 0);
```

Initialize both from the empty framing so the first frame does not sweep in from the origin — right after the camera is constructed:

```ts
{
  const initial = frameTarget(0, LAKE_FOV, camera.aspect);
  camDistance = initial.distance;
  camCenterY = initial.centerY;
}
```

`TOP_BAND_Y` and `BED_Y` were imported only for `CAM_Y`, so the import edit above drops them. Confirm nothing else in the file still references them.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run web/test/lake-camera.test.ts && npm run typecheck && npm run lint && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/themes/shared/fit.ts web/src/themes/lake/camera.ts web/src/themes/lake/lake.ts web/src/themes/board/ web/test/
git commit -m "feat(lake): adaptive framing, narrower FOV, no vertical bob"
```

---

### Task 11: Wire it together and quiet the scene

The last task: everything built above becomes visible, the bubbles stop lying about the mempool, and the ambient motion comes down so the block beat has silence to land in.

**Files:**

- Modify: `web/src/themes/lake/index.ts`
- Modify: `web/src/themes/lake/vfx.ts:105-108, 132-135, 155-164`
- Modify: `web/src/themes/lake/motion.ts:4-5`
- Modify: `web/src/themes/lake/shoal.ts:10`
- Modify: `web/src/style.css`
- Modify: `web/test/lake-vfx.test.ts`, `web/test/lake-motion.test.ts`

**Interfaces:**

- Consumes: everything from Tasks 1–10.
- Produces: the finished theme.

- [ ] **Step 1: Demote the bubbles**

The mempool now lives in `pending.ts`. In `web/src/themes/lake/vfx.ts`, delete `setMempool()` and `bubbleCount()`, and set a fixed scenery density in the constructor after the bubble geometry is built:

```ts
// Bubbles are scenery now, not data — the mempool moved to the churn layer
// under the surface, where pending work belongs. A steady low density keeps
// the bed from reading as dead water.
this.litCount = Math.round(BUBBLE_CAP * 0.22);
```

Update `web/test/lake-vfx.test.ts`: delete the `setMempool` tests and replace them with one asserting the bubbles run at a fixed nonzero density and rise-and-wrap still works. Keep every beacon and predator test unchanged.

- [ ] **Step 2: Quiet the wander**

In `web/src/themes/lake/motion.ts`:

```ts
const WANDER_RADIUS = 0.9;
const WANDER_SWAY = 0.18;
```

`web/test/lake-motion.test.ts` may assert on wander magnitude — update any such bound to derive from the constants rather than restating a literal, or widen it to an inequality.

- [ ] **Step 3: Lower the fish cap**

In `web/src/themes/lake/shoal.ts`:

```ts
// 18 bands rather than 40 means a smaller standing population; a cap far above
// it only delays pool wrap without ever being reached.
const DEFAULT_CAP = 500;
```

- [ ] **Step 4: Wire the theme**

Rewrite the body of `start()` in `web/src/themes/lake/index.ts` to construct and drive the new systems. The sprout handler keeps the Task 9 form; these are the other changes:

```ts
const bands = new Bands(runtime.scene);
const pending = new Pending(runtime.scene);
const strip = createLakeStrip(document.getElementById("lake-strip")!);
```

```ts
runtime.setBlockHandler((event, blocksSeen) => {
  bands.push(event, blocksSeen);
  pending.release(event.spendCount, clock.t);
  runtime.water.ripple(clock.t);
});
runtime.setAmbientHandler((event) => {
  pending.setMempool(event.mempoolSize, event.mempoolCost);
  strip.setMempool(event.mempoolSize);
  strip.setNetspace(event.netspace);
});
runtime.setReorgHandler((forkHeight) => {
  xchFish.clearAbove(forkHeight);
  catFish.clearAbove(forkHeight);
  jellies.clearAbove(forkHeight);
  turtles.clearAbove(forkHeight);
  bands.clearAbove(forkHeight);
  vfx.strike(clock.t);
});
```

```ts
runtime.setUpdateHandler((dt, t, blocksSeen) => {
  clock.t = t;
  bands.update(blocksSeen, runtime.camera);
  pending.update(dt, t);
  xchFish.update(t, blocksSeen);
  catFish.update(t, blocksSeen);
  jellies.update(runtime.camera, t, blocksSeen);
  turtles.update(dt, t, blocksSeen);
  vfx.update(dt, t);
  for (const fn of frameCallbacks) fn();
});
```

`mempoolCost` is a `number` on `AmbientEvent` — confirm against `shared/src/index.ts` and coerce at the call site if it is a string, rather than loosening `churnRate`'s signature.

Leave `pickables()`, `metaFor()` and `setHovered()` exactly as they are. The pending silhouettes are deliberately not pickable — they are not events and have no `SproutEvent` to show.

- [ ] **Step 5: Rewrite the legend**

The legend still promises bubbles mean mempool. Replace the array in `web/src/themes/lake/index.ts:16-25`:

```ts
  legend: [
    ["sw-fish", "fish — XCH spend (size = amount)"],
    ["sw-school", "school — CAT (color = asset)"],
    ["sw-jelly", "jellyfish — NFT (clickable)"],
    ["sw-turtle", "turtle — DID"],
    ["sw-pending", "shoal near the surface — mempool"],
    ["sw-rim", "ring — one block (bright = busy)"],
    ["sw-shaft", "light shafts — netspace"],
    ["sw-reorg", "strike — reorg"],
  ],
```

In `web/src/style.css`, add `.sw-pending` and `.sw-rim` alongside the existing lake swatches (around lines 329–362), following the same pattern those rules use, and delete `.sw-bubble` and `.sw-ripple` if nothing else references them.

- [ ] **Step 6: Verify the whole suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS.

- [ ] **Step 7: Verify in the browser**

Run: `npm run dev:web` and open `http://localhost:5173/?theme=lake&demo=1`.

Check, and report what you actually see rather than asserting success:

1. Rings are visible and countable, with block heights on the newest few.
2. On each block, silhouettes near the surface sink and creatures resolve into the new band.
3. The camera pulls back as the column fills and does **not** bob vertically.
4. The mempool/netspace strip updates.
5. Console has no errors and no shader compilation warnings.

- [ ] **Step 8: Commit**

```bash
git add web/src/themes/lake/ web/src/style.css web/test/
git commit -m "feat(lake): wire bands, churn layer and strip; quiet the ambient motion"
```

---

## Self-Review Notes

Spec coverage, section by section:

| Spec section                     | Task                                                    |
| -------------------------------- | ------------------------------------------------------- |
| 1 — mempool moves to the surface | 7 (layer), 11 (bubbles demoted, wiring)                 |
| 2 — block becomes a descent      | 4 (plumbing), 8 (release), 9 (entry animation)          |
| 3 — bands become visible objects | 1 (constants), 5 (rings), 6 (labels); reorg in 5 and 11 |
| 3 — rejected variable thickness  | Honoured: `bandDepth` is untouched in every task        |
| 4 — camera                       | 10                                                      |
| 5 — mempool/netspace strip       | 2 (gauges), 3 (strip), 11 (wiring)                      |
| 6 — quieting                     | 11                                                      |
| Enabling fact (event ordering)   | 4, step 1                                               |

Deferred by design: the spec's `lake-shoal.test.ts` entry-envelope test lives in Task 9; the spec's `lake-layout.test.ts` extension lives in Task 1.
