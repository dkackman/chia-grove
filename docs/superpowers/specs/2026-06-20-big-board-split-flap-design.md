# The Big Board — Split-Flap Ledger Theme — Design

2026-06-20

## Goal

Add a fifth `Visualization` — a split-flap **departure board** — alongside grove, farm,
gallery, and mine. Unlike the existing four (cozy, literal "places" populated by cute things
on a spiral or rows), this theme is **legible/educational first**: a single giant Solari-style
board floating in a dark room renders the live chain as a scrolling ledger. Each coin **spend**
flips in as a new row; older rows shift down and the oldest falls off. The signature is the
authentic **per-character riffle** — every character cell rifles through the alphabet to land
on its glyph, with the iconic mechanical clatter — and the explicit teaching of the
pending → block → confirmation lifecycle.

Theme id `board`, label "The Big Board".

## Decisions made during brainstorming

- **Direction:** legible/educational — optimize for explaining what's happening on-chain to a
  viewer, not for spectacle. (Chosen over abstract data-art, new mood, and new camera/physics.)
- **Concept:** The Big Board — an airport split-flap departure board. (Chosen over The Mempool
  Line transit diagram and a NASA "Mission Control" telemetry dashboard.)
- **Content model:** a **live spend ledger** — rows are individual recent spends (newest flips
  in at top, oldest falls off), with a header strip showing current block + ambient stats.
  (Chosen over a two-board blocks+spends layout and per-kind columns.)
- **Flap fidelity:** **per-character riffle** — every character cell is its own flap that
  riffles through the alphabet to its target glyph. (Chosen over per-row flip and
  per-character single-flip.) This is the most work and the most charm.
- **NFT art accent:** include one small "NOW SHOWING" tile beside the board, updating on NFT
  mints via the existing `/img?nft=launcherId` proxy. Keeps the board itself pure text.
- **Audio accent:** include a pooled WebAudio flip clack, **default-muted**, mute toggle in the
  legend, started on first user gesture (autoplay policy).
- **Reuse, don't reinvent:** shared `cat-color.ts`, `scales.ts`, `frame-limiter.ts`,
  `postfx.ts`, `load-pool.ts`, `ui/media.ts`, `ui/format.js`, and the shared picker/detail-card
  wiring. Themes own their entire scene behind the existing `Visualization` interface.

## Architecture

### Folder layout

```
web/src/themes/
  index.ts            registry gains `board`
  board/
    index.ts          Visualization export (id, label, legend, start)
    board.ts          renderer, camera, scene, lights, feed wiring, onFrame loop, picking
    flapgrid.ts       FlapGrid: instanced cell grid + per-cell riffle state machine
    glyphs.ts         glyph-atlas CanvasTexture builder + charToGlyph map (pure, testable)
    rows.ts           SproutEvent -> fixed-width row cells (pure, testable)
    header.ts         status strip: height, mempool gauge, netspace, clock (reuses FlapGrid)
    clatter.ts        pooled WebAudio flip clack, default-muted, gesture-gated
    nowshowing.ts     single NFT art tile beside the board (reuses /img proxy + mediaSrc)
    palette.ts        Solari colors; per-kind accent via shared cat-color.ts
```

`board.ts` mirrors `gallery.ts`/`grove.ts`: it owns the Three.js renderer, camera, scene,
lights, postfx, the onFrame loop, and event dispatch, and wires the `GroveFeed` to `FlapGrid`,
`header.ts`, `nowshowing.ts`, and `clatter.ts`.

### Reuse from `shared/` and `ui/`

- `themes/shared/cat-color.ts` — per-kind / per-CAT accent color on the KIND cell.
- `themes/shared/scales.ts` — amount → human magnitude for the AMOUNT column.
- `themes/shared/frame-limiter.ts`, `themes/shared/postfx.ts` — same render scaffolding as
  other themes.
- `themes/shared/load-pool.ts` + `ui/media.ts` (`mediaSrc`) — NFT art for the NOW SHOWING tile,
  with the existing negative-cache / concurrency-cap behavior.
- `ui/format.js` (`mojosToXch`, `shortHex`) — amount/coin formatting, shared with gallery's
  placard.

## The split-flap mechanism

### Glyph atlas + per-instance UV (`glyphs.ts` + `flapgrid.ts`)

Standard `InstancedKind` supports per-instance matrix + color but **not** per-instance UV, so
the board needs its own instanced mesh:

- `glyphs.ts` draws all glyphs into one `CanvasTexture` (`NearestFilter`, like
  `mine/textures.ts`): an 8×8 atlas of 64 cells covering `A–Z`, `0–9`, space, and symbols
  (`▸ ★ · + - . , : / # ▮` and a few block-fill glyphs for the mempool gauge). `charToGlyph(ch)`
  returns the atlas index (0 = blank for unknown/oversized chars). **Pure and unit-tested.**
- `flapgrid.ts` builds one `THREE.InstancedMesh` of unit quads, `R × C` instances (≈24 rows ×
  48 cols ≈ 1,150 cells; the header adds a few more rows). A per-instance `glyph` float
  attribute drives a small `onBeforeCompile` UV-offset patch (`atlasCol/atlasRow` from the
  glyph index) so each cell samples its own atlas cell. The mesh pins a fixed bounding sphere
  (like `InstancedKind`) so picking works before the board fills.

### Riffle state machine

