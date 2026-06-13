# Mobile Responsiveness Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three contained mobile usability fixes — a larger scene-selector tap target, a collapsible block console (hidden by default on phones), and swipe-to-browse in the gallery theme.

**Architecture:** Pure CSS for the selector; `BlockConsole` gains the legend's collapse-toggle pattern (persisted to `localStorage`, default-collapsed under 640px); the gallery gets a swipe gesture wired at `pointerup`, with the swipe-vs-pan-vs-tap decision extracted into a pure, unit-tested `classifySwipe` helper in a new `swipe.ts` module.

**Tech Stack:** TypeScript, Three.js, Vite, vitest. Spec: `docs/superpowers/specs/2026-06-13-mobile-responsiveness-design.md`.

---

## File structure

- `web/src/style.css` — selector media query; console toggle styling + fade-selector retarget.
- `web/src/ui/console.ts` — `BlockConsole` header/body restructure + collapse toggle.
- `web/src/themes/gallery/swipe.ts` — **new** pure `classifySwipe` helper + thresholds.
- `web/test/gallery-swipe.test.ts` — **new** unit tests for `classifySwipe`.
- `web/src/themes/gallery/gallery.ts` — capture `downT`/`panStartX`; wire swipe at `pointerup`.
- `web/src/themes/gallery/index.ts` — device-aware legend hint label.

`web/src/main.ts` is unchanged — `BlockConsole` self-initializes its DOM.

---

## Task 1: Scene selector — mobile tap target & text size

**Files:**
- Modify: `web/src/style.css` (append a media query)

- [ ] **Step 1: Add the mobile selector rule**

Append to the end of `web/src/style.css`:

```css
@media (max-width: 640px) {
  #legend-scene select {
    font-size: 16px; /* >=16px stops iOS Safari focus-zoom; enlarges Android option list */
    padding: 4px 8px;
  }
}
```

- [ ] **Step 2: Verify lint + typecheck stay clean**

Run: `npm run lint && npm run typecheck`
Expected: both exit 0 (CSS is not type-checked; this confirms nothing else broke).

- [ ] **Step 3: Commit**

```bash
git add web/src/style.css
git commit -m "feat(web): enlarge scene selector on mobile"
```

---

## Task 2: Console — collapsible, mirroring the legend

**Files:**
- Modify: `web/src/ui/console.ts` (full rewrite of the `BlockConsole` class; `formatBlockLine`/`BlockAgg` unchanged)
- Modify: `web/src/style.css` (`#console-toggle` rule; retarget fade selectors to `#console-body`)
- Test: `web/test/console.test.ts` (existing — must still pass; covers `formatBlockLine` only)

- [ ] **Step 1: Rewrite `web/src/ui/console.ts`**

Replace the entire file with:

```ts
import type { GroveEvent } from "@grove/shared";
import { mojosToXch } from "./format.js";

const MAX_LINES = 6;
const COLLAPSED_KEY = "grove.console.collapsed";

export interface BlockAgg {
  height: number;
  spendCount: number;
  cat: number;
  nft: number;
  did: number;
  fees: string; // mojos
}

export function formatBlockLine(agg: BlockAgg): string {
  const parts = [
    `#${agg.height}`,
    `${agg.spendCount} ${agg.spendCount === 1 ? "spend" : "spends"}`,
  ];
  for (const kind of ["cat", "nft", "did"] as const) {
    if (agg[kind] > 0) parts.push(`${agg[kind]} ${kind}`);
  }
  if (agg.fees !== "0") parts.push(`${mojosToXch(agg.fees)} XCH fees`);
  return parts.join(" · ");
}

/**
 * Scrolling block log: one line per block, newest on top. Sprout events
 * arriving after their block tick the asset counts up live. The log can be
 * collapsed (toggle persisted to localStorage; defaults collapsed on phones).
 */
export class BlockConsole {
  private readonly aggs = new Map<number, { agg: BlockAgg; line: HTMLElement }>();
  private readonly toggle: HTMLButtonElement;
  private readonly body: HTMLElement;
  private collapsed: boolean;

