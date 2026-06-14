# Mineworld Voxel-Island Theme — Design

2026-06-14

## Goal

Add a fourth `Visualization` — a Minecraft-inspired voxel world — alongside grove, farm,
and gallery. It renders the same event stream (XCH/CAT/NFT/DID spends, blocks, mempool,
netspace, reorgs) as a blocky island that **physically builds itself from chain activity**
under a slow day–night sky. The signature: a Chia *block* becomes placed *blocks*, and the
base currency (XCH) is the very ground everything else grows on.

Working name: theme id `mine`, label "Mineworld" (rename freely).

## Decisions made during brainstorming

- **World shape:** a growing island — flat-ish terrain that spreads outward chunk by chunk,
  orbited by the camera. (Chosen over a tower skyline and a spiral ziggurat.)
- **Camera:** reuse the shared `createOrbitControl` (drag-to-yaw with auto-drift), identical
  to grove/farm. No new camera code.
- **XCH is the land.** Each XCH spend lays a grass/dirt cube, extending the island. Busy
  blocks visibly enlarge the world. CAT/NFT/DID sit on top as special blocks.
- **CAT = deterministic material + color**, the same hash-from-`assetId` principle as today's
  `catColor()`, but two axes feeding three render-class families (see §3). Curated, all
  cube-shaped — not arbitrary "go wide" materials.
- **DID = villager** standing on its block (chosen over a player-head-on-a-post).
- **NFT = framed painting** of the art, clickable → MintGarden (reuses the existing media
  proxy + shared picker).
- **Day–night cycle**, a slow ~couple-minute loop. This is the theme's signature and the only
  time the emissive blocks, mint beacon beams, and rim torches pay off.
- **Reuse, don't reinvent:** shared `instanced.ts`, `orbit.ts`, `postfx.ts`, `scales.ts`,
  `util.ts`. Themes own their entire scene, behind the existing `Visualization` interface.

## Architecture

### Folder layout

```
web/src/themes/
  index.ts            registry gains `mine`
  mine/
    index.ts          Visualization export (id, label, legend, start)
    mine.ts           renderer, camera orbit, day-night driver, event dispatch + setter hooks
    island.ts         XCH terrain system (grass/dirt cubes, chunk footprint, height noise)
    cats.ts           three instanced CAT families (opaque / transparent / emissive)
    structures.ts     NFT framed paintings + DID villagers
    material.ts       deterministic CAT material+color resolver (pure, testable)
    layout.ts         phyllotaxis chunk placement + coin-id-seeded in-chunk offset
    sky.ts            day-night cycle, sun/moon, stars, blocky clouds, fog
    vfx.ts            beacon beams, rim torches, creeper explosion, enchant glint
    palette.ts        16 Minecraft dyes + per-material base colors
```

`mine.ts` mirrors `grove.ts`: it owns the Three.js renderer, camera orbit, sky/fog, the
day-night clock, and event dispatch, exposing setter hooks (`setSproutHandler`,
`setAmbientHandler`, etc.) that `index.ts`'s `start()` wires to `island.ts`, `cats.ts`,
`structures.ts`, and `vfx.ts`.

### Reuse from `shared/`

- `instanced.ts` — `InstancedKind` slot ring buffer / grow easing / per-instance color
  highlight / raycast metadata. Backs the terrain and all CAT families.
- `orbit.ts` — `createOrbitControl`, the yaw offset feeding the camera each frame.
- `postfx.ts` — EffectComposer bloom + ACES. Emissive blocks, beacons, and torches bloom at
  night.
- `scales.ts` — amount → size mapping (reused for stack height, §2).
- `util.ts` — `safeBigInt`, `mulberry32` (seeded scatter).

Register `mine` in `themes/index.ts`. Static import (Three.js dominates the bundle; no code
splitting, consistent with farm/gallery). Unknown ids still fall back to grove.

## 1. Layout & camera