Each cell holds `{ current, target, foldT }`:

- `setRow(rowIndex, text)` writes target glyphs for that row's cells (text is space-padded to
  the column count; overflow truncates).
- When `current !== target`, the cell riffles: it steps `current` forward through the glyph
  sequence toward `target` at a fixed flip rate, and each step plays a **squash-swap** —
  `scaleY` dips 1 → 0 → 1 and the glyph index swaps at the trough. This is the cheap,
  convincing split-flap illusion; no half-leaf shader is needed.
- Cells **stagger** their riffle start by column, so a row resolves left-to-right like a real
  board.
- `update(dt)` advances only in-flight cells and uploads matrices/glyph attr only when
  something changed — dirty-tracking mirrors `InstancedKind.update` (a settled board uploads
  nothing). `dt` comes from the frame loop so the animation is frame-rate-independent (same
  discipline as `mine/vfx.ts`).

### Row content (`rows.ts`, pure)

`rowCells(event: SproutEvent): RowCells` produces fixed-width columns:

| Column | Source | Notes |
|---|---|---|
| KIND   | `event.kind` | `XCH` / `CAT` / `NFT` / `DID`; accent color from `cat-color.ts` |
| ASSET  | ticker / name / id | CAT → `catTicker` (truncated); NFT → `MINT`+short `nftId` or `nft1…`; DID → `PROFILE`; XCH → `—` |
| AMOUNT | `event.amount` | `mojosToXch` + magnitude via `scales.ts`; `—` for kinds without amount |
| BLOCK  | `event.height` | right-aligned |
| STATUS | `event.mint` / kind | `★ NEW` for mints, else `CONFIRM` |

Pure and unit-tested (amount scaling, ticker truncation, mint `★`, DID/XCH placeholders),
matching how `mine/material.ts` and `gallery`'s `placardModel` are tested.

## Data flow (event → board)

```
GroveFeed
  ↓
board.ts dispatch
  ├─ sprout  → rows.rowCells(e) → FlapGrid: push new top row, shift all rows down,
  │            oldest falls off → board riffles; NFT mint also → nowshowing.show(e)
  ├─ block   → header re-stamps height / spendCount / fees; a thin separator row flips in;
  │            optional confirmation chime; gentle camera push-in
  ├─ ambient → header mempool gauge (a row of partially-filled block-glyphs), netspace
  │            readout, clock tick
  └─ reorg   → re-target every row to the post-fork state and full-board riffle;
               drop rows whose height >= forkHeight
```

### Volume control

A new connection replays up to 10,000 snapshot events, paced to ~60/frame by the existing
`DrainQueue`. To avoid an endless riffle storm while catching up, the board **fast-forwards**
during heavy backlog (glyphs snap instantly, no riffle) and only riffles for live events — so
connecting feels like the board powering on, then settling into live clatter. `board.ts`
counts sprouts dispatched since the previous frame; above a threshold (e.g. 8/frame) it sets
`FlapGrid` to fast-forward (instant glyph swaps), dropping back to riffle once live traffic
falls below it. `prefers-reduced-motion` forces instant swaps always.

## Camera, picking, accents

- **Camera:** head-on framing (most legible) with a subtle idle parallax sway; a gentle
  push-in on each new block. No orbit control (the board has a clear front). `selfManagedInput`
  stays false so the shared canvas picker drives selection.
- **Picking:** rows are pickable; `metaFor(object, instanceId)` maps the picked cell's row to
  its `SproutEvent`, reusing the shared detail card. `setHovered` brightens the hovered row's
  flaps (via instance color, like `InstancedKind.setHighlight`).
- **NOW SHOWING tile (`nowshowing.ts`):** one small framed plane beside the board; on each NFT
  mint it loads `/img?nft=launcherId` through `LoadPool` + `mediaSrc` and cross-fades. Reuses
  gallery's negative-cache/concurrency behavior; failures are silent (frame stays on the prior
  art or a placeholder).
- **Clatter (`clatter.ts`):** a small pool of WebAudio noise-burst clacks, throttled per frame,
  **default-muted**, with a mute toggle in the legend. Created lazily on the first user gesture
  to satisfy autoplay policy; any failure degrades to silent.

## Error handling

- Unknown or oversized glyphs map to atlas index 0 (blank flap) — never throws.
- NFT tile art failures reuse the existing negative-cache; the tile keeps its prior image.
- Audio context/creation failures degrade to silent; the scene never depends on audio.
- Reorg with `forkHeight` newer than everything on the board is a no-op.

## Testing

- `glyphs.ts` — `charToGlyph` mapping (letters, digits, symbols, unknown → 0). Pure, vitest.
- `rows.ts` — `rowCells` formatting across all four kinds: amount scaling, ticker truncation,
  mint `★ NEW` vs `CONFIRM`, DID/XCH `—` placeholders, fixed-width padding/truncation. Pure,
  vitest.
- The riffle animation, camera, and audio are visual/interactive and not unit-tested,
  consistent with the rest of the themes.

## Out of scope (YAGNI)

- No two-board or per-kind-column layouts (rejected during brainstorming).
- No half-leaf split-flap shader — the squash-swap illusion is sufficient at board scale.
- No per-CAT custom icons; the board stays text with a single accent color per kind.
- No persistence/history beyond the on-screen rows; the snapshot replay repopulates on reload,
  same as every other theme.
```
