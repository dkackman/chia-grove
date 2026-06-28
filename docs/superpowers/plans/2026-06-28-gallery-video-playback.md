# Gallery Video Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the gallery theme, show a centered ▶/⏸ button when a focused NFT is video-backed, so the user can manually play the clip in place on the wall (muted, looping) and pause/leave to return to the still poster frame.

**Architecture:** A pure `playback.ts` module owns the muted/loop/reset semantics over a minimal video interface (unit-tested). A `Pieces.videoFor()` accessor exposes a focused piece's `<video>` element only when it is video-backed (so blocked/sensitive placeholder pieces never expose a playable element). A `PlayButton$` DOM class (parallel to the existing `Placard$`) drives that element from a body-level button. `gallery.ts` wires `videoFor` → `playButton.show/hide` into its existing `focus`/`unfocus`.

**Tech Stack:** TypeScript, three.js 0.184 (`THREE.VideoTexture` auto-uploads via `requestVideoFrameCallback`), Vitest (node environment, no jsdom), Vite, plain DOM + CSS.

## Global Constraints

- Node ≥ 24; this is a `web` workspace change only (`@grove/web`).
- Playback is **always muted** — the `<video>` is never unmuted.
- Playback **only ever starts from a click** — never autoplayed.
- Vitest runs in the node environment with **no jsdom/document**, so DOM classes are not unit-tested (consistent with `Placard$`); only pure logic and `THREE`-object logic are tested.
- Follow existing gallery patterns: theme-owned DOM controls appended to `document.body` (see `Placard$`), duck-typed video detection (see `Pieces.retire()`), pure-logic modules split for testability (see `material.ts`).
- Tests run with `npx vitest run <file>`; full suite `npm test`; types `npm run typecheck`; lint `npm run lint`; prod bundle `npm run build`.

---

### Task 1: Pure playback module + media.ts single-source-of-truth

**Files:**
- Create: `web/src/themes/gallery/playback.ts`
- Create (test): `web/test/gallery-playback.test.ts`
- Modify: `web/src/themes/gallery/media.ts:45-46` (use shared `POSTER_TIME` instead of inlined `0.1`)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export interface PlayableVideo { muted: boolean; loop: boolean; currentTime: number; play(): Promise<void> | void; pause(): void; }`
  - `export const POSTER_TIME = 0.1;`
  - `export function startPlayback(video: PlayableVideo): Promise<void> | void;`
  - `export function stopPlayback(video: PlayableVideo): void;`

- [ ] **Step 1: Write the failing test**

Create `web/test/gallery-playback.test.ts`:

```ts
import { expect, test, vi } from "vitest";
import {
  startPlayback,
  stopPlayback,
  POSTER_TIME,
  type PlayableVideo,
} from "../src/themes/gallery/playback.js";

function fakeVideo(): PlayableVideo & {
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
} {
  return {
    muted: false,
    loop: false,
    currentTime: 0,
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(),
  };
}

test("startPlayback keeps the video muted, loops it, and plays", () => {
  const v = fakeVideo();
  startPlayback(v);
  expect(v.muted).toBe(true);
  expect(v.loop).toBe(true);
  expect(v.play).toHaveBeenCalledTimes(1);
});

test("startPlayback returns play()'s promise so a rejected gesture can be caught", async () => {
  const v = fakeVideo();
  v.play = vi.fn(() => Promise.reject(new Error("blocked")));
  await expect(Promise.resolve(startPlayback(v))).rejects.toThrow("blocked");
});

