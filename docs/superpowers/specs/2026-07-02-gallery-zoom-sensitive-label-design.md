# Gallery zoom: blur + label sensitive/blocked NFTs in the info panel

**Date:** 2026-07-02
**Status:** Approved (design)

## Goal

When a viewer zooms into (focuses) an NFT on the gallery wall, the side info
panel (`.gallery-label`, gallery's equivalent of the shared `#card` popup used
by grove/farm/mine/board) should give the same content-filter treatment the
`#card` popup already gives elsewhere:

- **sensitive** → a blurred rendition of the real art + a "sensitive content"
  note.
- **blocked** → a "media unavailable" note (no bytes fetched, ever).

This closes a gap from [`2026-06-26-sensitive-content-filtering-design.md`](2026-06-26-sensitive-content-filtering-design.md):
that design deliberately kept the gallery *wall* on a neutral placeholder
texture instead of fetching+blurring real art, since a wall shows many pieces
ambiently. It didn't add an equivalent to `#card`'s blur+label treatment for
gallery's own "detail view" (the zoom/focus panel) — so today a focused
sensitive piece shows no indication in the panel that content was filtered.

## Decision: panel-only, wall unchanged

The framed piece on the wall keeps its neutral striped placeholder texture,
both before and after zoom — the app still never fetches real bytes for
ambient wall display, preserving the privacy posture of
`2026-06-26-sensitive-content-filtering-design.md`. Only the explicit zoom
action (equivalent to hovering/clicking `#card` elsewhere) fetches media for
the panel.

Rejected alternative: replacing the giant 3D wall texture itself with a
blurred rendition of the real image on zoom. Rejected because it would mean
fetching real NFT bytes as a side effect of camera movement/dolly-in rather
than a single unambiguous user action, and because it re-litigates the
wall-placeholder decision from the prior design for no added clarity — the
panel already carries all of the piece's textual detail, so it's the natural
place for the media-disposition note too.

## Changes

### `web/src/ui/media.ts`

Move the DOM element helpers currently private to `detail-card.ts` here and
export them, so gallery's placard can reuse the identical
image/video/audio-element + error-escalation logic instead of duplicating it:

- `createMediaEl(src, kind): HTMLElement`
- `nftMediaEl(src, kind): HTMLElement` (the retry-on-error wrapper around
  `createMediaEl`, using `escalateMediaKind`)

`detail-card.ts` imports both from `media.ts` instead of defining them.

### `web/src/themes/gallery/label.ts`

- `placardModel(event, count)` gains a `media: MediaDisposition` field,
  computed via the existing `resolveMedia(event)` from `ui/media.ts`. The
  model stays a pure, unit-tested function — it now fully describes what the
  panel should render, not just its text.
- `Placard$.render()` inserts a media block directly under the title (same
  relative position `#card` uses today), switching on `model.media.render`:
  - `"blur"` → `nftMediaEl(media.src, media.kind)` with a `sensitive` class
    added, plus a "sensitive content" note.
  - `"placeholder"` → a "media unavailable" note, no media element (blocked
    NFTs never yield a src, so nothing to fetch).
  - `"art"` / `"none"` → unchanged, nothing added (the real art is already
    visible full-size on the wall behind the panel; no need to duplicate it
    in a 280px-wide box).

### `web/src/style.css`

Add `.gallery-label` rules paralleling `#card`'s existing ones (structure
copied, colors matched to gallery's warm palette rather than `#card`'s green):

- `.gallery-label img`, `.gallery-label video` — sizing/spacing.
- `.gallery-label img.sensitive`, `.gallery-label video.sensitive` —
  `filter: blur(24px); pointer-events: none;`.
- `.gallery-label .media-note` — dashed-border caption box, reusing `#card
.media-note`'s visual language (letter-spacing, dashed border) with gallery's
  `#ffe9c2` accent instead of `#card`'s green.

## Testing

- Extend `web/test/gallery-label.test.ts`: `placardModel()` returns
  `media.render === "blur"` for `mediaFilter: "sensitive"`,
  `"placeholder"` for `mediaFilter: "blocked"`, and `"art"`/`"none"` matching
  today's `resolveMedia` behavior for unflagged events (mirrors the existing
  `resolveMedia` unit tests referenced in the prior design).
- `Placard$`'s DOM rendering stays untested, consistent with `detail-card.ts`
  today (also DOM-only, also untested at that layer).

## Out of scope

- Any change to what the wall itself shows, focused or not.
- A click-to-reveal affordance for sensitive content (still permanently
  blurred, per the prior design).
- `mine/structures.ts` paintings, which are a separate (non-popup,
  click-through-to-MintGarden) surface untouched by this change.
