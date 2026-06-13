# Gallery NFT Card — Close / Restore

## Problem

In the gallery theme, tapping an NFT focuses it: the camera zooms in **and** the
detail card (`Placard$`, `.gallery-label`) appears pinned to the right edge. The
only way to dismiss the card is to tap away or press Escape, which also unfocuses
the camera. There is no way to view the focused art unobstructed while keeping
the zoom — the info panel always covers the right side of the piece.

## Goal

Let the viewer collapse the detail card to a small `ⓘ` pill while staying zoomed
on the art, and re-expand it on demand — mirroring the legend's `✕ → ⓘ`
collapse/restore pattern.

## Behavior

| Action                | Result                                                     |
| --------------------- | ---------------------------------------------------------- |
| Tap a piece           | Camera zooms in; card shows in its remembered state        |
| **✕** (card corner)   | Card collapses to a small `ⓘ` pill; camera stays zoomed    |
| **ⓘ** (pill)          | Card re-expands to the full detail panel                   |
| Escape / tap-away     | Full unfocus — camera resets, card *and* pill both vanish  |

- The collapsed/expanded choice **persists** via
  `localStorage["grove.gallery.card.collapsed"]`, parallel to the legend's
  `grove.legend.collapsed`. Once collapsed, tapping through other pieces keeps
  the card collapsed (browsing stays clean); one `ⓘ` click restores it.
- Focusing a new piece does **not** reset the collapse state — it shows the new
  piece's content in whatever state the viewer last chose.

## Design

All changes are contained to the placard; camera/focus logic in `gallery.ts` is
untouched. `focus()` still calls `placard.show(meta, count)` and `unfocus()`
still calls `placard.hide()`.

### `label.ts` — `Placard$`

The class gains a small state machine:

- Holds the current `event` + `count` (the last `show()` args) and a
  `collapsed` boolean seeded from `localStorage`.
- `show(event, count)` stores the args, then `render()`s either the full card or
  the collapsed pill depending on `collapsed`. Marks the element visible.
- `render()` rebuilds the element's children:
  - **Expanded:** the existing content (title, activity, meta/coin/launcher,
    links) plus a `✕` close button in the header row.
  - **Collapsed:** a single `ⓘ` button, nothing else.
- `✕` handler: set `collapsed = true`, persist, `render()`.
- `ⓘ` handler: set `collapsed = false`, persist, `render()`.
- `hide()` removes `visible` / sets `hidden` (unfocus). The `collapsed`
  preference is left intact so it survives the next focus.

The pure `placardModel()` helper is unchanged — collapse is a presentation
concern handled entirely in `Placard$`.

### `style.css` — `.gallery-label`

- Add a header row so the title and `✕` sit on one line, `✕` pushed to the right
  edge (flex row), matching the legend's `#legend-toggle` treatment.
- Add a collapsed modifier: when collapsed the element shrinks to wrap the `ⓘ`
  pill — a small circular glyph button styled with the card's existing
  border/background tokens, positioned where the card's corner was.
- The `ⓘ` / `✕` buttons are real buttons (keyboard-focusable, `pointer-events`
  already `auto` on `.visible`).

## Out of scope

- No change to the shared `#card` (grove/farm picker detail card).
- No change to camera framing, focus selection, or keyboard handling.
- No new restore button floating separately from the card — restore is the
  collapsed form of the same element.

## Testing

`placardModel()` already has unit coverage and is unchanged. The collapse toggle
is DOM/interaction behavior; verify manually in `?theme=gallery` (or `?demo=1`):
focus a piece → ✕ collapses to ⓘ while staying zoomed → ⓘ re-expands → reload
preserves the collapsed choice → Escape clears everything.