  constructor(private readonly root: HTMLElement) {
    this.toggle = document.createElement("button");
    this.toggle.id = "console-toggle";
    this.toggle.type = "button";

    this.body = document.createElement("div");
    this.body.id = "console-body";

    const stored = localStorage.getItem(COLLAPSED_KEY);
    this.collapsed =
      stored === null ? matchMedia("(max-width: 640px)").matches : stored === "1";

    this.toggle.addEventListener("click", () => {
      this.collapsed = !this.collapsed;
      localStorage.setItem(COLLAPSED_KEY, this.collapsed ? "1" : "0");
      this.render();
    });

    root.append(this.toggle, this.body);
    this.render();
  }

  private render(): void {
    this.body.hidden = this.collapsed;
    this.toggle.textContent = this.collapsed ? "▤" : "log ✕";
    this.root.classList.toggle("collapsed", this.collapsed);
  }

  handle(event: GroveEvent): void {
    switch (event.type) {
      case "block": {
        const agg: BlockAgg = {
          height: event.height,
          spendCount: event.spendCount,
          cat: 0,
          nft: 0,
          did: 0,
          fees: event.fees,
        };
        const line = this.prependLine(formatBlockLine(agg));
        this.aggs.set(event.height, { agg, line });
        break;
      }
      case "sprout": {
        if (event.kind === "xch") return; // counted in spendCount already
        const entry = this.aggs.get(event.height);
        if (!entry) return;
        entry.agg[event.kind] += 1;
        entry.line.textContent = formatBlockLine(entry.agg);
        break;
      }
      case "reorg": {
        const line = this.prependLine(`⟲ reorg → #${event.forkHeight}`);
        line.classList.add("reorg");
        break;
      }
    }
  }

  private prependLine(text: string): HTMLElement {
    const line = document.createElement("div");
    line.textContent = text;
    this.body.prepend(line);
    while (this.body.children.length > MAX_LINES) {
      const last = this.body.lastElementChild!;
      for (const [height, entry] of this.aggs) {
        if (entry.line === last) this.aggs.delete(height);
      }
      last.remove();
    }
    this.root.hidden = false;
    return line;
  }
}
```

- [ ] **Step 2: Retarget the console fade selectors in `web/src/style.css`**

Find this block:

```css
#console > div:nth-child(2) {
  opacity: 0.75;
}
#console > div:nth-child(3) {
  opacity: 0.55;
}
#console > div:nth-child(4) {
  opacity: 0.4;
}
#console > div:nth-child(5) {
  opacity: 0.28;
}
#console > div:nth-child(6) {
  opacity: 0.18;
}
```

Replace it with (only the selector prefix changes — lines now live in `#console-body`):

```css
#console-body > div:nth-child(2) {
  opacity: 0.75;
}
#console-body > div:nth-child(3) {
  opacity: 0.55;
}
#console-body > div:nth-child(4) {
  opacity: 0.4;
}
#console-body > div:nth-child(5) {
  opacity: 0.28;
}
#console-body > div:nth-child(6) {
  opacity: 0.18;
}
```

(`#console .reorg` is a descendant selector and keeps matching — leave it.)

- [ ] **Step 3: Add the console toggle styling in `web/src/style.css`**

Immediately after the `#console { ... }` rule (before the fade selectors), add:

```css
#console-toggle {
  display: block;
  width: 100%;
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  color: #eafff2;
  text-align: right;
  letter-spacing: 0.08em;
  cursor: pointer;
  pointer-events: auto; /* console root is pointer-events:none; toggle must be tappable */
}
```

- [ ] **Step 4: Run the existing console tests**

Run: `npx vitest run web/test/console.test.ts`
Expected: PASS (4 tests — `formatBlockLine` is unchanged).

- [ ] **Step 5: Verify lint + typecheck**

Run: `npm run lint && npm run typecheck`
Expected: both exit 0.

- [ ] **Step 6: Manual check**

Open `http://localhost:5173/?demo=1`. Confirm: a `log ✕` header appears bottom-right once blocks arrive, clicking it collapses to `▤` and back, and reloading preserves the state. In DevTools device mode (≤640px) with a cleared `localStorage`, confirm it starts collapsed.

- [ ] **Step 7: Commit**

```bash
git add web/src/ui/console.ts web/src/style.css
git commit -m "feat(web): collapsible block console, hidden by default on phones"
```

---

