# web/

Three.js browser app that renders the 3D scene. Built with Vite; dev server on `:5173` proxies `/ws` to `:8080`.

Open `http://localhost:5173/?demo=1` for synthetic events without a running server.

## Theme system

The frontend supports multiple visualizations ("themes") behind the `Visualization` interface (`src/themes/types.ts`). The registry in `src/themes/index.ts` resolves the active theme from `?theme=` query param or `localStorage["grove.theme"]` (default: `grove`). Switching from the legend persists the choice and reloads; the WebSocket snapshot replay repopulates the new scene. Themes own their entire Three.js scene.

Five themes ship: `grove`, `farm`, `gallery`, `mine`, `board`. Shared helpers (instancing, textures, CAT colors, amount scales, PRNG) live in `src/themes/shared/`.

### `InstancedKind` (`src/themes/shared/instanced.ts`)

Shared `THREE.InstancedMesh` wrapper used by all themes:

- Constructor accepts `THREE.Material | THREE.Material[]` (array enables per-face BoxGeometry materials).
- `mesh.count` starts at 0 and grows as `plant()` is called — large caps (e.g. 6 000 for terrain) are cheap until filled.
- `Pose` has an optional `y?: number` for vertical offset (used by mine for terrain elevation).
- `clearWhere(predicate)` zeroes matching slots by scale-0 matrix — used for reorg culling without a full clear.
- `boundsRadius` / `boundsCenterY` constructor params pin the bounding sphere so raycasting works before the spiral fills out.

## Themes

### grove (`src/themes/grove/`)

Bioluminescent night meadow.

- `grove.ts` owns the Three.js renderer, camera orbit, and event dispatch. Exposes setter hooks (`setSproutHandler`, `setAmbientHandler`, etc.) wired by `start()` to `FloraSystem` and `Fireflies`.
- `FloraSystem` (`flora.ts`) uses `THREE.InstancedMesh`. Each kind (grass, mushroom, bloom, wisp) has 3 geometry variants and a fixed slot cap: grass 800, mushroom 140, bloom 40, wisp 80. Slots wrap (oldest overwritten).
- `layout.ts` places blocks on a phyllotaxis (sunflower-seed) spiral. Within each block's cluster, `sproutOffset` uses `mulberry32` seeded from the coin id for deterministic, stable scatter.
- `palette.ts` provides scene colors; CAT asset colors are hashed into one of 12 bioluminescent hues by `themes/shared/cat-color.ts`.
- `sky.ts` scales moonlight with netspace and pulses on new blocks.

### farm (`src/themes/farm/`)

Daytime crop field with serpentine rows. Each block is the next row, plowed by a tractor in alternating directions; crops sprout behind it (wheat=XCH, gourd=CAT, sunflower=NFT, scarecrow=DID). Chickens=mempool, sun brightness=netspace, crows=reorg.

`CropSystem` uses `InstancedKind` with 3 geometry variants each; slot caps: wheat 800, gourd 300, sunflower 40, scarecrow 80. Slots wrap (oldest overwritten).

A distant wind farm (`turbines.ts`) stands on the horizon as scenery — seeded random groupings, rotors turning idly, with a gust sweeping downwind across the ridge on each new block.

The surroundings are static scenery, built once at scene construction and never updated per frame. `terrain.ts` owns the ground: a `groundHeight(x, z)` height field displaces the turf disc, damped to **exactly zero** over the box the farm occupies — the crops, tractor, chickens, fence, furrows, soil strips and every `blobShadow` are placed at a hard-coded `y` and none of them sample a ground height — and damped to zero again under the hills, whose lower hemispheres are buried beneath the turf and so cannot tolerate ground that rises or dips at their fringe. Anything that stands on the rolling ground (trees, hedges, bales, boulders) seats itself with `groundHeight`.

`landscape.ts` paints the parcels, mowing stripes, dirt lane and barnyard apron onto a canvas draped over a clone of that same displaced surface, and punches the field's footprint back out as its last step so nothing can be painted under the crop rows. `scenery.ts` has the trees, hedgerows and far tree line; `props.ts` the boulders, tufts, bales and barnyard clutter, rejection-sampled clear of the crop rows, the tractor's headlands, the barnyard and the camera's foreground.

### gallery (`src/themes/gallery/`)

Interior art gallery showing NFT mints as framed canvases on illuminated walls. Navigate with arrow keys (desktop) or swipe (mobile). Spotlight warmth tracks netspace; lights pulse on new blocks; reorg removes pieces. Non-NFT events are ignored.

### mine (`src/themes/mine/`)

Minecraft-inspired voxel island growing on a phyllotaxis spiral. XCH spends pave grass/dirt land; CATs become color-and-material voxel blocks (family + dye hashed from assetId); NFTs become framed paintings (clickable → MintGarden); DIDs become villager figures. Rim torches track mempool; 150 s day-night cycle scales with netspace; mints fire beacon beams; reorg triggers a creeper burst. Terrain is persistent (keyed by block-slot index); only activity-layer specials churn.

- `island.ts` — `Island` class: persistent grass/dirt instanced terrain (6-material per-face grass blocks, 6 000-slot caps, build-to-stable via `Map<number, ChunkGround>`).
- `cats.ts` — `CatBlocks`: 3 `InstancedKind` families (opaque wool, transparent glass, emissive glowstone); slot caps opaque 2000 / transparent 600 / emissive 400; 600-per-block budget caps airdrop bursts. Uses `resolveCatBlock()` from `material.ts` for family + dye assignment.
- `material.ts` — `resolveCatBlock()`: maps a CAT `assetId` hash to a `CatFamily`, material name, and dye color. Separated from `cats.ts` so material logic is independently testable.
- `water.ts` — translucent ocean plane (GPU vertex wave shader); `WATER_LEVEL` constant used by terrain to align shoreline.
- `structures.ts` — `Villagers` (80-cap pool mesh, pop-in scale animation) + `Paintings` (40-cap, launcher-id–proxied NFT art via `gallery/media.ts` + `ui/media.ts` (`mediaSrc`)).
- `vfx.ts` — `Vfx`: beacon columns, rim torches, creeper-burst particle system (frame-rate-independent via real `dt`).
- `sky.ts` — pure functions for 150 s day-night cycle; `createMineSky()` drives sun + moon `DirectionalLight` and `FogExp2`.
- `textures.ts` — procedural 16×16 `NearestFilter` pixel textures (wool weave, glass pane, glowstone cells, grass top/side, dirt).
- `layout.ts` — `chunkPosition()` phyllotaxis spiral, 7×7 Chebyshev-ordered floor grid, `seatCell()` stack-not-sprawl seating, `chunkElevation()` deterministic terrain height (max 1 block).

### board (`src/themes/board/`)

"The Big Board" — a Solari split-flap departure board rendering the chain as a live spend ledger. Each spend flips in as a new row (per-character riffle via `FlapGrid`, an instanced cell grid with a per-instance glyph attribute); a header strip shows block/mempool/netspace/clock, the wheel scrolls back through history (newest-first, 500-deep, with a LIVE/HISTORY header marker), and reorg riffles rows back to the fork height. Pure formatting (`rows.ts`, `glyphs.ts`, `palette.ts`) is unit-tested.

## Network

`GroveFeed` (`src/net/feed.ts`) connects to the WebSocket server, handles `Hello`/`Snapshot`/`Batch` messages, and dispatches `GroveEvent`s to the active theme. The `DrainQueue` drains the snapshot at 120 events/frame (~1.5 s at 60 fps) to avoid a single-frame spike.

## Tests

```sh
npm test                    # all web tests
npx vitest run web/test/    # web tests only
```
