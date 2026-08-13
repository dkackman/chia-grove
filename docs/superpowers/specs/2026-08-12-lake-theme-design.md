# Lake theme — submerged depth-strata visualization

Date: 2026-08-12
Status: approved design, ready for implementation planning

## Summary

A sixth visualization, `lake`, rendering the chain as a submerged freshwater scene.
The camera sits inside the water column and orbits. Each block is a horizontal
band of water; the newest band sits just under the surface and older bands sink,
so chain history reads as literal depth. XCH and CAT spends are fish swimming
circuits within their band, NFT mints are jellyfish carrying their art in a
translucent bell, DIDs are turtles.

The lake is the first theme in a water register — the five existing themes cover
night meadow, day field, gallery interior, voxel island, and departure board — so
it adds a genuinely new look rather than a re-skin. It also gives large XCH
spends a payoff no current theme has: amount maps to fish size, so a whale spend
is visibly a whale.

## Goals

- A complete, self-contained `Visualization` following the established theme
  contract, selectable from the legend like any other theme.
- Depth-as-history: the whole recent chain legible in one shot.
- Reuse the existing NFT media pipeline (proxy, content filter, late flags)
  without modification.
- Pure layout and scale logic unit-tested, matching repo convention.

## Non-goals

- No server or `@grove/shared` changes. The theme consumes the existing
  `GroveEvent` union; `PROTOCOL_VERSION` is untouched.
- No sound. (Tracked separately as a possible cross-theme feature.)
- No surface-crossing camera. The camera stays submerged; the surface is
  scenery viewed from below.
- No boids/flocking simulation. Fish follow deterministic parametric paths.

## Architecture

New folder `web/src/themes/lake/`, registered in `web/src/themes/index.ts`.
The split mirrors `mine/`, which is the closest existing analogue:

| File         | Responsibility                                                                 |
| ------------ | ------------------------------------------------------------------------------ |
| `index.ts`   | The `Visualization` object: id, label, legend, and system wiring in `start()`. |
| `lake.ts`    | Runtime: renderer, submerged orbit camera, feed dispatch, setter hooks.        |
| `layout.ts`  | Pure band/depth math and deterministic per-spend scatter. Unit-tested.         |
| `scales.ts`  | Pure amount → fish size / school size mapping. Unit-tested.                    |
| `shoal.ts`   | `Shoal`: instanced swimming fish for XCH and CAT.                              |
| `jellies.ts` | `Jellies`: NFT jellyfish pool with art bells.                                  |
| `turtles.ts` | `Turtles`: DID figures, slow drift.                                            |
| `bed.ts`     | Lake bed floor plus static instanced weeds (vertex-shader sway).               |
| `water.ts`   | Surface seen from below, light shafts, depth fog, caustics.                    |
| `vfx.ts`     | Mempool bubble columns, per-block ripple, reorg predator strike.               |
| `palette.ts` | Scene colors.                                                                  |

`lake.ts` follows `mine.ts` exactly in structure: it builds the renderer,
`PerspectiveCamera`, `createOrbitControl`, `createPostFx`, and
`createFrameLimiter`; subscribes to `feed.onEvent`; and returns an object with
`setSproutHandler`, `setBlockHandler`, `setReorgHandler`, `setAmbientHandler`,
`setContentFlagHandler`, `setUpdateHandler`, and `isDragging`. `index.ts`
instantiates the systems and wires those hooks, then returns the
`VisualizationHandle`.

### Reuse boundary — what ports and what does not

Reused as-is from `themes/shared/`: `createOrbitControl` (`orbit.ts`),
`createPostFx` (`postfx.ts`), `createFrameLimiter` (`frame-limiter.ts`),
`LoadPool` (`load-pool.ts`), `catColor` (`cat-color.ts`), `mulberry32`
(`util.ts`), and `sensitivePlaceholderTexture` (`textures.ts`).

`InstancedKind` is **not** used anywhere in this theme. An earlier draft of this
spec had the bed weeds using it, on the reasoning that weeds are rooted and sway
just like grass. On inspection that does not hold: `InstancedKind.plant()`
requires a `SproutEvent` as its `meta`, because every existing caller plants
event-driven objects that the picker can later identify. Weeds are scenery with
no event behind them, so using the class would mean fabricating synthetic
`SproutEvent`s purely to satisfy the signature, and `metaAt()` would then hand
out fake spends. The weeds are instead one plain `InstancedMesh` with static
matrices written once at construction and sway done in the vertex shader — the
same `onBeforeCompile` technique `mine/water.ts` already uses, and cheaper than
`InstancedKind`'s per-frame CPU pass since the matrices never change.