## Task 3: Gallery swipe — `classifySwipe` pure helper (TDD)

**Files:**
- Create: `web/src/themes/gallery/swipe.ts`
- Test: `web/test/gallery-swipe.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/test/gallery-swipe.test.ts`:

```ts
import { expect, test } from "vitest";
import { classifySwipe } from "../src/themes/gallery/swipe.js";

test("short horizontal movement is not a swipe", () => {
  expect(classifySwipe(20, 2, 0.1)).toBe(0);
});

test("vertical-dominant movement is not a swipe", () => {
  expect(classifySwipe(40, 60, 0.1)).toBe(0);
});

test("too-slow horizontal movement is not a swipe", () => {
  expect(classifySwipe(80, 5, 0.6)).toBe(0);
});

test("fast swipe right jumps toward older pieces (-1)", () => {
  expect(classifySwipe(80, 5, 0.2)).toBe(-1);
});

test("fast swipe left jumps toward newer pieces (+1)", () => {
  expect(classifySwipe(-80, 5, 0.2)).toBe(1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run web/test/gallery-swipe.test.ts`
Expected: FAIL — cannot resolve `../src/themes/gallery/swipe.js` / `classifySwipe` is not defined.

- [ ] **Step 3: Implement `web/src/themes/gallery/swipe.ts`**

```ts
/** Horizontal-flick thresholds separating a discrete "browse" swipe from a slow pan. */
export const SWIPE_DIST = 35; // px of horizontal travel required
export const SWIPE_TIME = 0.4; // seconds; longer than this is a deliberate pan, not a flick

/**
 * Classify a finished pointer gesture into a discrete column-jump direction.
 * Returns -1 (swipe right → older pieces), +1 (swipe left → newer pieces),
 * or 0 (not a swipe — caller keeps the existing freeform-pan result).
 *
 * The sign matches the arrow keys (ArrowLeft = -1) and the drag grab metaphor:
 * pulling the wall to the right reveals older pieces.
 */
export function classifySwipe(dx: number, dy: number, dt: number): -1 | 0 | 1 {
  if (Math.abs(dx) < SWIPE_DIST) return 0;
  if (Math.abs(dx) <= Math.abs(dy)) return 0; // must be horizontal-dominant
  if (dt > SWIPE_TIME) return 0;
  return dx > 0 ? -1 : 1;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run web/test/gallery-swipe.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/themes/gallery/swipe.ts web/test/gallery-swipe.test.ts
git commit -m "feat(web): classifySwipe helper for gallery browse gesture"
```

---

## Task 4: Wire swipe into gallery + device-aware legend hint

**Files:**
- Modify: `web/src/themes/gallery/gallery.ts` (import helper; capture `downT`/`panStartX`; handle swipe at `pointerup`)
- Modify: `web/src/themes/gallery/index.ts` (coarse-pointer hint label)

- [ ] **Step 1: Import the helper in `web/src/themes/gallery/gallery.ts`**

Add near the other gallery imports (the file already imports `THREE` and sibling modules):

```ts
import { classifySwipe } from "./swipe.js";
```

- [ ] **Step 2: Add gesture-start state in `gallery.ts`**

Find the pointer-input state declarations:

```ts
  const DRAG_THRESHOLD = 6; // px before a press counts as a pan, not a tap
  let downX = 0;
  let downY = 0;
  let lastX = 0;
  let dragging = false;
```

Replace with (adds `downT` and `panStartX`):

```ts
  const DRAG_THRESHOLD = 6; // px before a press counts as a pan, not a tap
  let downX = 0;
  let downY = 0;
  let lastX = 0;
  let dragging = false;
  let downT = 0; // gesture start time (clock seconds) — for swipe-velocity classification
  let panStartX = 0; // camera-x at gesture start — swipe jumps from here, ignoring mid-flick pan
```

- [ ] **Step 3: Record the gesture start in the `pointerdown` handler**

Find:

```ts
  canvas.addEventListener("pointerdown", (e) => {
    downX = lastX = e.clientX;
    downY = e.clientY;
    dragging = false;
    manualX = camera.position.x; // seed manual control from where the view is now
    canvas.setPointerCapture?.(e.pointerId);
  });
```

Replace with:

