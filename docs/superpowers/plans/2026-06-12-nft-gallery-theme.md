# NFT Art Gallery Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third visualization theme, `gallery`, that hangs freshly-minted NFTs as framed art on a dark salon wall; the camera pans across the wall and flies in to frame a clicked piece with a museum placard of its transaction details.

**Architecture:** A new `web/src/themes/gallery/` theme implementing the existing `Visualization` interface, registered alongside `grove` and `farm`. Pure logic (salon layout, hang predicate, reorg removal, netspace→light, camera framing, placard model) lives in small unit-tested modules; Three.js rendering and DOM are thin shells around that logic. The gallery manages its own pointer input (the shared canvas picker is gated off for it).

**Tech Stack:** TypeScript, Three.js, Vite, Vitest. Node ≥ 24. Tests run in the default node environment (no DOM) — Three.js classes are tested by passing bare `THREE.Texture()`/`THREE.Scene()`, mirroring `web/test/crops.test.ts`.

**Spec:** `docs/superpowers/specs/2026-06-12-nft-gallery-theme-design.md`

---

## File map

| File | Responsibility | Tested |
| --- | --- | --- |
| `web/src/themes/types.ts` (modify) | Make picker methods optional, add `selfManagedInput` | typecheck |
| `web/src/ui/picker.ts` (modify) | Guard now-optional handle methods | typecheck |
| `web/src/main.ts` (modify) | Gate `attachPicker` on `selfManagedInput` | typecheck |
| `web/src/themes/gallery/ambience.ts` | `netspaceLight(bytes)` pure mapping | ✅ unit |
| `web/src/themes/gallery/layout.ts` | Salon hang slots + frame sizing (pure) | ✅ unit |
| `web/src/themes/gallery/select.ts` | `shouldHang(event)` predicate (pure) | ✅ unit |
| `web/src/themes/gallery/camera.ts` | `framePiece`, `panEye` framing math (pure) | ✅ unit |
| `web/src/themes/gallery/label.ts` | `placardModel(event)` (pure) + DOM placard shell | ✅ unit (model) |
| `web/src/themes/gallery/palette.ts` | Dark-contemporary colors (data) | — |
| `web/src/themes/gallery/pieces.ts` | Framed-piece pool: add/wrap/removeRecent/pick/hover | ✅ unit |
| `web/src/themes/gallery/wall.ts` | Wall + floor + backdrop (rendering shell) | typecheck/build |
| `web/src/themes/gallery/gallery.ts` | Renderer, lighting, camera state machine, input, dispatch | typecheck/build |
| `web/src/themes/gallery/index.ts` | `Visualization` object | ✅ unit (registry) |
| `web/src/themes/index.ts` (modify) | Register `gallery` in `THEMES` | ✅ unit |
| `web/src/net/demo-art.ts` | `demoNftImage(seed)` deterministic SVG data URI | ✅ unit |
| `web/src/net/demo.ts` (modify) | Assign `imageUrl` to demo NFT events | ✅ unit (via demo-art) |
| `web/src/style.css` (modify) | Placard + legend swatch styles | build/manual |

Commands (run from repo root): `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`. Single test file: `npx vitest run web/test/<file>.test.ts`.

---

## Task 1: Generalize the Visualization interface for self-managed input

**Files:**
- Modify: `web/src/themes/types.ts`
- Modify: `web/src/ui/picker.ts:12-25`
- Modify: `web/src/main.ts`

- [ ] **Step 1: Make picker methods optional and add the flag**

Edit `web/src/themes/types.ts` so `VisualizationHandle` reads:

```ts
import type * as THREE from "three";
import type { SproutEvent } from "@grove/shared";
import type { GroveFeed } from "../net/feed.js";

/** What the shared UI (picker, detail card) needs from a running scene. */
export interface VisualizationHandle {
  camera: THREE.PerspectiveCamera;
  onFrame(fn: () => void): void;
  /** When true, main.ts skips the shared canvas picker; the theme wires its own input. */
  selfManagedInput?: boolean;
  pickables?(): THREE.Object3D[];
  metaFor?(object: THREE.Object3D, instanceId: number | undefined): SproutEvent | null;
  setHovered?(object: THREE.Object3D | null, instanceId: number | undefined): void;
}

export interface Visualization {
  id: string;
  label: string;
  legend: ReadonlyArray<readonly [swatchClass: string, label: string]>;
  start(canvas: HTMLCanvasElement, feed: GroveFeed): VisualizationHandle;
}
```

- [ ] **Step 2: Guard the now-optional methods in the picker**

In `web/src/ui/picker.ts`, replace the body of `intersect` (lines 16-25) so the optional methods are called safely:

```ts
  function intersect(eventX: number, eventY: number): Hit | null {
    pointer.set((eventX / innerWidth) * 2 - 1, -(eventY / innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointer, viz.camera);
    const hits = raycaster.intersectObjects(viz.pickables?.() ?? [], false);
    for (const hit of hits) {
      const meta = viz.metaFor?.(hit.object, hit.instanceId) ?? null;
      if (meta) return { object: hit.object, instanceId: hit.instanceId, meta };
    }
    return null;
  }
```

And in the frame callback (around line 77) guard `setHovered`:

```ts
    viz.setHovered?.(hit?.object ?? null, hit?.instanceId);
```

- [ ] **Step 3: Gate the picker in main.ts**

In `web/src/main.ts`, change the line `attachPicker(canvas, handle);` to:

```ts
if (!handle.selfManagedInput) attachPicker(canvas, handle);
```

- [ ] **Step 4: Verify typecheck and existing tests pass**

