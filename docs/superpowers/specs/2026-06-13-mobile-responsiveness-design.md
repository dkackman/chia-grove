# Mobile Responsiveness Pass — Design

**Date:** 2026-06-13
**Status:** Approved (design)

## Context

The web app lays out acceptably at phone width, but three mobile usability gaps remain:

1. The scene-selector `<select>` (in the legend) inherits 12px text — a small tap target, and under 16px it triggers iOS Safari's focus-zoom. The native option list also reads small.
2. The block console (`#console`, bottom-right) is always visible with no way to dismiss it, unlike the legend which has a persisted collapse toggle.
3. Only the **gallery** theme has discrete ←/→ "browse pieces" navigation, which is unreachable without a keyboard. (Free drag-pan already works on touch via pointer events; grove/farm picking works via tap/click.)

This is a focused responsiveness pass — three small, independent changes. It is not a layout rework.

## Definitions

- **"Mobile" (CSS defaults):** viewport `max-width: 640px`. Used for the selector enlargement and the console's default-collapsed state.
- **"Touch device" (capability):** `matchMedia("(pointer: coarse)")`. Used for the gallery legend hint wording. The swipe handler itself is pointer-type agnostic (a mouse flick triggers it too; harmless).

## Affected files

- `web/src/style.css` — selector media query; console structure/fade selectors; console toggle styling.
- `web/src/ui/console.ts` — `BlockConsole` gains header/body structure + collapse toggle.
- `web/src/themes/gallery/gallery.ts` — swipe detection at `pointerup`; new pure `classifySwipe` helper.
- `web/src/themes/gallery/index.ts` — device-aware legend hint label.

`web/src/main.ts` is unchanged (`BlockConsole` self-initializes its DOM).

---

## 1. Scene selector — bigger text & tap target

Add a mobile-only rule; desktop is unchanged.

```css
@media (max-width: 640px) {
  #legend-scene select {
    font-size: 16px; /* >=16px stops iOS focus-zoom; enlarges Android option list */
    padding: 4px 8px;
  }
}
```

Rationale: `16px` is the threshold below which iOS Safari zooms the viewport on focus. Bumping it both fixes the zoom and gives a comfortable tap target. Native option-list sizing is OS-controlled on iOS (system wheel) but inherits font-size on Android, so this also addresses the "small dropdown text" report there.

## 2. Console — collapsible, mirroring the legend

### DOM restructure

`#console` changes from a flat list of line `<div>`s into:

```
#console               (container; pointer-events: none)
  ├─ button#console-toggle   (header; pointer-events: auto)
  └─ div#console-body        (log lines prepend here)
```

`BlockConsole` builds this chrome in its constructor and prepends lines into `#console-body`. The `MAX_LINES` trim and `lastElementChild` logic operate on the body, not the container.

### Collapse behavior (mirrors `initLegend`)

- `collapsed: boolean`, persisted to `localStorage["grove.console.collapsed"]` (`"1"`/`"0"`).
- **Default when no stored value:** `matchMedia("(max-width: 640px)").matches` → collapsed on phone-width, expanded otherwise. A manual toggle writes the key and overrides thereafter.
- `render()`:
  - `body.hidden = collapsed`
  - header text: collapsed `▤`, expanded `log ✕`
  - `container.classList.toggle("collapsed", collapsed)`
- Header `click` flips `collapsed`, persists, re-renders.
- New events arriving while collapsed still prepend into the (hidden) body; they do not force-expand. Collapse state is the user's choice.

### Visibility

The container stays `hidden` until the first event arrives (current behavior), then `hidden = false`. After that, the collapse state governs the body. So on a phone, after the first block the user sees only the small `▤` toggle bottom-right until they expand it.

### CSS

- Move opacity-fade selectors from `#console > div:nth-child(n)` to `#console-body > div:nth-child(n)`.
- `#console-toggle`: transparent button, `font: inherit`, `color: #eafff2`, `pointer-events: auto`, `cursor: pointer`, right-aligned (matches console). Mirror `#legend-toggle`.
- `#console-body` keeps `pointer-events: none` so the scene behind the log lines stays tappable. Add a `.collapsed` rule if padding needs tightening (parallel to `#legend.collapsed`).

## 3. Gallery — swipe to browse

The gallery already supports: tap (focus/unfocus), slow drag (free pan), and ←/→ keys (discrete column jump of `±WALL.colStep * 2`). Add **swipe** as the touch-reachable equivalent of the arrow keys.

### Classification (pure helper, unit-tested)

Extract a pure function in `gallery.ts`:

```ts
export function classifySwipe(dx: number, dy: number, dt: number): -1 | 0 | 1;
```

- Returns `0` (not a swipe) unless: `Math.abs(dx) >= SWIPE_DIST` (~35px), `Math.abs(dx) > Math.abs(dy)` (horizontal-dominant), and `dt <= SWIPE_TIME` (~0.4s).
- Otherwise returns the jump direction. Direction matches the existing grab metaphor: swiping right (`dx > 0`) moves toward older pieces (same sign as `ArrowLeft` → `-1`); swiping left → `+1`.

### Wiring at `pointerup`

- Capture at `pointerdown`: `downX`, `downY` (already present), plus `downT = nowT` (clock seconds) and `panStartX = camera.position.x`.
- At `pointerup`, before the existing "if dragging → return (it was a pan)" branch:
  - If not `dragging` → existing tap → focus/unfocus (unchanged).
  - If `dragging`, compute `dir = classifySwipe(e.clientX - downX, e.clientY - downY, nowT - downT)`.
    - `dir !== 0` → discrete jump: `manualX = clampPan(panStartX + dir * WALL.colStep * 2); manualUntil = nowT + IDLE_RESUME_S;` then return. Computing from `panStartX` (not the mutated `manualX`) avoids double-counting the mid-flick freeform pan. The fast manual ease snaps to the new column.
    - `dir === 0` → existing slow-pan behavior (return; the freeform pan already applied).

Like the arrow keys, this sets the manual pan target; it takes visible effect while browsing (unfocused). Swipe-to-advance-focus while a piece is focused is out of scope (parity with current arrow-key behavior).

### Legend hint

In `gallery/index.ts`, choose the hint label by pointer capability at module load:

```ts
const coarse = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
// ...
[ "sw-key", coarse ? "swipe ← → — browse pieces" : "← → keys — browse pieces" ],
```

Keep the `sw-key` swatch (the ←→ glyph still communicates direction).

---

## Testing

- **Unit (vitest):** `classifySwipe` thresholds — below distance → 0; vertical-dominant → 0; too slow → 0; fast horizontal right → -1; fast horizontal left → +1. Add `web/test/gallery-swipe.test.ts`.
- **Manual:** the existing suite has no DOM/jsdom harness, so verify the selector enlargement, console collapse/persist/mobile-default, and the swipe at `http://localhost:5173/?demo=1` and `?demo=1&theme=gallery`, including a narrow viewport (DevTools device mode).
- `npm run typecheck` and `npm run lint` stay clean.

## Out of scope

- Layout/grid rework (current layout is acceptable).
- Swipe navigation in grove/farm themes (no discrete browse model there).
- Swipe-while-focused advancing to the adjacent piece (possible future enhancement).
- Making the legend default-collapsed on mobile (only the console gets the mobile default).