```ts
  canvas.addEventListener("pointerdown", (e) => {
    downX = lastX = e.clientX;
    downY = e.clientY;
    dragging = false;
    downT = nowT;
    panStartX = camera.position.x;
    manualX = camera.position.x; // seed manual control from where the view is now
    canvas.setPointerCapture?.(e.pointerId);
  });
```

- [ ] **Step 4: Handle the swipe in the `pointerup` handler**

Find:

```ts
  canvas.addEventListener("pointerup", (e) => {
    canvas.releasePointerCapture?.(e.pointerId);
    if (dragging) {
      dragging = false;
      return; // a pan, not a tap
    }
    const hit = pick(e.clientX, e.clientY);
    if (hit) focus(hit);
    else unfocus();
  });
```

Replace with:

```ts
  canvas.addEventListener("pointerup", (e) => {
    canvas.releasePointerCapture?.(e.pointerId);
    if (dragging) {
      dragging = false;
      // a fast horizontal flick browses a discrete column (touch equivalent of the
      // arrow keys); jump from panStartX so the mid-flick freeform pan isn't double-counted
      const dir = classifySwipe(e.clientX - downX, e.clientY - downY, nowT - downT);
      if (dir !== 0) {
        manualX = clampPan(panStartX + dir * WALL.colStep * 2);
        manualUntil = nowT + IDLE_RESUME_S;
      }
      return; // a drag (pan or swipe), not a tap
    }
    const hit = pick(e.clientX, e.clientY);
    if (hit) focus(hit);
    else unfocus();
  });
```

- [ ] **Step 5: Make the legend hint device-aware in `web/src/themes/gallery/index.ts`**

Replace the entire file with:

```ts
import type { Visualization } from "../types.js";
import { startGallery } from "./gallery.js";

// touch devices browse by swipe; pointer devices by arrow keys
const coarsePointer =
  typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

export const gallery: Visualization = {
  id: "gallery",
  label: "gallery",
  legend: [
    ["sw-canvas", "framed piece — NFT mint"],
    ["sw-spotlight", "light warmth — netspace"],
    ["sw-breath", "light pulse — new block"],
    ["sw-reorg", "pieces removed — reorg"],
    ["sw-key", coarsePointer ? "swipe ← → — browse pieces" : "← → keys — browse pieces"],
  ],
  start: (canvas, feed) => startGallery(canvas, feed),
};
```

- [ ] **Step 6: Verify lint + typecheck + full test run**

Run: `npm run lint && npm run typecheck && npm test`
Expected: all exit 0; vitest reports all tests passing (including the new `gallery-swipe` suite).

- [ ] **Step 7: Manual check**

Open `http://localhost:5173/?demo=1&theme=gallery` in DevTools device mode (touch emulation). Confirm: a slow drag still pans freely; a quick horizontal flick jumps to an adjacent column; a tap still focuses/unfocuses a piece. With touch emulation on, the legend hint reads "swipe ← → — browse pieces"; without it, "← → keys — browse pieces".

- [ ] **Step 8: Commit**

```bash
git add web/src/themes/gallery/gallery.ts web/src/themes/gallery/index.ts
git commit -m "feat(web): swipe to browse the gallery wall on touch"
```

---

## Self-review notes

- **Spec coverage:** §1 selector → Task 1; §2 console (restructure, collapse, persist, mobile default, CSS) → Task 2; §3 gallery swipe (classify helper, pointerup wiring, panStartX/downT capture, legend hint) → Tasks 3–4. Testing seam (`classifySwipe` unit tests) → Task 3.
- **Deviation from spec:** `classifySwipe` lives in a dedicated `swipe.ts` (not exported from `gallery.ts`) so the node test env doesn't import Three/WebGL module side effects — consistent with the gallery's existing focused-submodule pattern.
- **Type/name consistency:** `classifySwipe(dx, dy, dt) → -1 | 0 | 1` is defined in Task 3 and called identically in Task 4. `WALL.colStep`, `IDLE_RESUME_S`, `clampPan`, `manualX`, `manualUntil`, `nowT` are all already in scope in `startGallery` (used by the existing keydown handler). `COLLAPSED_KEY` for the console (`grove.console.collapsed`) is distinct from the legend's `grove.legend.collapsed`.
- **No placeholders:** every code step shows complete code.
```