Run: `npm run typecheck && npx vitest run web/test/themes.test.ts`
Expected: typecheck clean; themes test PASS (grove/farm unchanged).

- [ ] **Step 5: Commit**

```bash
git add web/src/themes/types.ts web/src/ui/picker.ts web/src/main.ts
git commit -m "Allow themes to self-manage pointer input"
```

---

## Task 2: ambience.ts — netspace → light intensity (pure, TDD)

**Files:**
- Create: `web/src/themes/gallery/ambience.ts`
- Test: `web/test/gallery-ambience.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/test/gallery-ambience.test.ts`:

```ts
import { expect, test } from "vitest";
import { netspaceLight } from "../src/themes/gallery/ambience.js";

const eib = (n: number) => String(BigInt(Math.round(n * 1024)) << 50n);

test("brighter with more netspace, monotonic", () => {
  expect(netspaceLight(eib(20))).toBeGreaterThan(netspaceLight(eib(10)));
  expect(netspaceLight(eib(40))).toBeGreaterThan(netspaceLight(eib(20)));
});

test("clamped to a sane range", () => {
  expect(netspaceLight(eib(0))).toBeGreaterThanOrEqual(0.6);
  expect(netspaceLight(eib(10000))).toBeLessThanOrEqual(1.15);
});

test("invalid input does not throw and stays in range", () => {
  const v = netspaceLight("not-a-number");
  expect(v).toBeGreaterThanOrEqual(0.6);
  expect(v).toBeLessThanOrEqual(1.15);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/test/gallery-ambience.test.ts`
Expected: FAIL — cannot find module `ambience.js`.

- [ ] **Step 3: Write minimal implementation**

Create `web/src/themes/gallery/ambience.ts`:

```ts
import { safeBigInt } from "../shared/util.js";

/**
 * Netspace (bytes, string) → gallery light intensity multiplier. Mirrors the
 * EiB mapping in grove/sky.ts so the room brightens as the network grows.
 * Clamped to [0.6, 1.15] so the gallery is never pitch-black or blown out.
 */
export function netspaceLight(bytes: string): number {
  const eib = Number(safeBigInt(bytes) >> 50n) / 1024;
  return Math.min(1.15, Math.max(0.6, 0.6 + (eib - 10) * 0.015));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run web/test/gallery-ambience.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/themes/gallery/ambience.ts web/test/gallery-ambience.test.ts
git commit -m "Add gallery netspace-to-light mapping"
```

---

## Task 3: layout.ts — salon hang slots + frame sizing (pure, TDD)

**Files:**
- Create: `web/src/themes/gallery/layout.ts`
- Test: `web/test/gallery-layout.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/test/gallery-layout.test.ts`:

```ts
import { expect, test } from "vitest";
import { WALL, hangSlot, frameSize } from "../src/themes/gallery/layout.js";

test("pieces advance rightward by a fixed step", () => {
  expect(hangSlot(1).x - hangSlot(0).x).toBeCloseTo(WALL.step);
  expect(hangSlot(5).x).toBeGreaterThan(hangSlot(4).x);
});

test("slots alternate between two salon bands and stay on the wall plane", () => {
  expect(hangSlot(0).y).toBeGreaterThan(hangSlot(1).y); // even = high band, odd = low band
  expect(hangSlot(0).z).toBe(WALL.z);
  for (let i = 0; i < 20; i++) {
    expect(hangSlot(i).y).toBeGreaterThan(0);
    expect(hangSlot(i).y).toBeLessThan(WALL.bandHigh + WALL.yJitter);
  }
});

test("hangSlot is deterministic per index", () => {
  expect(hangSlot(7)).toEqual(hangSlot(7));
});

test("frame sizing respects aspect and clamps the long edge", () => {
  const landscape = frameSize(3, 2); // wide
  expect(landscape.w / landscape.h).toBeCloseTo(2);
  expect(landscape.w).toBeLessThanOrEqual(WALL.maxW);
  const portrait = frameSize(3, 0.5); // tall
  expect(portrait.w / portrait.h).toBeCloseTo(0.5);
  expect(portrait.h).toBeLessThanOrEqual(WALL.maxW);
  expect(portrait.h).toBeGreaterThanOrEqual(WALL.minW);
  expect(frameSize(4, 1)).toEqual(frameSize(4, 1)); // deterministic
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/test/gallery-layout.test.ts`
Expected: FAIL — cannot find module `layout.js`.

- [ ] **Step 3: Write minimal implementation**

Create `web/src/themes/gallery/layout.ts`:

```ts
import { mulberry32 } from "../shared/util.js";

export const WALL = {
  step: 4.2, // x distance between consecutive pieces
  z: -3, // wall plane z (pieces face +z toward the camera)
  bandHigh: 3.6, // y center of the upper salon band
  bandLow: 1.7, // y center of the lower salon band
  yJitter: 0.45, // per-piece vertical wobble
  baseLong: 2.4, // base length of a frame's long edge
  longJitter: 0.7, // +/- variation on the long edge
  minW: 1.4,
  maxW: 3.4,
};

export interface Slot {
  x: number;
  y: number;
  z: number;
}

/** Deterministic salon position for the piece at `index` (advances rightward). */
export function hangSlot(index: number): Slot {
  const rng = mulberry32((index * 2654435761) >>> 0);
  const band = index % 2 === 0 ? WALL.bandHigh : WALL.bandLow;
  return { x: index * WALL.step, y: band + (rng() - 0.5) * WALL.yJitter, z: WALL.z };
}

/** Frame width/height for a piece, fitting `aspect` (= imageW/imageH) within bounds. */
export function frameSize(index: number, aspect: number): { w: number; h: number } {
  const rng = mulberry32((index * 40503 + 7) >>> 0);
  const long = Math.max(
    WALL.minW,
    Math.min(WALL.maxW, WALL.baseLong + (rng() - 0.5) * 2 * WALL.longJitter)
  );
  return aspect >= 1 ? { w: long, h: long / aspect } : { w: long * aspect, h: long };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run web/test/gallery-layout.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/themes/gallery/layout.ts web/test/gallery-layout.test.ts
git commit -m "Add gallery salon layout math"
```

