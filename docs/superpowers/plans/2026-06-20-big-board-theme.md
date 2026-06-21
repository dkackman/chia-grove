# The Big Board (Split-Flap Ledger Theme) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fifth `Visualization` (`board`, "The Big Board") — a Solari-style split-flap departure board that renders the live chain as a scrolling spend ledger with per-character riffle.

**Architecture:** One self-contained theme folder `web/src/themes/board/`. A `FlapGrid` wraps a single `THREE.InstancedMesh` of character-cell quads (one instance per cell) using a custom `ShaderMaterial` that samples a per-instance glyph cell from a procedural atlas texture; a per-cell riffle state machine drives the squash-swap flip. Pure formatting (`rows.ts`, `glyphs.ts`, `palette.ts`, `header.ts` gauge) is unit-tested; the renderer, camera, audio, and NFT tile are visual and verified in demo mode.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), three.js `^0.184.0`, Fastify-served Vite app, vitest. No new dependencies.

## Global Constraints

- Node ≥ 24; three.js `^0.184.0`; **no new npm dependencies**.
- TypeScript ESM: every relative import ends in `.js` (e.g. `import { x } from "./glyphs.js"`).
- Themes own their entire scene behind the `Visualization` interface (`web/src/themes/types.ts`); `start(canvas, feed)` returns a `VisualizationHandle`.
- Theme id is exactly `board`; label is exactly `The Big Board`.
- DOM access (`document`, `canvas`) lives **only inside functions/methods**, never at module top level, so modules stay importable in the DOM-less vitest environment (see `mine/textures.ts`).
- Tests live in `web/test/`, import from `../src/...`, use `import { expect, test } from "vitest"`.
- Run the full suite with `npm test`; typecheck with `npm run typecheck`; lint with `npm run lint`.
- Manual verification uses demo mode: `npm run dev:web` then open `http://localhost:5173/?demo=1&theme=board`.

---

### Task 1: Palette + per-kind accent (`palette.ts`)

**Files:**
- Create: `web/src/themes/board/palette.ts`
- Test: `web/test/board-palette.test.ts`

**Interfaces:**
- Consumes: `catColor(assetIdHex)` from `../shared/cat-color.js`; `SproutEvent` from `@grove/shared`; `THREE.Color`.
- Produces:
  - `export const BOARD: { backdrop: number; housing: number; flapFace: number; flapText: number; live: number }`
  - `export function kindAccent(event: SproutEvent): THREE.Color` — XCH off-white, CAT hashed from `assetId` via `catColor`, NFT amber, DID violet.

- [ ] **Step 1: Write the failing test**

```ts
// web/test/board-palette.test.ts
import { expect, test } from "vitest";
import { BOARD, kindAccent } from "../src/themes/board/palette.js";
import type { SproutEvent } from "@grove/shared";

function sprout(over: Partial<SproutEvent>): SproutEvent {
  return { type: "sprout", kind: "xch", height: 1, coinId: "00".repeat(32), amount: "0", ...over };
}

test("BOARD palette has the colors the scene needs", () => {
  for (const key of ["backdrop", "housing", "flapFace", "flapText", "live"] as const) {
    expect(typeof BOARD[key]).toBe("number");
  }
});

test("kindAccent gives each kind a distinct base color", () => {
  const xch = kindAccent(sprout({ kind: "xch" }));
  const nft = kindAccent(sprout({ kind: "nft" }));
  const did = kindAccent(sprout({ kind: "did" }));
  expect(xch.getHex()).not.toBe(nft.getHex());
  expect(nft.getHex()).not.toBe(did.getHex());
});

test("CAT accent is deterministic from assetId and varies by asset", () => {
  const a = kindAccent(sprout({ kind: "cat", assetId: "ab".repeat(32) }));
  const b = kindAccent(sprout({ kind: "cat", assetId: "ab".repeat(32) }));
  const c = kindAccent(sprout({ kind: "cat", assetId: "cd".repeat(32) }));
  expect(a.getHex()).toBe(b.getHex());
  expect(a.getHex()).not.toBe(c.getHex());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/test/board-palette.test.ts`
Expected: FAIL — cannot find module `../src/themes/board/palette.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// web/src/themes/board/palette.ts
import * as THREE from "three";
import type { SproutEvent } from "@grove/shared";
import { catColor } from "../shared/cat-color.js";

/** Solari departure-board palette: warm characters on near-black flaps. */
export const BOARD = {
  backdrop: 0x05070a, // room behind the board
  housing: 0x111418, // board frame
  flapFace: 0x0b0d10, // unlit flap background (atlas bakes this in)
  flapText: 0xf4ead2, // warm off-white characters
  live: 0x3ad17a, // the LIVE indicator
} as const;

const NFT_ACCENT = new THREE.Color(0xffd166);
const DID_ACCENT = new THREE.Color(0x9b5cff);
const XCH_ACCENT = new THREE.Color(0xf4ead2);

/** Per-kind accent applied to a ledger row's KIND cell. Pure. */
export function kindAccent(event: SproutEvent): THREE.Color {
  if (event.kind === "nft") return NFT_ACCENT.clone();
  if (event.kind === "did") return DID_ACCENT.clone();
  if (event.kind === "cat" && event.assetId) {
    const { h, s, l } = catColor(event.assetId);
    return new THREE.Color().setHSL(h, s, l);
  }
  return XCH_ACCENT.clone();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run web/test/board-palette.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/themes/board/palette.ts web/test/board-palette.test.ts
git commit -m "feat(board): solari palette + per-kind accent color"
```

---

### Task 2: Glyph atlas + glyph math (`glyphs.ts`)

**Files:**
- Create: `web/src/themes/board/glyphs.ts`
- Test: `web/test/board-glyphs.test.ts`

**Interfaces:**
- Consumes: `THREE.CanvasTexture` (atlas build only).
- Produces:
  - `export const GLYPHS: string` — ordered glyph table; index = atlas cell index.
  - `export const ATLAS_COLS = 8` (atlas is `ATLAS_COLS × ATLAS_COLS` cells).
  - `export function charToGlyph(ch: string): number` — index into `GLYPHS`; `0` (space) for unknown; lowercase folded to uppercase.
  - `export function glyphCell(index: number): { col: number; row: number }` — atlas cell coordinates.
  - `export function nextGlyph(cur: number, target: number): number` — one riffle step: `cur + 1` wrapping `GLYPHS.length`, or `target` if already there.
  - `export function buildGlyphAtlas(): THREE.CanvasTexture` — procedural nearest-filtered atlas (DOM access inside the function only).