- **Chunk spiral.** Each `BlockEvent` claims the next chunk position on a phyllotaxis spiral
  (reuse the grove's `layout.ts` math), so the island spreads organically outward. A fixed
  cap of chunk slots wraps oldest-first, the voxel analog of the grove's wrapping spiral.
- **XCH paves the chunk, with a floor.** A block's XCH spends lay grass/dirt cubes across the
  chunk's footprint, and more XCH grows it outward. But the footprint is always at least large
  enough to seat the block's special spends (see *Dense blocks* below), so a block with few or
  zero XCH still gets ground graded under its CATs. Gentle seeded height noise (low-amplitude
  value noise keyed to chunk position) gives a landscape feel rather than a flat plane.
- **Special spends on top, stacking when dense.** CAT/NFT/DID place on the chunk surface at
  offsets from `mulberry32(coinId)` — deterministic and stable across snapshot replays (the
  grove's `sproutOffset` trick). When specials outnumber the surface tiles they stack vertically
  rather than spilling outside the chunk (see *Dense blocks*).
- **Camera.** Reuse `createOrbitControl`; the yaw offset orbits the island's center over a
  slow auto-drift. Static framing under `prefers-reduced-motion`.

### Dense blocks (airdrops): when CAT ≫ XCH

A single block can carry far more CAT spends than XCH — an airdrop may be hundreds or thousands
of CATs with little or no XCH. Three rules keep that case legible and spatially bounded:

1. **Guaranteed ground.** Each chunk has a minimum footprint and is sized to
   `max(xchFootprint, footprint to seat the specials, minFootprint)`. Surplus ground beyond what
   XCH paved is filled with dirt/stone — the plot is graded flat to build on — so specials never
   float or land on nothing. "XCH is the land" still holds for the common case; the floor only
   kicks in when specials exceed it.
2. **Stack, don't sprawl.** Once the surface tiles are full, additional CAT blocks stack upward
   into a cluster/spire instead of widening the chunk. An airdrop reads as a sudden bright tower
   of dyed/glass/glowing blocks — distinctive and bounded.
3. **Represent magnitude, not 1:1.** Counts are log-scaled (reuse `scales.ts`): the spire's
   height/footprint encodes the true CAT count, but the number of actual cubes is capped to a
   per-block budget within the family slot caps (§2). A 5 000-CAT airdrop renders as a tall
   capped spire, not 5 000 literal cubes — the same magnitude-over-literalism the grove uses for
   sizes. Cubes up to the budget are individually pickable; any remainder is non-interactive
   spire filler.

## 2. Event → voxel vocabulary

| Event | Representation | Cap |
| --- | --- | --- |
| `SproutEvent` **xch** | grass/dirt land cube — *the island itself* | ~2000 |
| `SproutEvent` **cat** | deterministic material+color block (§3), routed to one of 3 instanced families | opaque 400 / transparent 120 / emissive 80 |
| `SproutEvent` **nft** | framed painting of `imageUrl`; individual mesh (unique texture), clickable → MintGarden | 40 |
| `SproutEvent` **did** | villager standing on its block | 80 |
| `mint` flag | enchant glint on the block + a brief **beacon beam** skyward | — |
| `AmbientEvent` mempool | **rim torches**: count scales with mempool size (analog of fireflies/chickens) | — |
| `AmbientEvent` netspace | sun height/brightness + render-distance fog | — |
| `ReorgEvent` | **creeper** detonates blocks at/above `forkHeight` into a crater, then replay rebuilds | — |
| `amount` (mojos) / count | subtle **stack height** (1–3 cubes) via `scales.ts`; dense blocks stack into spires (see *Dense blocks*); cubes stay unit-sized | — |

## 3. CAT material system (deterministic)

Same stable-from-`assetId` guarantee as `catColor()` today, extended to two hash axes feeding
three render-class families — each its own `InstancedMesh` (the reason CATs split into three
meshes instead of one):

- **Opaque · dyed** (common): Wool / Concrete / Terracotta × the 16 Minecraft dyes.
- **Transparent** (rarer): Stained Glass (dyed) + Glass / Ice / Blue Ice / Honey (fixed tint).
  Needs depth-sorted transparent material.
- **Emissive** (rarest, blooms): Glowstone / Sea Lantern / Shroomlight / Froglight /
  Redstone Lamp / Magma. Emissive material that feeds the bloom pass.

Resolver in `material.ts`:

```ts
resolveCatBlock(assetIdHex): { family: "opaque"|"transparent"|"emissive";
                               materialKey: string; color: { h:number; s:number; l:number } }
```

`hash slice 1 → family + material`, weighted so opaque is common and emissive rare (the
"ooh, a glowing one" feel). `hash slice 2 → dye` for dyeable materials; fixed materials use
their intrinsic color. ~70 stable species. The 16 dyes live in `palette.ts` as the authentic
in-game RGB values.

## 4. Day–night cycle, sky, postfx

- Slow ~couple-minute loop driven by a clock in `mine.ts`. **Netspace** nudges peak sun
  height/brightness and fog distance (bigger chain → grander vista), reusing the grove's
  moonlight-from-netspace mapping inverted to a full cycle.
- `sky.ts`: gradient sky + blocky drifting clouds by day; star field + blocky moon by night
  (adapt the grove's `sky.ts`). Distance fog scales with netspace.
- **Nearest-filter pixel textures** (`THREE.NearestFilter`, ~16×16 per material) — a crisp,
  deliberate contrast to the grove's soft bloom-heavy look.
- Reuse shared `postfx.ts` (bloom + ACES) so emissive blocks, beacon beams, and torches glow
  at night.

## 5. Ambient, status, reorg

- **Mempool** → rim torches lit around the island edge; count scales with mempool size. (VFX
  in `vfx.ts`, instanced.)
- **Netspace** → sun height/brightness + fog distance (§4).
- **Signal lost** → sky holds/dims toward dusk (matches grove/farm dimming behavior).
- **Reorg** → a creeper explosion at the leading edge; blocks with `height >= forkHeight` are
  cleared (instanced slots released) leaving a brief crater, then the snapshot/live replay
  rebuilds them. Tracks the height of each placed instance so the cull is exact.

## 6. Camera & picker

- **Camera:** shared `createOrbitControl` orbiting the island center; slow auto-drift.
- **Picker:** reuse the shared canvas picker (not self-managed input). `pickables()` returns
  the terrain + CAT instanced meshes, NFT meshes, and villager meshes; `metaFor(obj,
  instanceId)` resolves the originating `SproutEvent`; `setHovered` boosts instance color.
  NFT click → the same detail card with MintGarden link + media preview as grove.

## 7. UI changes

The legend picker `<select>` gains a `mine` / "Mineworld" entry from the registry (no other UI
change — console, detail card, status indicator untouched). Legend swatches for the active
theme: land — XCH spend; block — CAT (material+color = asset); painting — NFT (clickable);
villager — DID; beacon — mint; torches — mempool; sun/moon — netspace + time; creeper —
reorg.

## 8. Testing

DOM-free units, mirroring `OrbitState` / `resolveTheme` / existing layout tests:

- `material.ts`: determinism (same `assetId` → same result), family weighting distribution,
  dye indexing within the 16-color set, fixed materials ignore the dye axis.
- `layout.ts`: phyllotaxis chunk positions, wrap at the slot cap, deterministic per-coin
  in-chunk offset.
- Day-night/netspace mapping math: sun height/brightness and fog as pure functions of the
  clock phase and netspace.
- Block-geometry validity: every material/variant merges to a non-null geometry with vertices
  (same guard as `flora-geometry.test.ts`).
- Registry: `mine` registered with a non-empty legend; unknown id still falls back to grove.
- `npm run typecheck` and `npm run lint` stay clean.

## 9. Out of scope

- Live theme switching without reload (unchanged; the snapshot replay repopulates the new
  scene, as today).
- Server or shared-event-type changes — none needed; the theme consumes the existing events.
- "Go wide" CAT materials (bamboo/slime/non-cube) — explicitly deferred to keep cube-instancing.
- Mob behavior/AI beyond the static villager and decorative torches.
