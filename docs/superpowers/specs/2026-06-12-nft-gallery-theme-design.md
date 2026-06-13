# NFT Art Gallery Theme — Design

**Date:** 2026-06-12
**Status:** Approved (pending spec review)

## Summary

Add a third visualization theme, `gallery`, that presents freshly-minted NFTs as
framed art pieces hung salon-style on a dark contemporary gallery wall. The
camera pans slowly across the wall; clicking a piece flies the camera in to frame
it, dims the rest of the wall, and reveals a museum-style placard with the
NFT's transaction details. Selectable alongside `grove` and `farm` via the legend
switcher and the `?theme=gallery` query parameter.

## Decisions (locked during brainstorming)

| Question             | Decision                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------- |
| Rendering            | Three.js 3D scene implementing the existing `Visualization` interface                    |
| Spatial layout       | Salon wall — varied-size pieces; new pieces append to the right                          |
| What hangs           | NFT **mints only** (`kind === "nft" && mint === true`) with a usable image               |
| Missing/failed image | Skipped — no blank frames                                                                |
| Image CORS failures  | **Direct-load, discard on failure** (no server proxy)                                    |
| Click interaction    | Camera **flies in** to frame the piece; rest dims; click-away/Esc returns                |
| Transaction details  | Bespoke **gallery wall label** (museum placard), not the shared detail card              |
| Non-NFT events       | **Subtle ambience**: netspace→lighting, block→light "breath", reorg→remove recent pieces |
| Mood                 | **Dark contemporary** — near-black walls, warm picture-spotlights, glossy floor          |

## Architecture

New package directory `web/src/themes/gallery/`, registered as the third entry in
`THEMES` (`web/src/themes/index.ts`). No changes to the server, shared types, or
`index.html`. The theme owns its entire Three.js scene and its own DOM placard.

### Files

| File         | Responsibility                                                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`   | The `Visualization` object: `id: "gallery"`, `label`, `legend`, `start()`.                                                         |
| `gallery.ts` | Renderer, scene, lighting, camera state machine, pointer input, event dispatch.                                                    |
| `wall.ts`    | The dark salon wall, glossy floor, and backdrop geometry/materials.                                                                |
| `pieces.ts`  | Framed-art piece pool: async texture loading, slot cap + wrap, arrival animation, hover highlight, raycast targets, reorg removal. |
| `layout.ts`  | Pure salon-hang placement (positions + frame sizes). Unit-tested.                                                                  |
| `label.ts`   | The DOM museum placard: build, position, show/hide.                                                                                |
| `palette.ts` | Dark-contemporary scene colors.                                                                                                    |

Reuses `web/src/themes/shared/`: `textures` (glow/spotlight sprite), `scales`
(amount/netspace mapping), `util.mulberry32` (deterministic per-coin jitter),
`postfx` (bloom on the spotlights). Reuses `web/src/ui/format.ts`
(`mojosToXch`, `shortHex`) for the placard.

### `Visualization` interface generalization

`main.ts` currently calls `attachPicker(canvas, handle)` unconditionally. The
gallery handles its own pointer input (hover highlight + click fly-in + placard),
so:

1. Add `selfManagedInput?: boolean` to `VisualizationHandle` (`themes/types.ts`).
2. Make `pickables`, `metaFor`, and `setHovered` **optional** on
   `VisualizationHandle` (the gallery does not implement them).
3. In `main.ts`, gate the shared picker:
   `if (!handle.selfManagedInput) attachPicker(canvas, handle);`

`grove` and `farm` are unchanged (flag absent → picker attaches as today). The
gallery returns `selfManagedInput: true` and wires its own canvas listeners.

## Data flow

```
GroveFeed.onEvent
   ├─ sprout (kind==="nft" && mint===true && hasUsableImage)
   │      → pieces.add(event): load texture → on success hang piece + arrival pulse
   │                                         → on error (incl. CORS) discard quietly
   ├─ ambient → lighting.setNetspace(netspace)        // warmth/intensity
   ├─ block   → lighting.breath()                      // soft pulse
   └─ reorg   → pieces.removeRecent(forkHeight)        // drop undone mints + flicker