test("stopPlayback pauses, clears loop, and resets to the poster frame", () => {
  const v = fakeVideo();
  v.loop = true;
  v.currentTime = 5;
  stopPlayback(v);
  expect(v.pause).toHaveBeenCalledTimes(1);
  expect(v.loop).toBe(false);
  expect(v.currentTime).toBe(POSTER_TIME);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/test/gallery-playback.test.ts`
Expected: FAIL — cannot resolve `../src/themes/gallery/playback.js` (module not found).

- [ ] **Step 3: Write minimal implementation**

Create `web/src/themes/gallery/playback.ts`:

```ts
/**
 * DOM-free playback control for a gallery video piece, kept separate from the
 * play button so the muted/loop/reset semantics are unit-testable with a fake
 * video (mirrors material.ts being split from cats.ts). The video element these
 * helpers receive is the same one a THREE.VideoTexture wraps, so starting it
 * animates the wall and resetting it returns the wall to the still poster frame.
 */

/** The slice of HTMLVideoElement these helpers touch — lets tests pass a fake. */
export interface PlayableVideo {
  muted: boolean;
  loop: boolean;
  currentTime: number;
  play(): Promise<void> | void;
  pause(): void;
}

// The small offset the poster frame is seeked to in media.ts; shared so a reset
// returns to exactly that frame. A seek to 0 can be treated as a no-op, hence
// the nudge a hair into the clip.
export const POSTER_TIME = 0.1;

/**
 * Begin user-initiated playback: stay muted (sound is never enabled), loop, and
 * play. Returns play()'s result so the caller can revert its UI if the browser
 * rejects the gesture.
 */
export function startPlayback(video: PlayableVideo): Promise<void> | void {
  video.muted = true;
  video.loop = true;
  return video.play();
}

/**
 * Stop and reset to the poster frame: pause, clear loop, and seek back to the
 * poster offset so the wall shows the still again (three's VideoTexture
 * re-uploads the seeked frame via requestVideoFrameCallback).
 */
export function stopPlayback(video: PlayableVideo): void {
  video.pause();
  video.loop = false;
  video.currentTime = POSTER_TIME;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run web/test/gallery-playback.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Point media.ts at the shared constant (no behavior change)**

In `web/src/themes/gallery/media.ts`, add the import near the top (after the existing `import` on line 2):

```ts
import { POSTER_TIME } from "./playback.js";
```

Then change the seek target (currently lines 45-46):

```ts
      const d = video.duration;
      const target = Number.isFinite(d) && d > 0 ? Math.min(0.1, d / 2) : 0.1;
```

to:

```ts
      const d = video.duration;
      const target = Number.isFinite(d) && d > 0 ? Math.min(POSTER_TIME, d / 2) : POSTER_TIME;
```

- [ ] **Step 6: Run the existing media test + typecheck to confirm no regression**

Run: `npx vitest run web/test/gallery-media.test.ts && npm run typecheck`
Expected: PASS (media tests green; typecheck clean — `POSTER_TIME` is `0.1`, so behavior is identical).

- [ ] **Step 7: Commit**

```bash
git add web/src/themes/gallery/playback.ts web/test/gallery-playback.test.ts web/src/themes/gallery/media.ts
git commit -m "feat(gallery): pure video playback helpers + shared POSTER_TIME"
```

---

### Task 2: `Pieces.videoFor()` accessor

**Files:**
- Modify: `web/src/themes/gallery/pieces.ts` (add `videoFor` method near `metaFor`, around line 182-185)
- Test: `web/test/gallery-pieces.test.ts` (add a test; reuse existing `mint`, `id`, `Pieces` imports)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `videoFor(object: THREE.Object3D): HTMLVideoElement | null` on `Pieces` — returns the `<video>` backing the piece under `object`, or `null` for an image/placeholder piece or an unknown/retired object. Used by Task 4.

- [ ] **Step 1: Write the failing test**

Add to `web/test/gallery-pieces.test.ts` (it already imports `THREE`, `vi`, `Pieces`, and defines `mint`/`id`):

```ts
test("videoFor returns the backing <video> for a video piece, null otherwise", () => {
  const pieces = new Pieces(new THREE.Scene(), 28);

  const fakeVideo = { play: vi.fn(), pause: vi.fn() };
  const videoTex = new THREE.Texture();
  videoTex.image = fakeVideo; // stand in for a VideoTexture's <video> element
  pieces.add(mint(id(1)), videoTex);

  pieces.add(mint(id(2)), new THREE.Texture()); // image piece — no video-like image

  const forCoin = (coin: string) =>
    pieces.pickables().find((o) => pieces.metaFor(o)?.coinId === coin)!;

  expect(pieces.videoFor(forCoin(id(1)))).toBe(fakeVideo);
  expect(pieces.videoFor(forCoin(id(2)))).toBeNull();
  expect(pieces.videoFor(new THREE.Mesh())).toBeNull(); // unknown object
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/test/gallery-pieces.test.ts -t videoFor`
Expected: FAIL — `pieces.videoFor is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `web/src/themes/gallery/pieces.ts`, add this method directly after `metaFor()` (after line 185):

```ts
  /**
   * The <video> element backing the piece under this object, or null when the
   * piece is image- or placeholder-backed. Blocked/sensitive pieces hang a
   * placeholder texture (never a video), so they return null and can never be
   * played. Duck-types on a `play` function, matching retire()'s video handling.
   */
  videoFor(object: THREE.Object3D): HTMLVideoElement | null {
    const slotId = this.byObject.get(object);
    if (slotId === undefined) return null;
    const piece = this.slots[slotId];
    if (!piece) return null;
    const img = (piece.image.material as THREE.MeshBasicMaterial).map?.image as
      | { play?: unknown }
      | undefined;
    return img && typeof img.play === "function" ? (img as HTMLVideoElement) : null;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run web/test/gallery-pieces.test.ts`
Expected: PASS (all existing piece tests + the new `videoFor` test).

- [ ] **Step 5: Commit**

```bash
git add web/src/themes/gallery/pieces.ts web/test/gallery-pieces.test.ts
git commit -m "feat(gallery): Pieces.videoFor() exposes a focused piece's <video>"
```

---

### Task 3: `PlayButton$` DOM control

**Files:**
- Create: `web/src/themes/gallery/play-button.ts`

No unit test — this is a DOM class with no jsdom in the test env (consistent with `Placard$`, whose DOM class is untested while its pure `placardModel` is tested). Verified by `typecheck` + `lint` here and exercised manually in Task 4.

**Interfaces:**
- Consumes: `startPlayback`, `stopPlayback` from `./playback.js` (Task 1). `HTMLVideoElement` structurally satisfies `PlayableVideo`, so no cast is needed at the call sites.
- Produces: `class PlayButton$` with `constructor()`, `show(video: HTMLVideoElement): void`, `hide(): void`, `dispose(): void`. Used by Task 4.

- [ ] **Step 1: Write the implementation**

Create `web/src/themes/gallery/play-button.ts`:

```ts
import { startPlayback, stopPlayback } from "./playback.js";

/**
 * A theme-owned DOM play/pause button for a focused video piece, parallel to
 * Placard$. Created once and shown/hidden as video pieces gain or lose focus.
 * The bound <video> is the element a THREE.VideoTexture wraps, so toggling it
 * animates the art on the wall. Playback is always muted and only ever starts
 * from a click — never autoplayed; leaving focus (hide) resets the wall to the
 * poster still. The glyph tracks the video's own play/pause/ended events so it
 * stays correct even if a loop ends or the element is paused elsewhere.
 */
export class PlayButton$ {
  private el: HTMLButtonElement;
  private video: HTMLVideoElement | null = null;
  private onState = (): void => this.syncGlyph();

  constructor() {
    this.el = document.createElement("button");
    this.el.type = "button";
    this.el.className = "gallery-play";
    this.el.hidden = true;
    this.el.addEventListener("click", () => this.toggle());
    document.body.appendChild(this.el);
  }

  /** Bind a focused piece's <video> and reveal the button in its paused state. */
  show(video: HTMLVideoElement): void {
    if (this.video === video) return;
    this.unbind();
    this.video = video;
    video.addEventListener("play", this.onState);
    video.addEventListener("pause", this.onState);
    video.addEventListener("ended", this.onState);
    this.syncGlyph();
    this.el.hidden = false;
    this.el.classList.add("visible");
  }

  /** Hide the button and reset the bound video to the poster still. */
  hide(): void {
    this.unbind();
    this.el.classList.remove("visible");
    this.el.hidden = true;
  }

  private unbind(): void {
    const v = this.video;
    if (!v) return;
    v.removeEventListener("play", this.onState);
    v.removeEventListener("pause", this.onState);
    v.removeEventListener("ended", this.onState);
    stopPlayback(v);
    this.video = null;
  }

  private toggle(): void {
    const v = this.video;
    if (!v) return;
    if (v.paused) {
      const p = startPlayback(v);
      // a rejected gesture (autoplay policy) leaves the video paused — keep ▶
      if (p && typeof p.then === "function") p.then(undefined, () => this.syncGlyph());
    } else {
      // plain pause (no reset) — only hide() snaps back to the poster frame
      v.pause();
    }
    this.syncGlyph();
  }

  private syncGlyph(): void {
    const playing = this.video ? !this.video.paused : false;
    this.el.textContent = playing ? "⏸" : "▶";
    this.el.setAttribute("aria-label", playing ? "pause video" : "play video");
  }

  dispose(): void {
    this.hide();
    this.el.remove();
  }
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS — no type or lint errors. (`HTMLVideoElement` satisfies `PlayableVideo`; the file is referenced by no one yet, which is fine.)

- [ ] **Step 3: Commit**

```bash
git add web/src/themes/gallery/play-button.ts
git commit -m "feat(gallery): PlayButton\$ DOM play/pause control for video pieces"
```

---

### Task 4: Wire into the gallery + CSS

**Files:**
- Modify: `web/src/themes/gallery/gallery.ts` (import `PlayButton$`; construct it; call in `focus`/`unfocus`)
- Modify: `web/src/style.css` (add `.gallery-play`)

**Interfaces:**
- Consumes: `PlayButton$` (Task 3) and `Pieces.videoFor` (Task 2).
- Produces: the user-visible feature. No new exports.

- [ ] **Step 1: Import and construct the button**

In `web/src/themes/gallery/gallery.ts`, add the import alongside the other gallery imports (e.g. after the `Placard$` import on line 11):

```ts
import { PlayButton$ } from "./play-button.js";
```

Then construct it right after `const placard = new Placard$();` (line 67):

```ts
  const placard = new Placard$();
  const playButton = new PlayButton$();
```

- [ ] **Step 2: Show/hide the button on focus/unfocus**

Replace the existing `focus` function (lines 170-177):

```ts
  function focus(object: THREE.Object3D): void {
    const f = pieces.focusOf(object);
    if (!f) return;
    focused = framePiece(f.center, f.height, FOV);
    focusedObject = object;
    const meta = pieces.metaFor(object);
    if (meta) placard.show(meta, pieces.eventCountFor(object));
  }
```

with:

```ts
  function focus(object: THREE.Object3D): void {
    const f = pieces.focusOf(object);
    if (!f) return;
    focused = framePiece(f.center, f.height, FOV);
    focusedObject = object;
    const meta = pieces.metaFor(object);
    if (meta) placard.show(meta, pieces.eventCountFor(object));
    // a video piece gets a manual ▶ overlay (never autoplayed); images do not
    const video = pieces.videoFor(object);
    if (video) playButton.show(video);
    else playButton.hide();
  }
```

Replace the existing `unfocus` function (lines 179-183):

```ts
  function unfocus(): void {
    focused = null;
    focusedObject = null;
    placard.hide();
  }
```

with:

```ts
  function unfocus(): void {
    focused = null;
    focusedObject = null;
    placard.hide();
    playButton.hide(); // pauses + resets the video to its poster still
  }
```

(No further teardown is needed: the frame loop's existing auto-unfocus at line 276 fires when the focused piece is reorg-removed or wrapped off, and `Pieces.retire()` already pauses/releases the `<video>`, so `playButton.hide()`'s `stopPlayback` against a released element is a harmless no-op.)

- [ ] **Step 3: Add the CSS**

Append to `web/src/style.css` (after the `.gallery-label` block, e.g. after line ~460):

```css
/* play/pause button over a focused video piece. framePiece() centers the
   focused piece on screen, so the button is simply screen-centered. Styled
   after .label-info so it reads as part of the same gallery UI. */
.gallery-play {
  position: fixed;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%) scale(0.9);
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  border-radius: 999px;
  font-size: 26px;
  line-height: 1;
  color: #e8e4dc;
  background: rgba(10, 11, 14, 0.82);
  border: 1px solid rgba(255, 233, 194, 0.22);
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition:
    opacity 0.3s ease,
    transform 0.3s ease,
    border-color 0.2s ease;
}
.gallery-play.visible {
  opacity: 1;
  transform: translate(-50%, -50%) scale(1);
  pointer-events: auto;
}
.gallery-play:hover {
  border-color: rgba(255, 233, 194, 0.5);
}
```

- [ ] **Step 4: Typecheck, lint, full test suite, build**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: all PASS — types clean, lint clean, full vitest suite green (including the new playback + videoFor tests), production bundle builds.

- [ ] **Step 5: Manual verification**

Run: `npm run dev:web` and open `http://localhost:5173/?theme=gallery` against a running server (or `?theme=gallery&demo=1` for synthetic events). Verify:
- Tapping a still-image NFT shows the placard but **no** play button.
- Tapping a video NFT shows a centered ▶ over the art; clicking it plays the clip on the wall (no sound) and the glyph becomes ⏸; clicking again pauses.
- Pressing Escape / tapping empty space / tapping a different piece hides the button and the video stops (the wall returns to the poster still).

(If a video NFT is hard to find live, the demo feed's synthetic art exercises the still path; video confirmation may need a live mint — note it in the PR if unverifiable locally.)

- [ ] **Step 6: Commit**

```bash
git add web/src/themes/gallery/gallery.ts web/src/style.css
git commit -m "feat(gallery): show a manual play button on focused video NFTs"
```

---

## Self-Review

**Spec coverage:**
- Behavior (▶ on focused video, in-place wall playback, ⏸ toggle, reset on unfocus) → Tasks 2, 3, 4. ✓
- `Pieces.videoFor` → Task 2. ✓
- `playback.ts` (`startPlayback`/`stopPlayback`/`POSTER_TIME`) → Task 1. ✓
- `media.ts` uses `POSTER_TIME` → Task 1 Step 5. ✓
- `PlayButton$` → Task 3. ✓
- `gallery.ts` wiring → Task 4 Steps 1-2. ✓
- `.gallery-play` CSS → Task 4 Step 3. ✓
- Tests (`gallery-playback.test.ts`, `videoFor` in `gallery-pieces.test.ts`) → Tasks 1, 2. ✓
- Filtered-content safety (placeholder pieces return `null` from `videoFor`) → Task 2 implementation + comment, exercised by the image-piece assertion. ✓
- Muted-always / no-autoplay / reset-to-poster → Task 1 (`startPlayback` sets muted, never unmutes; `stopPlayback` resets) + Task 3 (`toggle` only plays on click). ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output. ✓

**Type consistency:** `PlayableVideo`, `POSTER_TIME`, `startPlayback`, `stopPlayback` defined in Task 1 and used unchanged in Tasks 3. `videoFor(object): HTMLVideoElement | null` defined in Task 2, consumed in Task 4 and passed to `show(video: HTMLVideoElement)` in Task 3 — names and types match. `HTMLVideoElement` satisfies `PlayableVideo` structurally, so `startPlayback(this.video)` typechecks. ✓