---

## Task 4: select.ts — shouldHang predicate (pure, TDD)

**Files:**
- Create: `web/src/themes/gallery/select.ts`
- Test: `web/test/gallery-select.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/test/gallery-select.test.ts`:

```ts
import { expect, test } from "vitest";
import type { SproutEvent } from "@grove/shared";
import { shouldHang } from "../src/themes/gallery/select.js";

const sprout = (over: Partial<SproutEvent>): SproutEvent => ({
  type: "sprout",
  kind: "nft",
  height: 1,
  coinId: "ab".repeat(32),
  amount: "1000000000000",
  mint: true,
  imageUrl: "https://example.test/a.png",
  ...over,
});

test("hangs minted NFTs that carry an image", () => {
  expect(shouldHang(sprout({}))).toBe(true);
});

test("skips non-mint NFTs", () => {
  expect(shouldHang(sprout({ mint: false }))).toBe(false);
  expect(shouldHang(sprout({ mint: undefined }))).toBe(false);
});

test("skips NFTs without a usable image", () => {
  expect(shouldHang(sprout({ imageUrl: undefined }))).toBe(false);
  expect(shouldHang(sprout({ imageUrl: "" }))).toBe(false);
});

test("skips non-NFT kinds", () => {
  expect(shouldHang(sprout({ kind: "xch" }))).toBe(false);
  expect(shouldHang(sprout({ kind: "cat" }))).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/test/gallery-select.test.ts`
Expected: FAIL — cannot find module `select.js`.

- [ ] **Step 3: Write minimal implementation**

Create `web/src/themes/gallery/select.ts`:

```ts
import type { SproutEvent } from "@grove/shared";

/** Only freshly-minted NFTs that carry a usable image hang on the wall. */
export function shouldHang(event: SproutEvent): boolean {
  return event.kind === "nft" && event.mint === true && !!event.imageUrl;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run web/test/gallery-select.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/themes/gallery/select.ts web/test/gallery-select.test.ts
git commit -m "Add gallery hang predicate"
```

---

## Task 5: camera.ts — framing math (pure, TDD)

**Files:**
- Create: `web/src/themes/gallery/camera.ts`
- Test: `web/test/gallery-camera.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/test/gallery-camera.test.ts`:

```ts
import * as THREE from "three";
import { expect, test } from "vitest";
import { framePiece, panEye } from "../src/themes/gallery/camera.js";

test("framing stands in front of the piece, looking at its center", () => {
  const center = new THREE.Vector3(8, 2.5, -3);
  const f = framePiece(center, 2.4, 45);
  expect(f.target.equals(center)).toBe(true);
  expect(f.eye.z).toBeGreaterThan(center.z); // camera is in front of the wall
  expect(f.eye.x).toBeCloseTo(center.x);
  expect(f.eye.y).toBeCloseTo(center.y);
});

test("taller pieces are framed from farther away", () => {
  const c = new THREE.Vector3(0, 2.5, -3);
  expect(framePiece(c, 3.2, 45).eye.z).toBeGreaterThan(framePiece(c, 1.6, 45).eye.z);
});

test("pan eye tracks the newest piece x at the resting standoff", () => {
  const e = panEye(40, 2.6, 9);
  expect(e.x).toBe(40);
  expect(e.y).toBe(2.6);
  expect(e.z).toBe(9);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/test/gallery-camera.test.ts`
Expected: FAIL — cannot find module `camera.js`.

- [ ] **Step 3: Write minimal implementation**

Create `web/src/themes/gallery/camera.ts`:

```ts
import * as THREE from "three";

export interface Framing {
  eye: THREE.Vector3;
  target: THREE.Vector3;
}

/**
 * Camera pose that frames a single piece: directly in front of it (toward +z,
 * the viewer side of the wall) at the distance that fits its height in the
 * vertical FOV, with a little margin.
 */
export function framePiece(
  center: THREE.Vector3,
  height: number,
  fovDeg: number,
  margin = 1.3
): Framing {
  const fov = (fovDeg * Math.PI) / 180;
  const dist = (height * margin) / (2 * Math.tan(fov / 2));
  return { eye: new THREE.Vector3(center.x, center.y, center.z + dist), target: center.clone() };
}

/** Resting camera pose while panning: centered on the newest piece's x. */
export function panEye(newestX: number, restY: number, restZ: number): THREE.Vector3 {
  return new THREE.Vector3(newestX, restY, restZ);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run web/test/gallery-camera.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/themes/gallery/camera.ts web/test/gallery-camera.test.ts
git commit -m "Add gallery camera framing math"
```

---

## Task 6: label.ts — placard model (pure, TDD) + DOM shell

**Files:**
- Create: `web/src/themes/gallery/label.ts`
- Test: `web/test/gallery-label.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/test/gallery-label.test.ts`:

