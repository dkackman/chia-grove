# Mine scene: delineate chain blocks

**Date:** 2026-06-16
**Theme:** `mine` (Minecraft-inspired voxel island)

## Problem

Each chain block becomes a 7×7 chunk of grass tiles on a phyllotaxis spiral
(`chunkPosition`). The spiral spacing (`SPREAD = 3.0`) is much tighter than the
7-wide chunk, so consecutive chunks deliberately overlap into one contiguous
landmass — `Island.place()` makes shared cells idempotent (first block to claim
a cell wins). The result is a seamless island in which you cannot tell where one
block ends and the next begins.

Goal: delineate chain blocks — enough structure to read the island as "built
from units" — without lines, markers, or interaction.

## Explorations

**Grass tint (rejected).** Multiply each block's grass by a per-block shade.
Tried first as a slow spatial drift (neighbors similar → only island-wide
gradients, no per-block distinction), then as a per-block hash at ±18% reach.
Neither read in the running scene: a textured, mostly-green surface under ACES
tone-mapping and a moving day/night light flattens the multiply into noise.
Color was the wrong lever here.

**Per-block elevation (chosen).** A one-block step between neighbors — its
exposed dirt side and cast shadow — reads instantly, and survives texture, tone
mapping, and lighting because it is real silhouette geometry, not pigment.

## Approach

Make `chunkElevation` a **per-block hash of the chunk center** instead of a
smooth low-frequency field. Adjacent blocks then land on different heights and
step against each other; the steps delineate the boundaries. This deliberately
reverses the old "spatially smooth → rolling terraces, not random spikes"
intent — smoothing is exactly what left most boundaries flat. Capping at
`MAX_ELEVATION` keeps the steps small (one block), so it reads as a stepped
patchwork, not spikes.

`chunkElevation(pos)` keeps its signature. Every consumer — `Island.place`,
`CatBlocks.plant`, `Villagers`/`Paintings` in `structures.ts` — already passes
the chunk center, so each block and everything sitting on it ride the new height
consistently, with no threading.

## Changes

### `web/src/themes/mine/layout.ts`

- `chunkElevation(pos)` now quantizes the center and hashes it via `mulberry32`
  to `0..MAX_ELEVATION`. Deterministic, so snapshot replay and reorg
  re-grounding reproduce identical terrain.
- `MAX_ELEVATION` stays `1` (small steps). Raising it to `2` yields three levels
  — fewer flat boundaries, but occasional 2-block cliffs. This is the dial.

## Also in this change: special-hover fix

While investigating a hover bug (hovering grass beside a CAT popped the CAT's
card), the root cause turned out to be the grass **apron**: the 3×3 platform
laid under each CAT/NFT/DID (`ensureGround` → `platformCells`) planted those
grass tiles with the _special's_ event as their picking metadata
(`InstancedKind` stores `slot.meta`), so the surrounding grass faithfully but
wrongly reported the special.

Fix: ground only the special's **own seat cell** instead of the 3×3 patch.
Specials never float (a tile is always under the cube), clusters still connect
(consecutive seats are adjacent), and no grass tile beyond the one directly
beneath a cube carries a special's event. The now-dead `platformCells` helper is
removed.

## Tests

`web/test/mine-layout.test.ts`:

- `chunkElevation` is deterministic, integer, within `0..MAX_ELEVATION`, and
  produces more than one level across the spiral (blocks actually step).
- Removed the `platformCells` test (helper deleted) and the abandoned `chunkTint`
  tests.