`InstancedKind` deliberately does **not** back the fish. Its model is a rooted
plant: an instance is pinned at `(x, z)`, grows upward from a base over
`GROW_SECONDS`, and leans in a shared wind field. Fish need position integrated
along a path each frame and orientation derived from heading, which that class
has no way to express. `Shoal` therefore owns its own `THREE.InstancedMesh` and
reimplements only the parts that earned their place in `InstancedKind`:

- a wrapping slot pool (oldest overwritten at cap),
- `clearWhere`-style predicate culling for reorg, including the
  `mesh.count` shrink to the highest still-active slot,
- `metaAt(index)` for picking,
- `setColorAt` highlight with the base color restored on unhover,
- initializing every instance color to white at construction (skipping this
  renders untinted instances black).

## Layout — depth strata

`layout.ts` is pure (no `THREE` imports beyond types, no DOM) and unit-tested.

- `bandDepth(age)` maps a band's age **in blocks** to its Y position: the newest
  band sits just below the surface, each older band a fixed step deeper, down to
  the bed, where it clamps.
- There is no band ring or per-band state. Each planted object stores the global
  block counter at plant time (`bornBlock`); its depth is
  `bandDepth(blocksSeen - bornBlock)`, recomputed each frame. This is the whole
  sinking mechanism — one subtraction, no bookkeeping to keep in sync.
- `MAX_BANDS` is 40, not the 200 block slots `mine` uses. It is the clamp depth,
  and it has to be a number of bands that actually fits in a viewable column:
  at `BAND_STEP` 1.5 units, 40 bands is a 60-unit descent, which frames from
  mid-column. 200 bands would be a 300-unit shaft, most of it out of sight.
  Forty bands is roughly 12 minutes of chain at 18.75 s blocks.
- Objects older than the clamp keep rendering at the bed until their slot is
  recycled by the pool wrapping at its cap. No explicit eviction pass is needed.
- Within a band, `seatOffset(coinId)` uses `mulberry32` seeded from the coin id
  to scatter spends deterministically in radius and angle, the same technique
  `grove/layout.ts` uses. This matters because the WebSocket snapshot replays
  on every theme switch and reconnect: a deterministic seat means the same
  lake rebuilds each time rather than reshuffling.

The camera orbits at mid-column depth, looking slightly upward so the surface
and its light shafts stay in frame, easing outward as bands fill the way
`mine.ts` eases `camDist` toward the spiral's current extent.

## Event mapping

| Event                 | Lake response                                                                         |
| --------------------- | ------------------------------------------------------------------------------------- |
| `block`               | Open a new band at the top; sink all others one step; ripple across the surface.      |
| `sprout` kind `xch`   | A fish in the current band; size from a log scale on `amount`.                        |
| `sprout` kind `cat`   | Fish schooling by `assetId`, hue from `catColor(assetId)`, school size from `amount`. |
| `sprout` kind `nft`   | A jellyfish in the current band carrying the art in its bell.                         |
| `sprout` kind `did`   | A turtle, drifting slowly through the band.                                           |
| `mint` flag           | A bright shaft at the spawn point, analogous to `mine`'s beacon.                      |
| `ambient` mempoolSize | Bubble-column density on the bed.                                                     |
| `ambient` netspace    | Water clarity (fog density) and light-shaft strength.                                 |
| `reorg`               | `clearAbove(forkHeight)` on every system, plus a predator strike sweeping through.    |
| `content-flag`        | `jellies.markSensitive(launcherId)`.                                                  |

Fish swim horizontal circuits _within_ their own band rather than roaming the
volume. This is the load-bearing constraint of the whole design: it keeps the
depth-history legible while still making the scene feel alive.

## Systems

### `Shoal` (`shoal.ts`)

Two instanced fish meshes, one for XCH and one for CAT. Each uses a single
hand-built fish geometry rather than the 3-variant sets `FloraSystem` and
`CropSystem` use: a shoal already varies by per-instance size, color, loop
radius, and speed, so geometry variants would add tripled setup for variety the
eye cannot separate at swimming distance.

Per-slot state: `meta` (the `SproutEvent`), `bornBlock`, loop radius, angular
speed, angular phase, vertical bob phase, size, base color. Each frame the
update pass advances the angle, composes position from the slot's current band
depth plus bob, and orients the instance along its tangent. A per-instance tail
phase adds a wiggle so neighbors are not in lockstep — the same desync idea
`InstancedKind`'s sway uses.

Caps: XCH 1200, CAT 1200. Both wrap.

CAT schooling: fish sharing an `assetId` within a band are seated on nearby
loop radii with close angular phases, so they read as one school without any
neighbor queries.

### `Jellies` (`jellies.ts`)