- [ ] **Step 1: Write the failing test**

```ts
// web/test/board-glyphs.test.ts
import { expect, test } from "vitest";
import { GLYPHS, ATLAS_COLS, charToGlyph, glyphCell, nextGlyph } from "../src/themes/board/glyphs.js";

test("glyph table starts with space and fits the atlas", () => {
  expect(GLYPHS[0]).toBe(" ");
  expect(GLYPHS.length).toBeLessThanOrEqual(ATLAS_COLS * ATLAS_COLS);
  expect(GLYPHS).toContain("A");
  expect(GLYPHS).toContain("9");
  expect(GLYPHS).toContain("★");
});

test("charToGlyph maps letters, digits, folds case, blanks unknown", () => {
  expect(charToGlyph(" ")).toBe(0);
  expect(GLYPHS[charToGlyph("A")]).toBe("A");
  expect(charToGlyph("a")).toBe(charToGlyph("A"));
  expect(GLYPHS[charToGlyph("7")]).toBe("7");
  expect(charToGlyph("~")).toBe(0); // not in table → blank
  expect(charToGlyph("")).toBe(0);
});

test("glyphCell lays indices out row-major over the atlas", () => {
  expect(glyphCell(0)).toEqual({ col: 0, row: 0 });
  expect(glyphCell(ATLAS_COLS)).toEqual({ col: 0, row: 1 });
  expect(glyphCell(ATLAS_COLS + 3)).toEqual({ col: 3, row: 1 });
});

test("nextGlyph steps one toward target and wraps", () => {
  expect(nextGlyph(0, 0)).toBe(0); // already there
  expect(nextGlyph(0, 5)).toBe(1); // step forward
  expect(nextGlyph(GLYPHS.length - 1, 0)).toBe(0); // wraps to start
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/test/board-glyphs.test.ts`
Expected: FAIL — cannot find module `../src/themes/board/glyphs.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// web/src/themes/board/glyphs.ts
import * as THREE from "three";

// Index = atlas cell. Space first so an unknown/blank cell is cell 0.
export const GLYPHS = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-:▸★▮·";
export const ATLAS_COLS = 8; // 8×8 = 64 cells ≥ GLYPHS.length

const INDEX = new Map<string, number>();
for (let i = 0; i < GLYPHS.length; i++) INDEX.set(GLYPHS[i], i);

/** Glyph index for a character; folds case, blanks unknowns. Pure. */
export function charToGlyph(ch: string): number {
  if (!ch) return 0;
  return INDEX.get(ch) ?? INDEX.get(ch.toUpperCase()) ?? 0;
}

/** Atlas cell coordinates for a glyph index. Pure. */
export function glyphCell(index: number): { col: number; row: number } {
  return { col: index % ATLAS_COLS, row: Math.floor(index / ATLAS_COLS) };
}

/** One riffle step from `cur` toward `target`, wrapping the table. Pure. */
export function nextGlyph(cur: number, target: number): number {
  if (cur === target) return target;
  return (cur + 1) % GLYPHS.length;
}

/** Procedural nearest-filtered glyph atlas. DOM access stays inside here. */
export function buildGlyphAtlas(): THREE.CanvasTexture {
  const cell = 32; // px per glyph
  const size = ATLAS_COLS * cell;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#0b0d10"; // flap face baked in
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#f4ead2"; // warm character
  ctx.font = `700 ${Math.round(cell * 0.66)}px ui-monospace, "DejaVu Sans Mono", monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < GLYPHS.length; i++) {
    const { col, row } = glyphCell(i);
    const ch = GLYPHS[i];
    if (ch !== " ") ctx.fillText(ch, col * cell + cell / 2, row * cell + cell * 0.54);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run web/test/board-glyphs.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/themes/board/glyphs.ts web/test/board-glyphs.test.ts
git commit -m "feat(board): glyph atlas + charToGlyph/nextGlyph math"
```

---

### Task 3: Row formatting (`rows.ts`)

**Files:**
- Create: `web/src/themes/board/rows.ts`
- Test: `web/test/board-rows.test.ts`

**Interfaces:**
- Consumes: `SproutEvent` from `@grove/shared`; `mojosToXch`, `mojosToCAT` from `../../ui/format.js`.
- Produces:
  - `export const BOARD_COLS = 48` — characters per ledger row.
  - `export function rowText(event: SproutEvent): string` — a `BOARD_COLS`-wide fixed-width line: `KIND ▸ ASSET AMOUNT BLOCK STATUS`.

Field widths (sum incl. separators = 48): KIND 3, ` ▸ ` 3, ASSET 12, ` ` 1, AMOUNT 13 (right), ` ` 1, BLOCK 8 (right), ` ` 1, STATUS 6.

- [ ] **Step 1: Write the failing test**

```ts
// web/test/board-rows.test.ts
import { expect, test } from "vitest";
import { BOARD_COLS, rowText } from "../src/themes/board/rows.js";
import type { SproutEvent } from "@grove/shared";

function sprout(over: Partial<SproutEvent>): SproutEvent {
  return { type: "sprout", kind: "xch", height: 100, coinId: "00".repeat(32), amount: "0", ...over };
}

test("every row is exactly BOARD_COLS wide", () => {
  expect(rowText(sprout({})).length).toBe(BOARD_COLS);
  expect(rowText(sprout({ kind: "nft", mint: true })).length).toBe(BOARD_COLS);
  expect(rowText(sprout({ kind: "cat", catTicker: "SBX", amount: "250000" })).length).toBe(BOARD_COLS);
});

test("xch row shows kind, amount, block, CONFIRM", () => {
  const t = rowText(sprout({ kind: "xch", amount: "1500000000000", height: 5121 }));
  expect(t).toContain("XCH");
  expect(t).toContain("1.5");
  expect(t).toContain("5121");
  expect(t).toContain("CONFRM");
});

test("nft mint shows MINT and the new-mint marker", () => {
  const t = rowText(sprout({ kind: "nft", mint: true, height: 5121 }));
  expect(t).toContain("MINT");
  expect(t).toContain("★");
});

test("cat row shows the ticker (truncated) and token amount", () => {
  const t = rowText(sprout({ kind: "cat", catTicker: "SUPERLONGTICKER", amount: "250000" }));
  expect(t).toContain("SUPERLONGTIC"); // 12-char clamp
  expect(t).not.toContain("SUPERLONGTICKER");
});

test("did and amount-less kinds use a dash placeholder", () => {
  const t = rowText(sprout({ kind: "did" }));
  expect(t).toContain("PROFILE");
  expect(t).toContain("-"); // amount placeholder
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/test/board-rows.test.ts`
Expected: FAIL — cannot find module `../src/themes/board/rows.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// web/src/themes/board/rows.ts
import type { SproutEvent } from "@grove/shared";
import { mojosToXch, mojosToCAT } from "../../ui/format.js";

export const BOARD_COLS = 48;

const padL = (s: string, n: number) => s.slice(0, n).padStart(n);
const padR = (s: string, n: number) => s.slice(0, n).padEnd(n);

/** Trim a decimal string to at most `maxFrac` fraction digits (no rounding). */
function clampFrac(s: string, maxFrac: number): string {
  const dot = s.indexOf(".");
  return dot < 0 ? s : s.slice(0, dot + 1 + maxFrac).replace(/\.?0+$/, "") || "0";
}

function kindLabel(e: SproutEvent): string {
  return e.kind.toUpperCase(); // XCH / CAT / NFT / DID
}

function asset(e: SproutEvent): string {
  if (e.kind === "cat") return (e.catTicker ?? e.catName ?? "CAT").toUpperCase();
  if (e.kind === "nft") return e.mint ? "MINT" : "TRANSFER";
  if (e.kind === "did") return "PROFILE";
  return "-";
}

function amount(e: SproutEvent): string {
  if (e.kind === "xch") return clampFrac(mojosToXch(e.amount), 4);
  if (e.kind === "cat") return clampFrac(mojosToCAT(e.amount), 3);
  return "-";
}

function status(e: SproutEvent): string {
  return e.mint ? "★ NEW" : "CONFRM";
}

/** One fixed-width ledger line for a spend. Pure. */
export function rowText(event: SproutEvent): string {
  return (
    padR(kindLabel(event), 3) +
    " ▸ " +
    padR(asset(event), 12) +
    " " +
    padL(amount(event), 13) +
    " " +
    padL(String(event.height), 8) +
    " " +
    padR(status(event), 6)
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run web/test/board-rows.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/themes/board/rows.ts web/test/board-rows.test.ts
git commit -m "feat(board): fixed-width ledger row formatting"
```

---

### Task 4: FlapGrid — instanced cells + riffle (`flapgrid.ts`)

**Files:**
- Create: `web/src/themes/board/flapgrid.ts`
- Test: `web/test/board-flapgrid.test.ts`

**Interfaces:**
- Consumes: `THREE`; `GLYPHS`, `charToGlyph`, `glyphCell`, `nextGlyph`, `ATLAS_COLS` from `./glyphs.js`.
- Produces:
  - `export class FlapGrid` with:
    - `constructor(scene: THREE.Scene, atlas: THREE.CanvasTexture, rows: number, cols: number, opts?: { cell?: number; originX?: number; originY?: number })`
    - `readonly mesh: THREE.InstancedMesh`
    - `readonly rows: number; readonly cols: number`
    - `setRow(row: number, text: string, instant?: boolean): void`
    - `clearRow(row: number): void`
    - `tintRow(row: number, color: THREE.Color): void`
    - `highlightRow(row: number | null): void`
    - `update(dt: number): void`
    - `rowOf(instanceId: number): number`
    - `idle(): boolean` — true when no cell is animating (for the clatter throttle).

Implementation notes the test relies on: the mesh has `rows*cols` instances; `setRow(r, text, true)` makes the displayed glyph for each cell equal `charToGlyph(text[c])` immediately; `rowOf(i) === Math.floor(i/cols)`.

- [ ] **Step 1: Write the failing test**

```ts
// web/test/board-flapgrid.test.ts
import * as THREE from "three";
import { expect, test } from "vitest";
import { FlapGrid } from "../src/themes/board/flapgrid.js";
import { buildGlyphAtlasStub } from "./helpers/atlas-stub.js";

function grid(rows = 3, cols = 6) {
  const scene = new THREE.Scene();
  return new FlapGrid(scene, buildGlyphAtlasStub(), rows, cols);
}

test("mesh allocates one instance per cell", () => {
  const g = grid(3, 6);
  expect(g.mesh.count).toBe(18);
  expect(g.rows).toBe(3);
  expect(g.cols).toBe(6);
});

test("rowOf maps an instance id to its row", () => {
  const g = grid(3, 6);
  expect(g.rowOf(0)).toBe(0);
  expect(g.rowOf(6)).toBe(1);
  expect(g.rowOf(13)).toBe(2);
});

test("instant setRow lands the target glyph immediately and reports idle", () => {
  const g = grid(1, 6);
  g.setRow(0, "ABC", true);
  g.update(0.016);
  expect(g.idle()).toBe(true); // nothing animating after an instant set
});

test("animated setRow is not idle until it has riffled to target", () => {
  const g = grid(1, 6);
  g.setRow(0, "Z", false); // cell 0 must riffle from space to Z
  expect(g.idle()).toBe(false);
  for (let i = 0; i < 500; i++) g.update(0.05); // run the riffle to completion
  expect(g.idle()).toBe(true);
});
```

- [ ] **Step 2: Create the atlas stub helper, then run to verify failure**

```ts
// web/test/helpers/atlas-stub.ts
import * as THREE from "three";

// A DataTexture stand-in so FlapGrid tests need no <canvas>/DOM.
export function buildGlyphAtlasStub(): THREE.CanvasTexture {
  const tex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  tex.needsUpdate = true;
  return tex as unknown as THREE.CanvasTexture;
}
```

Run: `npx vitest run web/test/board-flapgrid.test.ts`
Expected: FAIL — cannot find module `../src/themes/board/flapgrid.js`.

- [ ] **Step 3: Write the implementation**

```ts
// web/src/themes/board/flapgrid.ts
import * as THREE from "three";
import { GLYPHS, ATLAS_COLS, charToGlyph, glyphCell, nextGlyph } from "./glyphs.js";

const FLIP_TIME = 0.06; // seconds per single flap
const STAGGER = 0.012; // per-column riffle start delay
const MIN_SQUASH = 0.06; // flap thinness at fold midpoint
const HIGHLIGHT = 1.8; // hovered-row brightness boost

// Custom unlit shader: each instance samples its own atlas cell (aGlyph) and is
// tinted by instanceColor. The squash lives in instanceMatrix.scale.y, so the
// shader stays trivial. ShaderMaterial gets three's instancing attribute prefix
// (instanceMatrix, instanceColor) for free when the mesh is an InstancedMesh.
const VERT = /* glsl */ `
  attribute float aGlyph;
  varying vec2 vUv;
  varying float vGlyph;
  varying vec3 vTint;
  void main() {
    vUv = uv;
    vGlyph = aGlyph;
    vTint = instanceColor;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;
const FRAG = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform float uCols;
  varying vec2 vUv;
  varying float vGlyph;
  varying vec3 vTint;
  void main() {
    float col = mod(vGlyph, uCols);
    float row = floor(vGlyph / uCols);
    vec2 cell = (vec2(col, row) + vUv) / uCols;
    vec4 tex = texture2D(uAtlas, cell);
    gl_FragColor = vec4(tex.rgb * vTint, 1.0);
  }
`;

export class FlapGrid {
  readonly mesh: THREE.InstancedMesh;
  readonly rows: number;
  readonly cols: number;

  private readonly cell: number;
  private readonly originX: number;
  private readonly originY: number;

  private readonly cur: Int16Array; // displayed glyph
  private readonly target: Int16Array; // glyph being riffled toward
  private readonly flip: Float32Array; // 0..1 within a flip, -1 = idle
  private readonly wait: Float32Array; // stagger countdown before riffle starts
  private readonly swapped: Uint8Array; // glyph already swapped this flip?
  private readonly aGlyph: THREE.InstancedBufferAttribute;
  private readonly base: THREE.Color[]; // per-row tint (stored on cell 0..cols)
  private hovered = -1;
  private animating = 0;

  private readonly m = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly scl = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly tint = new THREE.Color();

  constructor(
    scene: THREE.Scene,
    atlas: THREE.CanvasTexture,
    rows: number,
    cols: number,
    opts: { cell?: number; originX?: number; originY?: number } = {}
  ) {
    this.rows = rows;
    this.cols = cols;
    this.cell = opts.cell ?? 0.6;
    const n = rows * cols;
    this.originX = opts.originX ?? -((cols - 1) * this.cell) / 2;
    this.originY = opts.originY ?? ((rows - 1) * this.cell) / 2;

    const geo = new THREE.PlaneGeometry(this.cell * 0.92, this.cell * 0.92);
    this.aGlyph = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    this.aGlyph.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aGlyph", this.aGlyph);

    const mat = new THREE.ShaderMaterial({
      uniforms: { uAtlas: { value: atlas }, uCols: { value: ATLAS_COLS } },
      vertexShader: VERT,
      fragmentShader: FRAG,
    });

    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = n;
    // instanceColor must exist so the shader's `instanceColor` attribute is bound
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);

    this.cur = new Int16Array(n);
    this.target = new Int16Array(n);
    this.flip = new Float32Array(n).fill(-1);
    this.wait = new Float32Array(n);
    this.swapped = new Uint8Array(n);
    this.base = Array.from({ length: rows }, () => new THREE.Color(1, 1, 1));

    for (let i = 0; i < n; i++) this.writeMatrix(i, 1);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.aGlyph.needsUpdate = true;

    // Pin the bounding sphere so raycast picking works before any animation.
    const r = Math.max(rows, cols) * this.cell;
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), r);
    scene.add(this.mesh);
  }

  rowOf(instanceId: number): number {
    return Math.floor(instanceId / this.cols);
  }

  idle(): boolean {
    return this.animating === 0;
  }

  setRow(row: number, text: string, instant = false): void {
    for (let c = 0; c < this.cols; c++) {
      const i = row * this.cols + c;
      const g = charToGlyph(text[c] ?? " ");
      this.target[i] = g;
      if (instant) {
        if (this.flip[i] >= 0) this.animating--;
        this.cur[i] = g;
        this.flip[i] = -1;
        this.wait[i] = 0;
        this.aGlyph.array[i] = g;
      } else if (this.cur[i] !== g && this.flip[i] < 0) {
        this.flip[i] = 0;
        this.wait[i] = c * STAGGER;
        this.swapped[i] = 0;
        this.animating++;
      }
    }
    this.aGlyph.needsUpdate = true;
  }

  clearRow(row: number): void {
    this.setRow(row, "", true);
  }

  tintRow(row: number, color: THREE.Color): void {
    this.base[row].copy(color);
    if (row !== this.hovered) this.applyRowColor(row, color);
  }

  highlightRow(row: number | null): void {
    if (this.hovered === (row ?? -1)) return;
    if (this.hovered >= 0) this.applyRowColor(this.hovered, this.base[this.hovered]);
    this.hovered = row ?? -1;
    if (this.hovered >= 0) {
      this.applyRowColor(this.hovered, this.tint.copy(this.base[this.hovered]).multiplyScalar(HIGHLIGHT));
    }
  }

  private applyRowColor(row: number, color: THREE.Color): void {
    for (let c = 0; c < this.cols; c++) this.mesh.setColorAt(row * this.cols + c, color);
    this.mesh.instanceColor!.needsUpdate = true;
  }

  private writeMatrix(i: number, squashY: number): void {
    const c = i % this.cols;
    const r = (i - c) / this.cols;
    this.pos.set(this.originX + c * this.cell, this.originY - r * this.cell, 0);
    this.scl.set(1, squashY, 1);
    this.m.compose(this.pos, this.q, this.scl);
    this.mesh.setMatrixAt(i, this.m);
  }

  update(dt: number): void {
    if (this.animating === 0) return;
    const n = this.cur.length;
    for (let i = 0; i < n; i++) {
      if (this.flip[i] < 0) continue;
      if (this.wait[i] > 0) {
        this.wait[i] = Math.max(0, this.wait[i] - dt);
        continue;
      }
      const prev = this.flip[i];
      this.flip[i] += dt / FLIP_TIME;
      // swap the glyph at the fold midpoint
      if (prev < 0.5 && this.flip[i] >= 0.5 && !this.swapped[i]) {
        this.cur[i] = nextGlyph(this.cur[i], this.target[i]);
        this.aGlyph.array[i] = this.cur[i];
        this.swapped[i] = 1;
      }
      if (this.flip[i] >= 1) {
        this.swapped[i] = 0;
        if (this.cur[i] === this.target[i]) {
          this.flip[i] = -1;
          this.animating--;
          this.writeMatrix(i, 1);
          continue;
        }
        this.flip[i] -= 1; // riffle on to the next glyph
      }
      // squash: 1 at flip 0/1, MIN_SQUASH at flip 0.5
      const sy = MIN_SQUASH + (1 - MIN_SQUASH) * Math.abs(Math.cos(this.flip[i] * Math.PI));
      this.writeMatrix(i, sy);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.aGlyph.needsUpdate = true;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run web/test/board-flapgrid.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add web/src/themes/board/flapgrid.ts web/test/board-flapgrid.test.ts web/test/helpers/atlas-stub.ts
git commit -m "feat(board): FlapGrid instanced split-flap cells with riffle"
```

---

### Task 5: Header strip (`header.ts`)

**Files:**
- Create: `web/src/themes/board/header.ts`
- Test: `web/test/board-header.test.ts`

**Interfaces:**
- Consumes: `THREE`; `FlapGrid` from `./flapgrid.js`; `BOARD_COLS` from `./rows.js`.
- Produces:
  - `export function mempoolGauge(size: number, width: number, full?: number): string` — `▮`-filled bar `width` chars wide; fraction `min(1, size/full)` (default `full = 5000`). Pure.
  - `export class Header` with `constructor(scene, atlas, opts?: { originY?: number })`, `setBlock(height, spendCount, fees)`, `setAmbient(mempoolSize, netspace)`, `tick(date)`, `update(dt)`. Owns its own 3-row `FlapGrid`.

- [ ] **Step 1: Write the failing test**

```ts
// web/test/board-header.test.ts
import { expect, test } from "vitest";
import { mempoolGauge } from "../src/themes/board/header.js";

test("empty mempool is an empty bar of the requested width", () => {
  const g = mempoolGauge(0, 10);
  expect(g.length).toBe(10);
  expect(g).not.toContain("▮");
});

test("a full mempool fills the whole bar", () => {
  expect(mempoolGauge(99999, 10)).toBe("▮".repeat(10));
});

test("a half-full mempool fills about half", () => {
  const g = mempoolGauge(2500, 10, 5000);
  expect([...g].filter((c) => c === "▮").length).toBe(5);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/test/board-header.test.ts`
Expected: FAIL — cannot find module `../src/themes/board/header.js`.

- [ ] **Step 3: Write the implementation**

```ts
// web/src/themes/board/header.ts
import * as THREE from "three";
import { FlapGrid } from "./flapgrid.js";
import { BOARD_COLS } from "./rows.js";

const padR = (s: string, n: number) => s.slice(0, n).padEnd(n);

/** A `▮`/`·` fill bar `width` chars wide. Pure. */
export function mempoolGauge(size: number, width: number, full = 5000): string {
  const filled = Math.round(Math.min(1, size / full) * width);
  return "▮".repeat(filled) + "·".repeat(width - filled);
}

/** Pretty-print a netspace byte count (string) as e.g. "38.2 EIB". */
function netspaceText(bytes: string): string {
  const units = ["B", "KIB", "MIB", "GIB", "TIB", "PIB", "EIB"];
  let v = Number(bytes);
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(1)} ${units[u]}`;
}

const clock = (d: Date) =>
  [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");

export class Header {
  private readonly grid: FlapGrid;
  private mempoolSize = 0;
  private netspace = "0";

  constructor(scene: THREE.Scene, atlas: THREE.CanvasTexture, opts: { originY?: number } = {}) {
    // 3 rows sitting above the ledger; the ledger sets its own originY below this.
    this.grid = new FlapGrid(scene, atlas, 3, BOARD_COLS, { originY: opts.originY ?? 7 });
    this.grid.setRow(0, padR("THE BIG BOARD", BOARD_COLS), true);
  }

  setBlock(height: number, spendCount: number, fees: string): void {
    this.grid.setRow(0, padR(`BLOCK ${height}   ${spendCount} SPENDS   ${fees} MOJO FEES`, BOARD_COLS));
  }

  setAmbient(mempoolSize: number, netspace: string): void {
    this.mempoolSize = mempoolSize;
    this.netspace = netspace;
    this.grid.setRow(
      1,
      padR(`MEMPOOL [${mempoolGauge(mempoolSize, 12)}]   NETSPACE ${netspaceText(netspace)}`, BOARD_COLS)
    );
  }

  tick(date: Date): void {
    this.grid.setRow(2, padR(`${clock(date)}   LIVE`, BOARD_COLS));
  }

  update(dt: number): void {
    this.grid.update(dt);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run web/test/board-header.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/themes/board/header.ts web/test/board-header.test.ts
git commit -m "feat(board): header strip with mempool gauge, netspace, clock"
```

---

### Task 6: NOW SHOWING NFT tile (`nowshowing.ts`)

**Files:**
- Create: `web/src/themes/board/nowshowing.ts`
- Test: `web/test/board-nowshowing.test.ts`

**Interfaces:**
- Consumes: `THREE`; `SproutEvent` from `@grove/shared`; `mediaSrc` from `../../ui/media.js`; `LoadPool` from `../shared/load-pool.js`.
- Produces:
  - `export function shouldShowArt(event: SproutEvent): boolean` — pure gate: NFT, has a resolvable `mediaSrc`, and is an image kind (the tile is a static texture; video/audio are skipped). Pure.
  - `export class NowShowing` with `constructor(scene, pool: LoadPool, opts?: { x?: number })`, `show(event)`, `update(dt)`. Loads art via `THREE.TextureLoader` through the pool and cross-fades a small plane.

- [ ] **Step 1: Write the failing test**

```ts
// web/test/board-nowshowing.test.ts
import { expect, test } from "vitest";
import { shouldShowArt } from "../src/themes/board/nowshowing.js";
import type { SproutEvent } from "@grove/shared";

function sprout(over: Partial<SproutEvent>): SproutEvent {
  return { type: "sprout", kind: "nft", height: 1, coinId: "00".repeat(32), amount: "0", ...over };
}

test("shows image NFTs that have proxiable art", () => {
  expect(shouldShowArt(sprout({ launcherId: "ab".repeat(32), mediaKind: "image" }))).toBe(true);
});

test("skips non-NFT, art-less, and non-image kinds", () => {
  expect(shouldShowArt(sprout({ kind: "xch" }))).toBe(false);
  expect(shouldShowArt(sprout({ launcherId: undefined, mediaKind: undefined }))).toBe(false);
  expect(shouldShowArt(sprout({ launcherId: "ab".repeat(32), mediaKind: "video" }))).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/test/board-nowshowing.test.ts`
Expected: FAIL — cannot find module `../src/themes/board/nowshowing.js`.

- [ ] **Step 3: Write the implementation**

```ts
// web/src/themes/board/nowshowing.ts
import * as THREE from "three";
import type { SproutEvent } from "@grove/shared";
import { mediaSrc } from "../../ui/media.js";
import type { LoadPool } from "../shared/load-pool.js";

/** True when an NFT mint has static (image) art we can hang on the tile. Pure. */
export function shouldShowArt(event: SproutEvent): boolean {
  if (event.kind !== "nft") return false;
  if ((event.mediaKind ?? "image") !== "image") return false;
  return mediaSrc(event) !== null;
}

const SIZE = 3.2;

export class NowShowing {
  private readonly mesh: THREE.Mesh;
  private readonly mat: THREE.MeshBasicMaterial;
  private fade = 0;
  private want: string | null = null; // launcherId we're currently loading/showing

  constructor(scene: THREE.Scene, private readonly pool: LoadPool, opts: { x?: number } = {}) {
    this.mat = new THREE.MeshBasicMaterial({ color: 0x0b0d10, transparent: true, opacity: 0 });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), this.mat);
    this.mesh.position.set(opts.x ?? 17, 0, 0);
    scene.add(this.mesh);
  }

  show(event: SproutEvent): void {
    if (!shouldShowArt(event) || !event.launcherId) return;
    const src = mediaSrc(event);
    if (!src) return;
    const launcher = event.launcherId;
    this.want = launcher;
    this.pool.submit({
      stillWanted: () => this.want === launcher,
      start: (done) => {
        new THREE.TextureLoader().load(
          src,
          (tex) => {
            done();
            if (this.want !== launcher) return; // superseded while loading
            tex.colorSpace = THREE.SRGBColorSpace;
            this.mat.map?.dispose();
            this.mat.map = tex;
            this.mat.color.set(0xffffff);
            this.mat.needsUpdate = true;
            this.fade = 0; // restart the cross-fade
          },
          undefined,
          () => done() // silent on failure; tile keeps prior art
        );
      },
    });
  }

  update(dt: number): void {
    const targetOpacity = this.mat.map ? 1 : 0;
    this.fade = Math.min(1, this.fade + dt * 1.5);
    this.mat.opacity += (targetOpacity - this.mat.opacity) * Math.min(dt * 3, 1);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run web/test/board-nowshowing.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/themes/board/nowshowing.ts web/test/board-nowshowing.test.ts
git commit -m "feat(board): NOW SHOWING NFT art tile"
```

---

### Task 7: Clatter audio (`clatter.ts`)

**Files:**
- Create: `web/src/themes/board/clatter.ts`

**Interfaces:**
- Consumes: Web Audio API.
- Produces:
  - `export class Clatter` with `constructor()`, `setEnabled(on: boolean): void`, `get enabled(): boolean`, `flap(intensity: number): void`. Default disabled; lazily creates the `AudioContext` on first enable (a user gesture), throttles clacks, and degrades to silent on any failure.

No unit test — Web Audio is unavailable in the vitest/node environment and the module is pure side-effect. Keep all `AudioContext` access inside methods.

- [ ] **Step 1: Write the implementation**

```ts
// web/src/themes/board/clatter.ts
const KEY = "grove.board.clatter";

/** Pooled split-flap clack. Default muted; respects autoplay (lazy on enable). */
export class Clatter {
  private ctx: AudioContext | null = null;
  private on = localStorage.getItem(KEY) === "1";
  private last = 0;

  get enabled(): boolean {
    return this.on;
  }

  setEnabled(on: boolean): void {
    this.on = on;
    localStorage.setItem(KEY, on ? "1" : "0");
    if (on && !this.ctx) {
      try {
        this.ctx = new (window.AudioContext ?? (window as any).webkitAudioContext)();
      } catch {
        this.ctx = null;
      }
    }
  }

  /** A short filtered-noise burst; `intensity` (0..1) scales gain. Throttled. */
  flap(intensity: number): void {
    if (!this.on || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.last < 0.03) return; // cap density during a riffle storm
    this.last = now;
    try {
      const len = 0.025;
      const buf = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * len), this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const gain = this.ctx.createGain();
      gain.gain.value = 0.04 + 0.06 * Math.min(1, intensity);
      const hp = this.ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 1200;
      src.connect(hp).connect(gain).connect(this.ctx.destination);
      src.start();
    } catch {
      /* degrade to silent */
    }
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/themes/board/clatter.ts
git commit -m "feat(board): default-muted split-flap clatter audio"
```

---

### Task 8: Scene assembly (`board.ts`)

**Files:**
- Create: `web/src/themes/board/board.ts`

**Interfaces:**
- Consumes: everything above; `GroveFeed` from `../../net/feed.js`; `VisualizationHandle` from `../types.js`; `createFrameLimiter` from `../shared/frame-limiter.js`; `LoadPool` from `../shared/load-pool.js`; `BOARD` + `kindAccent` from `./palette.js`; `buildGlyphAtlas` from `./glyphs.js`; `FlapGrid`, `Header`, `NowShowing`, `Clatter`, `rowText`, `BOARD_COLS`, `shouldShowArt`.
- Produces: `export function startBoard(canvas: HTMLCanvasElement, feed: GroveFeed): VisualizationHandle`.

Behavior: keep a ring of the most recent `LEDGER_ROWS` sprouts (newest first). On each frame, if the ledger changed, re-render every row (`FlapGrid` only riffles cells that differ — a full shift riffles the whole board); use instant mode when more than `FAST_FORWARD` sprouts arrived since the last frame (snapshot replay) or under reduced motion. Wire picking through the shared picker (`selfManagedInput` stays false).

- [ ] **Step 1: Write the implementation**

```ts
// web/src/themes/board/board.ts
import * as THREE from "three";
import type { GroveFeed } from "../../net/feed.js";
import type { SproutEvent } from "@grove/shared";
import type { VisualizationHandle } from "../types.js";
import { createFrameLimiter } from "../shared/frame-limiter.js";
import { LoadPool } from "../shared/load-pool.js";
import { BOARD, kindAccent } from "./palette.js";
import { buildGlyphAtlas } from "./glyphs.js";
import { FlapGrid } from "./flapgrid.js";
import { Header } from "./header.js";
import { NowShowing } from "./nowshowing.js";
import { Clatter } from "./clatter.js";
import { rowText, BOARD_COLS } from "./rows.js";
import { shouldShowArt } from "./nowshowing.js";

const LEDGER_ROWS = 20;
const FAST_FORWARD = 8; // sprouts/frame above which we snap instead of riffle
const ART_CONCURRENCY = 2;

export function startBoard(canvas: HTMLCanvasElement, feed: GroveFeed): VisualizationHandle {
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.setSize(innerWidth, innerHeight);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BOARD.backdrop);

  // board housing
  const cell = 0.6;
  const boardW = BOARD_COLS * cell + 1.2;
  const boardH = (LEDGER_ROWS + 4) * cell + 1.2;
  const housing = new THREE.Mesh(
    new THREE.PlaneGeometry(boardW, boardH),
    new THREE.MeshBasicMaterial({ color: BOARD.housing })
  );
  housing.position.set(0, (7 - (LEDGER_ROWS - 1) * cell) / 2, -0.05);
  scene.add(housing);

  const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 1000);
  const baseZ = boardH * 1.15;
  camera.position.set(0, housing.position.y, baseZ);
  camera.lookAt(0, housing.position.y, 0);

  const atlas = buildGlyphAtlas();
  // ledger sits below the 3-row header (header originY 7 → rows at 7,6.4,5.8)
  const ledger = new FlapGrid(scene, atlas, LEDGER_ROWS, BOARD_COLS, { cell, originY: 5 });
  const header = new Header(scene, atlas, { originY: 7 });
  const artPool = new LoadPool(ART_CONCURRENCY);
  const nowShowing = new NowShowing(scene, artPool, { x: boardW / 2 + 2.2 });
  const clatter = new Clatter();

  const events: SproutEvent[] = []; // newest first, capped at LEDGER_ROWS
  let ledgerDirty = false;
  let sproutsSinceFrame = 0;
  let pushZ = 0; // decaying camera push-in on a new block

  function renderLedger(instant: boolean): void {
    for (let r = 0; r < LEDGER_ROWS; r++) {
      const e = events[r];
      if (e) {
        ledger.setRow(r, rowText(e), instant);
        ledger.tintRow(r, kindAccent(e));
      } else {
        ledger.clearRow(r);
      }
    }
  }

  feed.onEvent((event) => {
    switch (event.type) {
      case "sprout":
        events.unshift(event);
        if (events.length > LEDGER_ROWS) events.pop();
        ledgerDirty = true;
        sproutsSinceFrame++;
        if (shouldShowArt(event)) nowShowing.show(event);
        break;
      case "block":
        header.setBlock(event.height, event.spendCount, event.fees);
        pushZ = 1;
        break;
      case "ambient":
        header.setAmbient(event.mempoolSize, event.netspace);
        break;
      case "reorg": {
        const before = events.length;
        for (let i = events.length - 1; i >= 0; i--) {
          if (events[i].height >= event.forkHeight) events.splice(i, 1);
        }
        if (events.length !== before) ledgerDirty = true;
        break;
      }
    }
  });

  const frameCallbacks: Array<() => void> = [];
  const timer = new THREE.Timer();
  const limiter = createFrameLimiter();
  let lastClock = 0;

  function frame(): void {
    requestAnimationFrame(frame);
    if (!limiter.shouldRender(performance.now())) return;
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.1);
    const t = timer.getElapsed();

    if (ledgerDirty) {
      const wasIdle = ledger.idle();
      renderLedger(reducedMotion || sproutsSinceFrame > FAST_FORWARD);
      ledgerDirty = false;
      if (!wasIdle || !ledger.idle()) clatter.flap(Math.min(1, sproutsSinceFrame / 6));
    }
    sproutsSinceFrame = 0;

    if (t - lastClock > 1) {
      header.tick(new Date());
      lastClock = t;
    }

    ledger.update(dt);
    header.update(dt);
    nowShowing.update(dt);

    // gentle idle parallax sway + decaying push-in on a new block
    pushZ = Math.max(0, pushZ - dt);
    const sway = reducedMotion ? 0 : Math.sin(t * 0.4) * 0.25;
    camera.position.x += (sway - camera.position.x) * Math.min(dt, 1);
    camera.position.z += (baseZ - pushZ * 4 - camera.position.z) * Math.min(dt * 2, 1);
    camera.lookAt(0, housing.position.y, 0);

    for (const fn of frameCallbacks) fn();
    renderer.render(scene, camera);
  }
  frame();

  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // toggle clatter by clicking the housing background (no row hit)
  canvas.addEventListener("dblclick", () => clatter.setEnabled(!clatter.enabled));

  return {
    camera,
    onFrame: (fn) => frameCallbacks.push(fn),
    pickables: () => [ledger.mesh],
    metaFor: (object, instanceId) =>
      object === ledger.mesh && instanceId !== undefined ? events[ledger.rowOf(instanceId)] ?? null : null,
    setHovered: (object, instanceId) =>
      ledger.highlightRow(object === ledger.mesh && instanceId !== undefined ? ledger.rowOf(instanceId) : null),
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (If the unused `BOARD.flapFace`/`flapText`/`live` trip `noUnusedLocals`, they're consumed via `BOARD` so this is fine; fix any genuine unused-import error by removing the import.)

- [ ] **Step 3: Commit**

```bash
git add web/src/themes/board/board.ts
git commit -m "feat(board): assemble scene, feed wiring, picking, fast-forward"
```

---

### Task 9: Register theme, legend, styles, docs

**Files:**
- Create: `web/src/themes/board/index.ts`
- Modify: `web/src/themes/index.ts` (add `board` to `THEMES`)
- Modify: `web/src/style.css` (add `.sw-flap`, `.sw-mint`, `.sw-gauge`, `.sw-tile`)
- Modify: `web/test/themes.test.ts` (add a board registration test)
- Modify: `CLAUDE.md` (add `board` to the themes paragraph)

**Interfaces:**
- Consumes: `Visualization` from `../types.js`; `startBoard` from `./board.js`.
- Produces: `export const board: Visualization` with id `board`, label `The Big Board`, a non-empty legend.

- [ ] **Step 1: Write the failing registration test**

Add to `web/test/themes.test.ts`:

```ts
test("board theme is registered and resolvable", () => {
  expect(THEMES.map((t) => t.id)).toContain("board");
  expect(resolveTheme("?theme=board", null).id).toBe("board");
  expect(resolveTheme("", "board").id).toBe("board");
  expect(THEMES.find((t) => t.id === "board")!.label).toBe("The Big Board");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/test/themes.test.ts`
Expected: FAIL — `board` not in `THEMES`.

- [ ] **Step 3: Create the Visualization export**

```ts
// web/src/themes/board/index.ts
import type { Visualization } from "../types.js";
import { startBoard } from "./board.js";

export const board: Visualization = {
  id: "board",
  label: "The Big Board",
  legend: [
    ["sw-flap", "row — a coin spend, newest on top"],
    ["sw-mint", "★ NEW — NFT mint"],
    ["sw-gauge", "header bar — mempool fill"],
    ["sw-tile", "side panel — latest NFT art"],
    ["sw-key", "double-click — toggle clatter"],
  ],
  start: (canvas, feed) => startBoard(canvas, feed),
};
```

- [ ] **Step 4: Register in the theme registry**

In `web/src/themes/index.ts`, add the import and append to `THEMES`:

```ts
import { board } from "./board/index.js";
// ...
export const THEMES: readonly Visualization[] = [grove, farm, gallery, mine, board];
```

- [ ] **Step 5: Add legend swatch styles**

Append to `web/src/style.css`:

```css
.sw-flap {
  width: 11px;
  height: 7px;
  border-radius: 1px;
  background: linear-gradient(to bottom, #1a1d22 0 49%, #0b0d10 51% 100%);
  box-shadow: inset 0 0 0 1px #2a2f36;
}

.sw-mint {
  background: #ffd166;
  box-shadow: 0 0 7px rgba(255, 209, 102, 0.9);
}

.sw-gauge {
  width: 13px;
  height: 7px;
  background: linear-gradient(to right, #3ad17a 0 55%, #1a1d22 55% 100%);
}

.sw-tile {
  background: #0b0d10;
  box-shadow: inset 0 0 0 1px #444, 0 0 4px rgba(244, 234, 210, 0.4);
}
```

(`.sw-key` already exists from the gallery legend and needs no change.)

- [ ] **Step 6: Run the full test suite + typecheck + lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green; `themes.test.ts` board test passes.

- [ ] **Step 7: Manual verification in demo mode**

Run: `npm run dev:web`, open `http://localhost:5173/?demo=1&theme=board`. Confirm:
- the board fills with riffling rows, newest at top, header showing block/mempool/netspace/clock;
- NFT mints flip in a `★ NEW` row and update the side art tile;
- hovering a row brightens it and opens the detail card; clicking pins it;
- double-click toggles clatter (sound starts after the gesture);
- switching scene to "The Big Board" from the legend dropdown persists and replays.

- [ ] **Step 8: Update CLAUDE.md**

In `CLAUDE.md`, in the Web/scene internals section, change "Four themes ship: `grove`, `farm`, `gallery`, `mine`." to include `board`, and add a one-line description paragraph mirroring the others:

```md
- **board** (`web/src/themes/board/`): "The Big Board" — a Solari split-flap departure board rendering the chain as a live spend ledger. Each spend flips in as a new row (per-character riffle via `FlapGrid`, an instanced cell grid with a per-instance glyph attribute); a header strip shows block/mempool/netspace/clock, a side tile shows the latest NFT mint's art, and reorg riffles rows back to the fork height. Pure formatting (`rows.ts`, `glyphs.ts`, `palette.ts`) is unit-tested.
```

- [ ] **Step 9: Commit**

```bash
git add web/src/themes/board/index.ts web/src/themes/index.ts web/src/style.css web/test/themes.test.ts CLAUDE.md
git commit -m "feat(board): register The Big Board theme + legend, styles, docs"
```

---

## Self-Review

**Spec coverage:**
- Live spend ledger, newest-on-top, oldest falls off → Task 8 `events` ring + `renderLedger`. ✓
- Per-character riffle (squash-swap, column stagger) → Task 4 `FlapGrid`. ✓
- Glyph atlas + per-instance UV via custom shader → Task 2 atlas + Task 4 `ShaderMaterial`/`aGlyph`. ✓
- Pure, testable `rows.ts` + `glyphs.ts` (+ `palette.kindAccent`, `header.mempoolGauge`, `nowshowing.shouldShowArt`) → Tasks 1,2,3,5,6. ✓
- Header strip: height, mempool gauge, netspace, clock → Task 5. ✓
- Event mapping: sprout/block/ambient/reorg → Task 8 `feed.onEvent`. ✓
- Reorg rolls rows back to fork height → Task 8 reorg case. ✓
- Fast-forward during snapshot backlog; reduced-motion instant → Task 8 `FAST_FORWARD`/`reducedMotion`. ✓
- NOW SHOWING NFT tile via `/img` proxy + `LoadPool` → Task 6. ✓
- Default-muted clatter with toggle, gesture-gated → Task 7 + Task 8 dblclick + Task 9 legend. ✓
- Camera head-on with idle sway + block push-in → Task 8 frame loop. ✓
- Picking via shared picker (`pickables`/`metaFor`/`setHovered`, `selfManagedInput` false) → Task 8 returned handle. ✓
- Registry + legend + CSS + docs → Task 9. ✓
- Note: the spec's "thin separator row flips in" on each block is realized as the header's BLOCK banner re-stamp (Task 5 `setBlock`), not a separate moving row — intentional simplification, no moving separator in the ledger.

**Placeholder scan:** no TBD/TODO; every code step shows complete code; every test step shows assertions. ✓

**Type consistency:** `FlapGrid` API (`setRow`/`clearRow`/`tintRow`/`highlightRow`/`update`/`rowOf`/`idle`/`mesh`/`rows`/`cols`) is consistent across Tasks 4, 5, 8. `rowText`/`BOARD_COLS` (Task 3) used in Tasks 5, 8. `kindAccent`/`BOARD` (Task 1) used in Task 8. `shouldShowArt` (Task 6) used in Task 8. `mediaSrc`/`LoadPool` signatures match the real modules read from the codebase. ✓
