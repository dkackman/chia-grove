# Gallery video playback — design

## Problem

To limit exposure to explicit content, video NFTs never autoplay anywhere in the
app — ambient surfaces (gallery walls, mine paintings) show only a frozen poster
frame, decoded by seeking the `<video>` a hair into the clip without ever calling
`play()` (`web/src/themes/gallery/media.ts`). The detail card used by other themes
embeds a native `<video controls>`, but the **gallery** theme does not use the
detail card: when a piece is tapped it flies the camera to frame the art and shows
a metadata placard, with no way to play a video.

So in the gallery there is currently no playback path at all. We want one that is
strictly user-initiated: when a focused piece is a video, offer a play button.

## Goal

When a video NFT is focused (tapped → camera zoom) in the gallery, show a centered
▶ button over the art. Clicking plays the clip **in place on the wall** — muted and
looping — and the button toggles to ⏸. Clicking again pauses. Leaving focus (tap
away, Escape, reorg removal, or slot-pool wrap) pauses playback and resets the wall
to the still poster frame.

## Decisions

| Question        | Decision                                                          |
| --------------- | ----------------------------------------------------------------- |
| Playback surface| Play on the wall — the existing `VideoTexture` animates in place; a custom DOM ▶/⏸ button drives it. No native `<video controls>` overlay. |
| Sound           | Muted, always. The element is never unmuted.                      |
| Loop            | Loop while focused. The button is a play/pause toggle; on unfocus it pauses and resets to the poster frame. |

## Non-goals

- No sound (the `<video>` is never unmuted).
- No native scrubber / volume / fullscreen controls.
- No autoplay — playback only ever starts from a click.
- No per-frame DOM-to-world projection: the focused piece projects to screen
  center (see Positioning), so the button is simply CSS-centered.
- Reduced-motion users still see the button; playback is an explicit choice, so we
  do not suppress it, but nothing animates until they click.

## Why playback of filtered content is impossible by construction

The button only ever binds to a real `<video>` element. Blocked and sensitive
pieces never hang a video: in `gallery.ts`, blocked → `media.render === "none"`
(no piece) or a neutral placeholder texture, and sensitive → a
`sensitivePlaceholderTexture()` clone. `Pieces.videoFor()` (below) returns the
texture's backing image only when it is video-like, so for a placeholder-backed
piece it returns `null` and no button appears. A new filtered surface inherits this
automatically — there is no code path that plays the bytes of a filtered NFT.

## Components

### 1. `Pieces.videoFor(object)` — new method, `web/src/themes/gallery/pieces.ts`

Returns the `<video>` element backing the piece under a picked object, or `null`
if the piece is not video-backed (image, placeholder) or the object is unknown /
retired.

Detection duck-types on the element having a `play` function, matching the
existing `retire()` duck-typing (`typeof media.pause === "function"`) and the
`THREE.Texture` + fake-`{ play, pause, ... }` pattern the tests already use.
Returning the existing element (not a clone) is intentional — the play button and
the `VideoTexture` must share the same element so playback animates the wall.

```ts
/**
 * The <video> element backing the piece under this object, or null when the
 * piece is image- or placeholder-backed (so blocked/sensitive pieces, which
 * hang a placeholder texture, never expose a playable element).
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

### 2. `web/src/themes/gallery/playback.ts` — new pure module

DOM-free playback control over a video-like element, separated from the button so
it is unit-testable with a fake video (mirrors `material.ts`/`resolveCatBlock`
split from `cats.ts`). Operates on a minimal `PlayableVideo` structural type so a
test fake satisfies it.

```ts
export interface PlayableVideo {
  muted: boolean;
  loop: boolean;
  currentTime: number;
  play(): Promise<void> | void;
  pause(): void;
}

// Shared with media.ts: the small offset the poster frame was seeked to.
export const POSTER_TIME = 0.1;

/** Begin user-initiated playback: stay muted, loop, and play. Returns play()'s
 *  result so the caller can revert its UI if the browser rejects the gesture. */
export function startPlayback(video: PlayableVideo): Promise<void> | void {
  video.muted = true;
  video.loop = true;
  return video.play();
}

/** Stop and reset to the poster frame: pause, clear loop, and seek back to the
 *  poster offset so the wall shows the still again (three's VideoTexture
 *  re-uploads the seeked frame via requestVideoFrameCallback). */