Near-port of `mine`'s `Paintings`, with different geometry. Object pool of
`THREE.Group`s (cap 40), each a translucent bell with the art on a disc inside
it and trailing tentacle strands, pulsing slowly and drifting within its band.

Carried over from `Paintings` because each solves a real problem already hit in
production:

- `byLauncher` map so one launcher id hangs exactly one jellyfish — a mint
  arrives as an eve plus a lineage spend, and transfers re-spend it.
- `LoadPool.submit` with a `stillWanted` guard, because replay churns hundreds
  of NFTs through the pool and in-flight loads must not land in a recycled slot.
- `resolveMedia` / `loadArtTexture` / `thumbnailSrc` for art, and
  `sensitivePlaceholderTexture` for `blur` and `placeholder` dispositions —
  filtered art is never fetched.
- `markSensitive(launcherId)` to swap in the placeholder on a late
  `ContentFlagEvent`.
- `clearAbove(forkHeight)` dropping the launcher mapping alongside the slot.

The bell's own translucency carries the sensitive-content treatment, so no new
filtering path is introduced.

### `Turtles`, `bed.ts`, `water.ts`, `vfx.ts`

`Turtles`: small `Group` pool (cap 30) on slow drift paths, same pool-and-
recycle shape as `Jellies` without the media pipeline.

`bed.ts`: the lake floor plus one `InstancedMesh` of weeds, matrices written
once at construction from a `mulberry32` scatter and swayed in the vertex
shader, so the bed costs nothing per frame.

`water.ts`: the surface plane viewed from below (starting from `mine/water.ts`'s
vertex wave shader), volumetric-ish light shafts, `FogExp2` for depth murk, and
caustics on the bed. Exposes `setNetspace` and a `rippleAt` pulse for blocks.

`vfx.ts`: bubble columns whose density tracks mempool, and the reorg predator —
a shape that sweeps through and scatters, structurally the same one-shot
animation as `mine`'s creeper burst.

## Picking

Both fish and jellyfish are pickable, so the shared detail card works with no
changes. `index.ts` returns `pickables()` and `metaFor()` composed across the
systems, exactly as `mine/index.ts` does. `metaFor` returns a plain
`SproutEvent`, which is already a valid `CardMeta`. Hover highlight goes through
`setHovered` and the instance-color boost. No `pickHeight` / `selectHeight` — the
lake has no block detail view.

## Testing

Two tiers, both already established in this repo. Pure logic is unit-tested the
way `mine/layout.ts` and `board/rows.ts` are. Scene-graph classes are tested by
constructing them against a real `new THREE.Scene()` in Node, exactly as
`web/test/mine-structures.test.ts` tests `Paintings` — no renderer, no DOM, so
it runs in plain vitest. `Shoal`, `Jellies`, and `Turtles` therefore take an
optional cap constructor parameter, the way `Paintings` does, so a test can pass
a cap of 1 and force the pool to wrap on the next plant.

- `web/test/lake-layout.test.ts` — band depth mapping, monotonic sinking, the
  clamp at `MAX_BANDS`, and determinism of `seatOffset` for a given coin id.
- `web/test/lake-scales.test.ts` — amount → fish size is monotonic and bounded
  at both ends, school size is a positive integer, and both handle dust, whale,
  empty-string, and non-numeric amounts.
- `web/test/lake-geometry.test.ts` — fish, weed, bell, and surface geometries
  are valid renderable `BufferGeometry` with a non-zero position count, matching
  `web/test/mine-geometry.test.ts`.
- `web/test/lake-shoal.test.ts` — plant/`metaAt` round-trip, pool wrap at cap,
  `clearAbove` removing only slots at or above the fork height and shrinking
  `mesh.count`, and an `update()` pass placing an instance at the Y that
  `bandDepth` predicts for its age.
- `web/test/lake-jellies.test.ts` — launcher dedupe, wrap freeing the launcher
  mapping, and `clearAbove` dropping launcher mappings alongside slots.
- `web/test/themes.test.ts` — extend with the registration test each theme has:
  `lake` is in `THEMES` and resolvable by URL param and stored value.

`npm run typecheck`, `npm run lint`, and `npm test` must pass.

## Risks

The `Shoal` motion system is the only piece with no existing analogue in the
codebase; everything else follows a path `mine` and `farm` already cut. If
per-frame fish updates prove expensive at full caps, the mitigation is the one
`InstancedKind` already demonstrates — skip the recompute and GPU upload when
nothing can have moved — though fish, unlike settled terrain, animate
continuously, so the realistic lever is lowering the caps.

Legend swatch classes (`sw-fish`, `sw-jelly`, and so on) need adding to
`web/src/style.css` alongside the existing per-theme swatches.