```ts
import { expect, test } from "vitest";
import type { SproutEvent } from "@grove/shared";
import { placardModel } from "../src/themes/gallery/label.js";

const base: SproutEvent = {
  type: "sprout",
  kind: "nft",
  height: 8853512,
  coinId: "ab".repeat(32),
  amount: "1500000000000",
  mint: true,
  imageUrl: "https://example.test/a.png",
  launcherId: "cd".repeat(32),
  nftId: "nft1abcdef",
};

test("placard summarizes the mint and its amount/block", () => {
  const m = placardModel(base);
  expect(m.title).toBe("NFT mint");
  expect(m.meta).toBe("1.5 XCH · block 8853512");
  expect(m.coin).toMatch(/^coin ab/);
});

test("links point at spacescan and mintgarden", () => {
  const m = placardModel(base);
  expect(m.links).toContainEqual({
    label: "view on spacescan ↗",
    href: `https://www.spacescan.io/coin/0x${base.coinId}`,
  });
  expect(m.links).toContainEqual({
    label: "view on mintgarden ↗",
    href: "https://mintgarden.io/nfts/nft1abcdef",
  });
});

test("launcher line omitted when absent, mintgarden link omitted without nftId", () => {
  const m = placardModel({ ...base, launcherId: undefined, nftId: undefined });
  expect(m.launcher).toBeNull();
  expect(m.links.some((l) => l.href.includes("mintgarden"))).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/test/gallery-label.test.ts`
Expected: FAIL — cannot find module `label.js`.

- [ ] **Step 3: Write minimal implementation**

Create `web/src/themes/gallery/label.ts`:

```ts
import type { SproutEvent } from "@grove/shared";
import { mojosToXch, shortHex } from "../../ui/format.js";

export interface PlacardLink {
  label: string;
  href: string;
}

export interface Placard {
  title: string;
  meta: string;
  coin: string;
  launcher: string | null;
  links: PlacardLink[];
}

/** Pure placard content for a focused piece (DOM-free, unit-tested). */
export function placardModel(event: SproutEvent): Placard {
  const links: PlacardLink[] = [
    { label: "view on spacescan ↗", href: `https://www.spacescan.io/coin/0x${event.coinId}` },
  ];
  if (event.nftId) {
    links.push({ label: "view on mintgarden ↗", href: `https://mintgarden.io/nfts/${event.nftId}` });
  }
  return {
    title: "NFT mint",
    meta: `${mojosToXch(event.amount)} XCH · block ${event.height}`,
    coin: `coin ${shortHex(event.coinId)}`,
    launcher: event.launcherId ? `launcher ${shortHex(event.launcherId)}` : null,
    links,
  };
}

/** A theme-owned DOM placard; created once, shown/hidden as pieces gain focus. */
export class Placard$ {
  private el: HTMLDivElement;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "gallery-label";
    this.el.hidden = true;
    document.body.appendChild(this.el);
  }

  show(event: SproutEvent): void {
    const model = placardModel(event);
    this.el.replaceChildren();
    const h = document.createElement("h3");
    h.textContent = model.title;
    this.el.appendChild(h);
    for (const line of [model.meta, model.coin, model.launcher]) {
      if (!line) continue;
      const d = document.createElement("div");
      d.className = line === model.meta ? "" : "dim";
      d.textContent = line;
      this.el.appendChild(d);
    }
    for (const link of model.links) {
      const wrap = document.createElement("div");
      const a = document.createElement("a");
      a.href = link.href;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = link.label;
      wrap.appendChild(a);
      this.el.appendChild(wrap);
    }
    this.el.hidden = false;
    this.el.classList.add("visible");
  }

  hide(): void {
    this.el.classList.remove("visible");
    this.el.hidden = true;
  }

  dispose(): void {
    this.el.remove();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run web/test/gallery-label.test.ts && npm run typecheck`
Expected: PASS (3 tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add web/src/themes/gallery/label.ts web/test/gallery-label.test.ts
git commit -m "Add gallery placard model and DOM shell"
```

---

## Task 7: palette.ts + pieces.ts — the framed-piece pool (TDD)

**Files:**
- Create: `web/src/themes/gallery/palette.ts`
- Create: `web/src/themes/gallery/pieces.ts`
- Test: `web/test/gallery-pieces.test.ts`

- [ ] **Step 1: Write palette.ts (data, no test)**

Create `web/src/themes/gallery/palette.ts`:

```ts
export const GALLERY = {
  wallTop: 0x14161c,
  wallBottom: 0x090a0d,
  floor: 0x0b0c10,
  backdrop: 0x05060a,
  frame: 0x26282f,
  frameHover: 0x4a4d57,
  mat: 0x101218, // inner mat behind the image
  spot: 0xffe9c2, // warm picture-light
  fill: 0x2a3650, // cool ambient fill
};
```

- [ ] **Step 2: Write the failing test**

Create `web/test/gallery-pieces.test.ts`:

```ts
import * as THREE from "three";
import { expect, test } from "vitest";
import type { SproutEvent } from "@grove/shared";
import { Pieces } from "../src/themes/gallery/pieces.js";

const mint = (coinId: string, height = 1): SproutEvent => ({
  type: "sprout",
  kind: "nft",
  height,
  coinId,
  amount: "1000000000000",
  mint: true,
  imageUrl: "https://example.test/" + coinId + ".png",
});

const id = (n: number) => n.toString(16).padStart(8, "0") + "00".repeat(28);

test("each add hangs a pickable piece carrying its event meta", () => {
  const pieces = new Pieces(new THREE.Scene(), 28);
  pieces.add(mint(id(1)), new THREE.Texture());
  expect(pieces.count()).toBe(1);
  const obj = pieces.pickables()[0];
  expect(pieces.metaFor(obj)?.coinId).toBe(id(1));
});

test("pool wraps at the cap, overwriting the oldest", () => {
  const pieces = new Pieces(new THREE.Scene(), 4);
  for (let i = 0; i < 6; i++) pieces.add(mint(id(i)), new THREE.Texture());
  expect(pieces.count()).toBe(4);
});

test("removeRecent drops pieces at or above the fork height", () => {
  const pieces = new Pieces(new THREE.Scene(), 28);
  pieces.add(mint(id(1), 10), new THREE.Texture());
  pieces.add(mint(id(2), 11), new THREE.Texture());
  pieces.add(mint(id(3), 12), new THREE.Texture());
  expect(pieces.removeRecent(11)).toBe(2); // heights 11 and 12 removed
  expect(pieces.count()).toBe(1);
});

test("newestX advances rightward as pieces are added", () => {
  const pieces = new Pieces(new THREE.Scene(), 28);
  pieces.add(mint(id(1)), new THREE.Texture());
  const first = pieces.newestX();
  pieces.add(mint(id(2)), new THREE.Texture());
  expect(pieces.newestX()).toBeGreaterThan(first);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run web/test/gallery-pieces.test.ts`
Expected: FAIL — cannot find module `pieces.js`.

- [ ] **Step 4: Write pieces.ts**

Create `web/src/themes/gallery/pieces.ts`:

```ts
import * as THREE from "three";
import type { SproutEvent } from "@grove/shared";
import { GALLERY } from "./palette.js";
import { WALL, hangSlot, frameSize } from "./layout.js";

interface Piece {
  group: THREE.Group;
  image: THREE.Mesh;
  frame: THREE.Mesh;
  event: SproutEvent;
  bornAt: number;
}

const FRAME_DEPTH = 0.12;
const BORDER = 0.18;

/** Pool of framed art pieces hung along the wall; slots wrap at `cap`. */
export class Pieces {
  private slots: Array<Piece | null>;
  private byObject = new Map<THREE.Object3D, number>();
  private next = 0; // total pieces ever added (also the hangSlot index)
  private hovered: number | null = null;
  private frameMat: THREE.MeshStandardMaterial;
  private frameHoverMat: THREE.MeshStandardMaterial;

  constructor(
    private scene: THREE.Scene,
    private cap = 28
  ) {
    this.slots = new Array(cap).fill(null);
    this.frameMat = new THREE.MeshStandardMaterial({ color: GALLERY.frame, roughness: 0.6 });
    this.frameHoverMat = new THREE.MeshStandardMaterial({
      color: GALLERY.frameHover,
      emissive: GALLERY.spot,
      emissiveIntensity: 0.25,
      roughness: 0.5,
    });
  }

  add(event: SproutEvent, texture: THREE.Texture): void {
    const index = this.next++;
    const slotId = index % this.cap;
    this.retire(slotId);

    const img = texture.image as { width?: number; height?: number } | undefined;
    const aspect = img && img.width && img.height ? img.width / img.height : 1;
    const { w, h } = frameSize(index, aspect);
    const pos = hangSlot(index);

    const group = new THREE.Group();
    group.position.set(pos.x, pos.y, pos.z);

    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(w + BORDER * 2, h + BORDER * 2, FRAME_DEPTH),
      this.frameMat
    );
    const image = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })
    );
    image.position.z = FRAME_DEPTH / 2 + 0.001;
    group.add(frame, image);
    this.scene.add(group);

    const piece: Piece = { group, image, frame, event, bornAt: -1 };
    this.slots[slotId] = piece;
    this.byObject.set(frame, slotId);
    this.byObject.set(image, slotId);
  }

  private retire(slotId: number): void {
    const old = this.slots[slotId];
    if (!old) return;
    this.byObject.delete(old.frame);
    this.byObject.delete(old.image);
    this.scene.remove(old.group);
    old.frame.geometry.dispose();
    old.image.geometry.dispose();
    const mat = old.image.material as THREE.MeshBasicMaterial;
    mat.map?.dispose();
    mat.dispose();
    this.slots[slotId] = null;
  }

  /** Remove pieces minted at or above the fork height (those spends were undone). */
  removeRecent(forkHeight: number): number {
    let removed = 0;
    for (let i = 0; i < this.cap; i++) {
      const piece = this.slots[i];
      if (piece && piece.event.height >= forkHeight) {
        this.retire(i);
        removed++;
      }
    }
    return removed;
  }

  count(): number {
    return this.slots.reduce((n, s) => n + (s ? 1 : 0), 0);
  }

  newestX(): number {
    return hangSlot(Math.max(0, this.next - 1)).x;
  }

  pickables(): THREE.Object3D[] {
    return [...this.byObject.keys()];
  }

  metaFor(object: THREE.Object3D): SproutEvent | null {
    const slotId = this.byObject.get(object);
    return slotId === undefined ? null : (this.slots[slotId]?.event ?? null);
  }

  /** Where to fly the camera to frame a clicked piece. */
  focusOf(object: THREE.Object3D): { center: THREE.Vector3; height: number } | null {
    const slotId = this.byObject.get(object);
    if (slotId === undefined) return null;
    const piece = this.slots[slotId];
    if (!piece) return null;
    const geo = piece.image.geometry as THREE.PlaneGeometry;
    const height = geo.parameters.height;
    return { center: piece.group.position.clone(), height };
  }

  setHovered(object: THREE.Object3D | null): void {
    const slotId = object ? (this.byObject.get(object) ?? null) : null;
    if (slotId === this.hovered) return;
    if (this.hovered !== null && this.slots[this.hovered]) {
      this.slots[this.hovered]!.frame.material = this.frameMat;
    }
    this.hovered = slotId;
    if (slotId !== null && this.slots[slotId]) {
      this.slots[slotId]!.frame.material = this.frameHoverMat;
    }
  }

  /** Arrival "new" pulse on freshly-added pieces. */
  update(t: number): void {
    for (const piece of this.slots) {
      if (!piece) continue;
      if (piece.bornAt < 0) piece.bornAt = t;
      const age = t - piece.bornAt;
      const pulse = age < 1 ? 1 + (1 - age) * 0.12 : 1;
      piece.group.scale.setScalar(pulse);
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run web/test/gallery-pieces.test.ts && npm run typecheck`
Expected: PASS (4 tests); typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/themes/gallery/palette.ts web/src/themes/gallery/pieces.ts web/test/gallery-pieces.test.ts
git commit -m "Add gallery framed-piece pool"
```

---

## Task 8: wall.ts — wall, floor, backdrop (rendering shell)

**Files:**
- Create: `web/src/themes/gallery/wall.ts`

- [ ] **Step 1: Write wall.ts**

Create `web/src/themes/gallery/wall.ts`:

```ts
import * as THREE from "three";
import { GALLERY } from "./palette.js";
import { WALL } from "./layout.js";

/**
 * The salon backdrop: a long dark wall behind the pieces, a glossy floor that
 * catches the picture-lights, and a far backdrop. Wide on x so the panning
 * camera never runs off the end within a session.
 */
export function createWall(scene: THREE.Scene): void {
  const span = 600;

  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(span, 40),
    new THREE.MeshStandardMaterial({ color: GALLERY.wallBottom, roughness: 0.95 })
  );
  wall.position.set(span / 2 - 20, 8, WALL.z - 0.3);
  scene.add(wall);

  // subtle vertical gradient: a second, lighter plane fading in at the top
  const topGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(span, 24),
    new THREE.MeshBasicMaterial({ color: GALLERY.wallTop, transparent: true, opacity: 0.5 })
  );
  topGlow.position.set(span / 2 - 20, 16, WALL.z - 0.25);
  scene.add(topGlow);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(span, 60),
    new THREE.MeshStandardMaterial({ color: GALLERY.floor, roughness: 0.35, metalness: 0.5 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(span / 2 - 20, 0, WALL.z + 14);
  scene.add(floor);

  scene.fog = new THREE.FogExp2(GALLERY.backdrop, 0.012);
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add web/src/themes/gallery/wall.ts
git commit -m "Add gallery wall and floor"
```

---

## Task 9: gallery.ts — renderer, lighting, camera state machine, input

**Files:**
- Create: `web/src/themes/gallery/gallery.ts`

- [ ] **Step 1: Write gallery.ts**

Create `web/src/themes/gallery/gallery.ts`:

```ts
import * as THREE from "three";
import type { GroveFeed } from "../../net/feed.js";
import type { VisualizationHandle } from "../types.js";
import { createPostFx } from "../shared/postfx.js";
import { GALLERY } from "./palette.js";
import { WALL } from "./layout.js";
import { createWall } from "./wall.js";
import { Pieces } from "./pieces.js";
import { Placard$ } from "./label.js";
import { netspaceLight } from "./ambience.js";
import { shouldHang } from "./select.js";
import { framePiece, panEye } from "./camera.js";

const FOV = 45;
const REST_Y = 2.6;
const REST_Z = 9;
const VIEW_BACK = 6; // keep the camera a little behind the newest piece while panning

export function startGallery(canvas: HTMLCanvasElement, feed: GroveFeed): VisualizationHandle {
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.setSize(innerWidth, innerHeight);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(GALLERY.backdrop);

  const camera = new THREE.PerspectiveCamera(FOV, innerWidth / innerHeight, 0.1, 1000);
  camera.position.set(0, REST_Y, REST_Z);

  const fill = new THREE.HemisphereLight(GALLERY.fill, 0x05060a, 0.5);
  scene.add(fill);
  const spot = new THREE.DirectionalLight(GALLERY.spot, 0.9);
  spot.position.set(0, 30, 18);
  scene.add(spot);

  const postfx = createPostFx(renderer, scene, camera, {
    bloomStrength: 0.18,
    bloomRadius: 0.5,
    bloomThreshold: 0.7,
  });

  createWall(scene);
  const loader = new THREE.TextureLoader();
  loader.crossOrigin = "anonymous";
  const pieces = new Pieces(scene, reducedMotion ? 16 : 28);
  const placard = new Placard$();

  // camera state machine
  let focused: { eye: THREE.Vector3; target: THREE.Vector3 } | null = null;
  let lightTarget = 0.9;
  let breath = 0;
  const panTarget = new THREE.Vector3(0, REST_Y, REST_Z);
  const lookTarget = new THREE.Vector3(0, REST_Y - 0.4, WALL.z);
  const tmpLook = new THREE.Vector3();

  feed.onEvent((event) => {
    switch (event.type) {
      case "sprout":
        if (shouldHang(event) && event.imageUrl) {
          loader.load(
            event.imageUrl,
            (texture) => pieces.add(event, texture),
            undefined,
            () => {} // CORS / 404 → discard quietly, no blank frame
          );
        }
        break;
      case "ambient":
        lightTarget = netspaceLight(event.netspace);
        break;
      case "block":
        breath = 1; // soft light pulse, decays in update()
        break;
      case "reorg":
        pieces.removeRecent(event.forkHeight);
        break;
    }
  });

  function focus(object: THREE.Object3D): void {
    const f = pieces.focusOf(object);
    if (!f) return;
    focused = framePiece(f.center, f.height, FOV);
    const meta = pieces.metaFor(object);
    if (meta) placard.show(meta);
  }

  function unfocus(): void {
    focused = null;
    placard.hide();
  }

  // own pointer input (the shared picker is skipped via selfManagedInput)
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  function pick(x: number, y: number): THREE.Object3D | null {
    pointer.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(pieces.pickables(), false)[0]?.object ?? null;
  }
  canvas.addEventListener("pointermove", (e) => {
    const hit = pick(e.clientX, e.clientY);
    pieces.setHovered(hit);
    canvas.style.cursor = hit ? "pointer" : "default";
  });
  canvas.addEventListener("click", (e) => {
    const hit = pick(e.clientX, e.clientY);
    if (hit) focus(hit);
    else unfocus();
  });
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") unfocus();
  });

  const frameCallbacks: Array<() => void> = [];
  const clock = new THREE.Clock();
  function frame(): void {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;

    pieces.update(t);

    // lighting eases toward the netspace target, with a decaying block "breath"
    breath = Math.max(0, breath - dt * 1.5);
    spot.intensity += (lightTarget - spot.intensity) * Math.min(dt * 2, 1) + breath * dt * 2;
    fill.intensity = 0.4 + lightTarget * 0.2;

    if (focused) {
      panTarget.copy(focused.eye);
      lookTarget.copy(focused.target);
    } else {
      const newestX = pieces.newestX();
      panTarget.copy(panEye(reducedMotion ? newestX : newestX - VIEW_BACK, REST_Y, REST_Z));
      lookTarget.set(newestX, REST_Y - 0.4, WALL.z);
    }
    const ease = reducedMotion ? 1 : Math.min(dt * 1.6, 1);
    camera.position.lerp(panTarget, ease);
    tmpLook.lerp(lookTarget, ease);
    camera.lookAt(tmpLook);

    for (const fn of frameCallbacks) fn();
    postfx.render();
  }
  tmpLook.copy(lookTarget);
  frame();

  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    postfx.setSize(innerWidth, innerHeight);
  });

  return {
    camera,
    selfManagedInput: true,
    onFrame: (fn) => frameCallbacks.push(fn),
  };
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: clean. (If `createPostFx`'s option names differ, open `web/src/themes/shared/postfx.ts` and match them.)

- [ ] **Step 3: Commit**

```bash
git add web/src/themes/gallery/gallery.ts
git commit -m "Add gallery scene orchestration"
```

---

## Task 10: index.ts + register the theme (TDD via registry test)

**Files:**
- Create: `web/src/themes/gallery/index.ts`
- Modify: `web/src/themes/index.ts:2-5`
- Test: `web/test/themes.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `web/test/themes.test.ts`:

```ts
test("gallery theme is registered and resolvable", () => {
  expect(THEMES.map((t) => t.id)).toContain("gallery");
  expect(resolveTheme("?theme=gallery", null).id).toBe("gallery");
  expect(resolveTheme("", "gallery").id).toBe("gallery");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/test/themes.test.ts`
Expected: FAIL — `gallery` not found (falls back to grove).

- [ ] **Step 3: Create the Visualization and register it**

Create `web/src/themes/gallery/index.ts`:

```ts
import type { Visualization } from "../types.js";
import { startGallery } from "./gallery.js";

export const gallery: Visualization = {
  id: "gallery",
  label: "gallery",
  legend: [
    ["sw-canvas", "framed piece — NFT mint"],
    ["sw-spotlight", "light warmth — netspace"],
    ["sw-breath", "light pulse — new block"],
    ["sw-reorg", "pieces removed — reorg"],
  ],
  start: (canvas, feed) => startGallery(canvas, feed),
};
```

Edit `web/src/themes/index.ts` lines 2-5:

```ts
import type { Visualization } from "./types.js";
import { grove } from "./grove/index.js";
import { farm } from "./farm/index.js";
import { gallery } from "./gallery/index.js";

export const THEMES: readonly Visualization[] = [grove, farm, gallery];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run web/test/themes.test.ts && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add web/src/themes/gallery/index.ts web/src/themes/index.ts web/test/themes.test.ts
git commit -m "Register gallery theme"
```

---

## Task 11: demo-art.ts + demo NFT images (TDD)

**Files:**
- Create: `web/src/net/demo-art.ts`
- Modify: `web/src/net/demo.ts:56-60`
- Test: `web/test/demo-art.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/test/demo-art.test.ts`:

```ts
import { expect, test } from "vitest";
import { demoNftImage } from "../src/net/demo-art.js";

test("returns a deterministic inline SVG data URI", () => {
  const a = demoNftImage("nft1abc");
  expect(a.startsWith("data:image/svg+xml,")).toBe(true);
  expect(demoNftImage("nft1abc")).toBe(a);
});

test("different seeds yield different art", () => {
  expect(demoNftImage("nft1abc")).not.toBe(demoNftImage("nft1xyz"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/test/demo-art.test.ts`
Expected: FAIL — cannot find module `demo-art.js`.

- [ ] **Step 3: Write demo-art.ts**

Create `web/src/net/demo-art.ts`:

```ts
import { mulberry32 } from "../themes/shared/util.js";

function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Deterministic abstract artwork as an inline SVG data URI — works offline and
 * is exempt from CORS, so the demo gallery populates without network art.
 */
export function demoNftImage(seed: string): string {
  const rng = mulberry32(seedFrom(seed));
  const h1 = Math.floor(rng() * 360);
  const h2 = (h1 + 40 + Math.floor(rng() * 200)) % 360;
  const cx = 20 + Math.floor(rng() * 60);
  const cy = 20 + Math.floor(rng() * 60);
  const r = 18 + Math.floor(rng() * 26);
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
    `<stop offset='0' stop-color='hsl(${h1},65%,42%)'/>` +
    `<stop offset='1' stop-color='hsl(${h2},60%,22%)'/></linearGradient></defs>` +
    `<rect width='400' height='400' fill='url(#g)'/>` +
    `<circle cx='${cx * 4}' cy='${cy * 4}' r='${r * 4}' fill='hsl(${h2},70%,72%)' opacity='0.85'/>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
```

- [ ] **Step 4: Wire it into demo.ts**

In `web/src/net/demo.ts`, add the import near the top (with the other imports):

```ts
import { demoNftImage } from "./demo-art.js";
```

Then change the NFT block (lines 56-60) to also set an image:

```ts
  if (kind === "nft") {
    event.launcherId = randomHex(32);
    event.nftId = DEMO_NFT_IDS[Math.floor(Math.random() * DEMO_NFT_IDS.length)];
    event.imageUrl = demoNftImage(event.nftId ?? event.coinId);
    if (Math.random() < 0.25) event.mint = true;
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run web/test/demo-art.test.ts && npm run typecheck`
Expected: PASS (2 tests); typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/net/demo-art.ts web/src/net/demo.ts web/test/demo-art.test.ts
git commit -m "Give demo NFTs deterministic inline art"
```

---

## Task 12: style.css — placard + legend swatches

**Files:**
- Modify: `web/src/style.css`

- [ ] **Step 1: Read the existing card and swatch styles**

Run: `grep -n "#card\|\.sw-\|\.ticker\|\.dim\|\.cat-icon" web/src/style.css`
Read those rules so the new ones match the existing visual language (font, padding, link color, swatch size).

- [ ] **Step 2: Append the gallery styles**

Append to `web/src/style.css` (adjust the borrowed values to match what you read in Step 1 — reuse the same font stack, link color, and swatch dimensions the existing `#card`/`.sw-*` rules use):

```css
/* gallery placard — museum wall label for the focused piece */
.gallery-label {
  position: fixed;
  right: 4vw;
  top: 50%;
  transform: translateY(-50%) translateX(8px);
  max-width: 280px;
  padding: 14px 16px;
  background: rgba(10, 11, 14, 0.82);
  border: 1px solid rgba(255, 233, 194, 0.22);
  border-radius: 8px;
  color: #e8e4dc;
  font: inherit;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.4s ease, transform 0.4s ease;
}
.gallery-label.visible {
  opacity: 1;
  transform: translateY(-50%) translateX(0);
  pointer-events: auto;
}
.gallery-label h3 {
  margin: 0 0 8px;
  font-size: 15px;
  letter-spacing: 0.02em;
}
.gallery-label .dim {
  opacity: 0.6;
  font-size: 12px;
}
.gallery-label a {
  color: #ffe9c2;
}

/* gallery legend swatches */
.sw-canvas {
  background: linear-gradient(135deg, #6cb6ff, #c79bff);
  border: 1px solid #3a3d46;
}
.sw-spotlight {
  background: radial-gradient(circle at 50% 30%, #ffe9c2, #6b5a36);
}
.sw-breath {
  background: #ffe9c2;
  opacity: 0.7;
}
.sw-reorg {
  background: #5a1f1f;
}
```

- [ ] **Step 3: Build to verify the CSS compiles**

Run: `npm run build`
Expected: build succeeds, no CSS errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/style.css
git commit -m "Style gallery placard and legend swatches"
```

---

## Task 13: Full verification + manual check

**Files:** none (verification only)

- [ ] **Step 1: Run the full gate**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: all pass; build emits `web/dist/`.

- [ ] **Step 2: Manual demo check**

Run: `npm run dev:web`
Open: `http://localhost:5173/?demo=1&theme=gallery`
Verify:
- Framed pieces hang along the wall and the camera pans to follow new ones.
- Hovering a piece highlights its frame and shows a pointer cursor.
- Clicking a piece flies the camera in to frame it and shows the placard (amount, block, coin, launcher, spacescan + mintgarden links).
- Clicking empty space or pressing Esc flies back out and hides the placard.
- The legend switcher lists `gallery` and can switch into/out of it.

- [ ] **Step 3: Stop the dev server**

Stop the `npm run dev:web` process.

- [ ] **Step 4: Final commit (only if Step 2 required tweaks)**

```bash
git add -A
git commit -m "Polish gallery interactions after manual check"
```

---

## Self-review notes

- **Spec coverage:** salon layout (Task 3), mints-only predicate (Task 4), camera fly-in (Tasks 5/9), placard (Task 6), piece pool + wrap + reorg removal + texture disposal (Task 7), dark wall/floor (Task 8), CORS discard via loader `onError` (Task 9), netspace/block/reorg ambience (Tasks 2/9), legend (Task 10), demo art (Task 11), placard/legend CSS (Task 12), `selfManagedInput` generalization (Task 1). All spec sections map to a task.
- **Out of scope honored:** no server image proxy, no non-mint hanging, no video/audio playback (non-image URLs fail to load and are discarded).
- **Type consistency:** `Pieces` methods (`add`, `count`, `removeRecent`, `newestX`, `pickables`, `metaFor`, `focusOf`, `setHovered`, `update`) are used consistently in Task 9. `placardModel`/`Placard$` names match between Tasks 6 and 9. `netspaceLight`, `framePiece`, `panEye`, `hangSlot`, `frameSize`, `shouldHang`, `WALL` referenced with the signatures defined.
- **Note for implementer:** Task 9 reuses `shouldHang` (Task 4) and keeps a trailing `&& event.imageUrl` only so TypeScript narrows `imageUrl` to a string before `loader.load`. Don't drop that trailing check — it's a type guard, not redundant logic.