export function stopPlayback(video: PlayableVideo): void {
  video.pause();
  video.loop = false;
  video.currentTime = POSTER_TIME;
}
```

`media.ts` is updated to import `POSTER_TIME` for its seek target (single source
of truth; today it inlines `0.1`).

### 3. `web/src/themes/gallery/play-button.ts` — new `PlayButton$` DOM class

A theme-owned DOM control, parallel to `Placard$`: created once, shown/hidden as
video pieces gain/lose focus.

- Constructor creates `<button class="gallery-play" type="button">`, sets
  `aria-label`, appends to `document.body`, hidden.
- `show(video)`: if a different video is currently bound, release it first
  (`stopPlayback` + detach listeners); bind the new one in the paused poster
  state, set glyph ▶, reveal.
- `hide()`: `stopPlayback` the bound video, detach listeners, unbind, hide.
- Click handler toggles: if paused → `startPlayback` (on a rejected promise,
  revert glyph to ▶); if playing → `stopPlayback`. (Pausing on toggle does not
  reset to the poster — only `hide()` does; toggling pause leaves the frame where
  it stopped, which is fine, and the next play resumes.)
  - Refinement: the click handler reads the bound video's `paused` to decide, and
    a plain pause (not reset) is used for the playing→paused toggle so a mid-clip
    pause does not jump back to the poster. `hide()` is the only path that resets.
- Glyph stays correct via listeners on the bound video's own `play`, `pause`, and
  `ended` events, so a loop ending or an external pause keeps the button honest.
- `dispose()`: `hide()` then remove the element.

Not unit-tested (no jsdom in the vitest node environment), consistent with
`Placard$`, whose DOM class is likewise untested while its pure `placardModel` is.

### 4. Wiring — `web/src/themes/gallery/gallery.ts`

- Construct `const playButton = new PlayButton$();` alongside `placard`.
- In `focus(object)`, after framing and showing the placard:
  ```ts
  const video = pieces.videoFor(object);
  if (video) playButton.show(video);
  else playButton.hide();
  ```
- In `unfocus()`, add `playButton.hide();`.
- No new teardown is needed for reorg/wrap: the frame loop's existing auto-unfocus
  (`if (focused && focusedObject && !pieces.metaFor(focusedObject)) unfocus();`)
  already fires when the focused piece is removed, and `unfocus()` hides the
  button. `retire()` already pauses and releases the `<video>`, so any
  `stopPlayback` against an already-released element is a harmless no-op.
- Re-focusing a different piece calls `focus()` again, and `show()` releases the
  previously bound video before binding the new one.

### 5. CSS — `web/src/style.css`

`.gallery-play`, styled after `.label-info` (the placard's circular pill) so it
reads as part of the same UI:

- `position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);`
- circular, ~64px, translucent dark background + warm hairline border, large glyph
  centered via `display: grid; place-items: center;`
- `cursor: pointer; pointer-events: auto;` and a hover border-brighten
- hidden by default via the element's `hidden` attribute (the class toggles a
  `visible` modifier for the fade, matching `.gallery-label`)

The `.gallery-label` placard is pinned to the right edge (`right: 4vw`), so a
screen-centered button does not overlap it.

## Positioning

`framePiece()` places the camera directly in front of the focused piece with the
look target at the piece center, so the piece center projects to screen center.
A CSS-centered button therefore sits over the art with no per-frame projection.
During the camera's brief ease-in the piece is not yet perfectly centered; the
button appears centered immediately and the art settles under it within ~0.5 s,
which is acceptable (the placard likewise appears immediately).

## Playback / texture-refresh mechanism

The bound `<video>` is the same element the `VideoTexture` wraps. three 0.184's
`VideoTexture` registers a `requestVideoFrameCallback` that sets `needsUpdate` on
every presented frame, so once `play()` starts, the wall animates with no extra
wiring; and after `stopPlayback` seeks back to `POSTER_TIME`, the decoded poster
frame is presented once and re-uploaded, returning the wall to the still. The
`<video>` still has its `src` (the same-origin `/img?nft=` proxy URL) from the
poster-frame load, and `preload="metadata"` does not block `play()` from streaming
the rest of the clip on demand.

## Testing

- `web/test/gallery-playback.test.ts` (new): with a fake `PlayableVideo`,
  - `startPlayback` sets `muted` true, `loop` true, and calls `play()`.
  - `stopPlayback` calls `pause()`, sets `loop` false, and resets `currentTime` to
    `POSTER_TIME`.
- `web/test/gallery-pieces.test.ts` (extend): `videoFor` returns the backing
  element for a video-backed piece (texture whose `.image` has a `play` fn),
  `null` for an image-backed piece, and `null` for an unknown/retired object.
- `PlayButton$` and the `gallery.ts` wiring are exercised manually (no jsdom),
  consistent with `Placard$`.

## Files

| File | Change |
| ---- | ------ |
| `web/src/themes/gallery/playback.ts` | new — pure `startPlayback`/`stopPlayback` + `POSTER_TIME` |
| `web/src/themes/gallery/play-button.ts` | new — `PlayButton$` DOM control |
| `web/src/themes/gallery/pieces.ts` | add `videoFor()` |
| `web/src/themes/gallery/media.ts` | import `POSTER_TIME` instead of inlining `0.1` |
| `web/src/themes/gallery/gallery.ts` | construct `PlayButton$`, wire into `focus`/`unfocus` |
| `web/src/style.css` | add `.gallery-play` |
| `web/test/gallery-playback.test.ts` | new tests |
| `web/test/gallery-pieces.test.ts` | extend with `videoFor` tests |