```

`hasUsableImage`: `event.imageUrl` is a non-empty string. (Video/audio NFTs:
out of scope for hanging — if `imageUrl` points at a non-image it will simply
fail to load as a texture and be discarded. No special-casing.)

### Piece lifecycle

- Pool with a fixed slot cap (~28). When full, adding a new piece overwrites the
  oldest slot (wrap), matching the `FloraSystem`/`CropSystem` pattern.
- Each piece = a frame mesh (dark border) + an image plane textured from
  `imageUrl` via `THREE.TextureLoader` (`crossOrigin = "anonymous"`). The piece
  is only made visible once the texture resolves; on `onError` the slot is
  released.
- Frame aspect ratio adapts to the loaded texture's dimensions (portrait /
  landscape / square) within layout size bounds.
- Arrival: spotlight intensifies + a brief scale/opacity "new" pulse.

## Camera & interaction

A two-state machine driven in the render loop:

- **PANNING** (default): camera eases laterally to keep the newest pieces in
  frame, with gentle vertical/positional drift. Slow and continuous.
- **FOCUSED**: entered on click of a piece. Camera position + look-at target
  ease toward a framing of that piece (piece fills the view, slight angle). The
  rest of the wall dims (lower light / overlay). The placard fades in beside the
  piece. Exit on click of empty space or `Esc` → ease back to PANNING and hide
  the placard.

Easing via per-frame lerp toward target vectors. Respects
`prefers-reduced-motion` (minimal drift, near-instant transitions).

Pointer input (own listeners on the canvas):

- `pointermove` → raycast against piece frames → highlight hovered piece +
  pointer cursor.
- `click` → raycast; hit → FOCUSED on that piece; miss → return to PANNING.
- `keydown` Esc → return to PANNING.

## Wall label (placard)

`label.ts` creates a single `<div class="gallery-label">` appended to
`document.body` (theme-owned; no `index.html` change). Styled in `style.css`
under a `.gallery-label` namespace to match the dark mood. Content for the
focused piece:

- Title: `NFT mint`
- `${mojosToXch(amount)} XCH · block ${height}`
- `coin ${shortHex(coinId)}`
- `launcher ${shortHex(launcherId)}` (when present)
- `view on spacescan ↗` → `https://www.spacescan.io/coin/0x{coinId}`
- `view on mintgarden ↗` → `https://mintgarden.io/nfts/{nftId}` (when `nftId`)

Shown only in FOCUSED state; hidden in PANNING.

## Ambience mapping

- **netspace** (`ambient.netspace`): mapped through a `scales` helper to overall
  light intensity and warmth, the way `grove/sky.ts` scales moonlight.
- **block**: a short additive light "breath" pulse that decays over ~1s.
- **reorg** (`forkHeight`): remove pieces whose `height >= forkHeight` (those
  mints were undone) with a brief flicker as they leave.
- **mempool**: ignored.

## Legend

`legend` entries (swatch class + label), with swatch CSS added to `style.css`:

- `sw-canvas` — framed piece — NFT mint
- `sw-spotlight` — spotlight warmth — netspace
- `sw-breath` — light pulse — new block
- `sw-reorg` — pieces removed — reorg

## Demo & offline support

Demo events (`web/src/net/demo.ts`) currently omit `imageUrl` for NFTs, so the
gallery would be empty under `?demo=1`. Add a small set of bundled **SVG
data-URI** artworks (abstract gradients/shapes) and assign one to each demo NFT
event's `imageUrl` (seeded by `nftId` for stability). Data URIs load offline and
are exempt from CORS, so the demo shows an interactive wall. Note that demo NFT
mints are sparse (NFTs are ≈4% of demo sprout kinds, ~25% of those minted), so
the wall fills in gradually under `?demo=1` — consistent with the "as they are
minted" intent and the sparse-wall risk note below.

## Testing

Pure modules unit-tested with vitest in `web/test/`:

- `layout.ts` — salon positions/sizes are deterministic and within bounds; pieces
  extend rightward; no overlaps beyond intended salon density.
- `hasUsableImage` / "should this hang?" predicate — only NFT mints with an image.
- reorg removal — selects exactly the pieces with `height >= forkHeight`.
- netspace→light mapping — monotonic, clamped to sane bounds.

Three.js rendering itself is not unit-tested; rendering code stays a thin shell
around the tested pure logic. Existing tests (`resolveTheme`, etc.) must still
pass; `npm run typecheck`, `npm run lint`, and `npm test` are the gates.

## Out of scope

- Server-side image proxy / CORS workaround (chose direct-load + discard).
- Hanging non-mint NFT transfers.
- Video/audio NFT playback in-scene.
- Reflective-floor via `THREE.Reflector` is optional polish, not required; a
  dark gradient floor with a faked sheen is acceptable.

## Risk notes

- **Sparse wall**: mints-only + CORS discards can leave the wall thin during
  quiet periods. The empty/low state must still look intentional (lit empty wall,
  not broken). Acceptable per the "as they are minted" intent.
- **Texture memory**: cap enforced by the slot pool; dispose textures on slot
  overwrite and on reorg removal to avoid GPU leaks.
