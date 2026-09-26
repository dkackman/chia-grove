# web/

Three.js browser app that renders the 3D scene. Built with Vite; dev server on `:5173` proxies `/ws` to `:8080`.

Open `http://localhost:5173/?demo=1` for synthetic events without a running server.

## Theme system

The frontend supports multiple visualizations ("themes") behind the `Visualization` interface (`src/themes/types.ts`). The registry in `src/themes/index.ts` resolves the active theme from `?theme=` query param or `localStorage["grove.theme"]` (default: `grove`). Switching from the legend persists the choice and reloads; the WebSocket snapshot replay repopulates the new scene. Themes own their entire Three.js scene.

Six themes ship: `grove`, `farm`, `gallery`, `mine`, `board`, `timelord`. Shared helpers (instancing, textures, CAT colors, amount scales, PRNG) live in `src/themes/shared/`.

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
- `sky.ts` scales moonlight with netspace and pulses on new blocks. The moon is a vertex-billboarded shader disc (maria, limb darkening, halo; premultiplied blending so it hides the stars behind it) sat low on the horizon — the orbit camera only sees ~7° above horizontal. The aurora is a shader on an open cylinder arc (ray streaks, wavy hem, soft falloff on every edge), faint at rest and flaring on each block.
- `ground.ts` is a procedural `ShaderMaterial` floor (with fog chunks): dark soil, faint moss patches, a domain-warped Voronoi mycelium network that breathes slowly, and block ripples drawn in-shader from a `RipplePool` (vec4 uniform per slot) — a soft wavefront that lights the mycelium in its wake. `glsl.ts` holds the shared hash/noise snippet.

### farm (`src/themes/farm/`)

Daytime crop field with serpentine rows. Each block is the next row, plowed by a tractor in alternating directions; crops sprout behind it (wheat=XCH, gourd=CAT, sunflower=NFT, scarecrow=DID). Chickens=mempool, sun brightness=netspace, crows=reorg.

`CropSystem` uses `InstancedKind` with 3 geometry variants each; slot caps: wheat 1600, gourd 600, sunflower 80, scarecrow 160. Slots wrap (oldest overwritten).

A distant wind farm (`turbines.ts`) stands on the horizon as scenery — seeded random groupings, rotors turning idly, with a gust sweeping downwind across the ridge on each new block.

`sky.ts` draws a camera-following shader sky dome (zenith→horizon gradient ending in the fog colour `FARM.haze`, warm haze on the sun's side, fbm clouds, sun disc + glow) and owns the lights: a low warm key `DirectionalLight` shining from exactly `SUN_DIR` (where the dome paints the disc, kept inside the camera's frame) plus a cool fill from behind the camera; netspace scales both. `clouds.ts` patches every lit `MeshStandardMaterial` in the scene once, after construction (`applyCloudShadows`), with world-space drifting cloud shadows that attenuate direct light only — so they roll over the rolling ground and hills too. `soil.ts` is the plowed rows: baked albedo + normal maps (raised bed, tine grooves, clods) and an instanced `aPlow` attribute (plow start, direction, previously plowed) that the shader uses to reveal each row behind the tractor and darken freshly turned soil as wet, drying over ~`WET_SECONDS`; `plowReachedAt` mirrors both the shader and `Tractor.hasPassed` (tested).

The surroundings are static scenery, built once at scene construction and never updated per frame. `terrain.ts` owns the ground: a `groundHeight(x, z)` height field displaces the turf disc, damped to **exactly zero** over the box the farm occupies — the crops, tractor, chickens, fence, furrows, soil strips and every `blobShadow` are placed at a hard-coded `y` and none of them sample a ground height — and damped to zero again under the hills, whose lower hemispheres are buried beneath the turf and so cannot tolerate ground that rises or dips at their fringe. Anything that stands on the rolling ground (trees, hedges, bales, boulders) seats itself with `groundHeight`.

`landscape.ts` paints the parcels, mowing stripes, dirt lane and barnyard apron onto a canvas draped over a clone of that same displaced surface, and punches the field's footprint back out as its last step so nothing can be painted under the crop rows. `scenery.ts` has the trees, hedgerows and far tree line; `props.ts` the boulders, tufts, bales and barnyard clutter, rejection-sampled clear of the crop rows, the tractor's headlands, the barnyard and the camera's foreground.

### gallery (`src/themes/gallery/`)

Interior art gallery showing NFT mints as framed canvases on illuminated walls. Navigate with arrow keys (desktop) or swipe (mobile). Spotlight warmth tracks netspace; lights pulse on new blocks; reorg removes pieces. Non-NFT events are ignored.

- `pieces.ts` — each piece is a bevelled `ExtrudeGeometry` moulding (finish picked per index from `FRAME_FINISHES`: lacquer / walnut / gilt / silver), a passe-partout ring (`ShapeGeometry`, shared ivory or charcoal material) and the art plane (scaled by `ART_SCALE` so the outer frame stays near `frameSize`). Art still goes through `resolveMedia` / placeholder textures unchanged.
- `lights.ts` — `PictureLights`: per-slot brass lamp (hood, arm, bloom-lit lip) and a wall-wash quad drawing the lamp's scalloped light pool plus the frame's soft drop shadow. All instanced by slot index (four draw calls); the wash blends premultiplied (rgb adds light, alpha darkens for the shadow). Heat/hover brighten a lamp; the focused piece's lamp keeps the undimmed level.
- `wall-shader.ts` — the plaster wall `ShaderMaterial` (value-noise plaster, ceiling falloff, picture rail, skirting board) and `wallUniforms` (albedo + ambient) shared by reference with the wash so lit and unlit plaster match. `floor-shader.ts` adds a polished plank floor (AA seams, warm spill near the wall) under the blurred reflection.

### mine (`src/themes/mine/`)

Minecraft-inspired voxel island growing on a phyllotaxis spiral. XCH spends pave grass/dirt land; CATs become color-and-material voxel blocks (family + dye hashed from assetId); NFTs become framed paintings (clickable → MintGarden); DIDs become villager figures. Rim torches track mempool; 150 s day-night cycle scales with netspace; mints fire beacon beams; reorg triggers a creeper burst. Terrain is persistent (keyed by block-slot index); only activity-layer specials churn.

- `island.ts` — `Island` class: persistent grass/dirt instanced terrain (6-material per-face grass blocks, 6 000-slot caps, build-to-stable via `Map<number, ChunkGround>`).
- `cats.ts` — `CatBlocks`: 3 `InstancedKind` families (opaque wool, transparent glass, emissive glowstone); slot caps opaque 2000 / transparent 600 / emissive 400; 600-per-block budget caps airdrop bursts. Uses `resolveCatBlock()` from `material.ts` for family + dye assignment.
- `material.ts` — `resolveCatBlock()`: maps a CAT `assetId` hash to a `CatFamily`, material name, and dye color. Separated from `cats.ts` so material logic is independently testable.
- `water.ts` — flat translucent ocean (`WATER_LEVEL` aligns the terrain) with a pixel-quantized animated ripple pattern and shallows/foam in the fragment shader. The shallows come from a 512² R8 shore mask (4 texels/block, Chebyshev distance to the nearest ground column) that `Island` paints via `markLand` as columns are placed and rebuilds on reorg; uploads are throttled to 4/s.
- `structures.ts` — `Villagers` (80-cap pool mesh, pop-in scale animation) + `Paintings` (40-cap, launcher-id–proxied NFT art via `gallery/media.ts` + `ui/media.ts` (`mediaSrc`)).
- `vfx.ts` — `Vfx`: beacon columns, rim torches, creeper-burst particle system (frame-rate-independent via real `dt`).
- `sky.ts` — pure functions for 150 s day-night cycle (`moonPhase`, `horizonGlow`); `createMineSky()` drives sun + moon `DirectionalLight`, `FogExp2`, a camera-centered gradient sky dome (dawn/dusk glow, hashed square pixel stars) and the square pixel sun + phased moon sprites. The camera only ever sees a few degrees above the horizon, so the painted sun/moon ride a low tilted arc (~12° peak) while the lights keep a steep arc for block shading.
- `clouds.ts` — Minecraft's blocky cloud layer: a deterministic tiling cloud mask (12×4-block cells) merged into row runs, one instanced box per run, wrapped around the camera and drifted in the vertex shader (fixed face shading, manual fog, edge fade). The layer rides a fixed height above the camera so it crosses the visible sky band; its tint comes from `MineSky.cloudColor`.
- `textures.ts` — procedural 16×16 `NearestFilter` pixel textures (wool weave, glass pane, glowstone cells, grass top/side, dirt, square sun, 8-phase moon atlas).
- `layout.ts` — `chunkPosition()` phyllotaxis spiral, 7×7 Chebyshev-ordered floor grid, `seatCell()` stack-not-sprawl seating, `chunkElevation()` deterministic terrain height (max 1 block).

### board (`src/themes/board/`)

"The Big Board" — a Solari split-flap departure board rendering the chain as a live spend ledger. Each spend flips in as a new row (per-character riffle via `FlapGrid`, an instanced cell grid with a per-instance glyph attribute); a header strip shows block/mempool/netspace/clock, the wheel scrolls back through history (newest-first, 500-deep, with a LIVE/HISTORY header marker), and reorg riffles rows back to the fork height. Pure formatting (`rows.ts`, `glyphs.ts`, `palette.ts`) is unit-tested.

- `cabinet.ts` — the physical hardware around the flaps, all procedural SDF shaders (crisp at any size, not pickable): the tiled station wall with an overhead light pool and the cabinet's drop shadow, the enamel cabinet with a brushed-aluminum lip, screws and a bezel status lamp (green LIVE, amber HISTORY, blue BLOCK DETAIL), painted column captions on a rail between header and ledger (a small canvas texture), and an additive glass-cover sheen that drifts with the camera sway. Pure `cabinetLayout()` derives the window/bezel/rail geometry from the grids' placement; the camera fits the cabinet's outer size.
- `FlapGrid` lights itself from a shared `light` window (by reference, so header and ledger light as one board): overhead falloff top→bottom and toward the sides, applied fully to the card but only ~30% to the ink so text stays legible; a leaf mid-flip (instance scale.y < 1) darkens and glints along its edge. Riffle timing is untouched.

### timelord (`src/themes/timelord/`)

The chain as verifiable time: a rising helix of blocks threaded on a braid of three light strands (Chia's challenge, reward and infused-challenge VDF chains). Each block is a crystal (size = spend count, teal→amber = fees) infused as its thread segment grows from the previous one; its spends erupt out of it into inclined Keplerian orbits — XCH coins (silver→green→gold by amount), CAT gems (`catColor`), DID halos. NFTs are holo-foil cards floating outside the helix, tethered to their crystal (gold foil = mint, deduped by launcher, art via `resolveMedia`). The mempool is a vortex funnelling into the next empty slot; a clock dial at the focus height has one tick per slot and a sweep hand for time since the last block (52 s mean); star density tracks netspace. History fades into the abyss below the focus — the wheel / vertical drag / arrow keys travel back through time (the HUD shows LIVE/HISTORY; Esc, double-click or the HUD button return live), clicking a crystal jumps to it.

- `layout.ts` — pure helix/orbit math (`blockPosition`, `orbitFor`, `orbitPoint`, `reachAt`/`scaleAt`, amount/fee scales). `orbitPoint`/`reachAt`/`scaleAt` mirror the orbit vertex shader exactly — keep them in sync.
- `orbiters.ts` — `Orbiters<T>`: instanced bodies whose whole motion lives in the vertex shader (the CPU writes attributes only on birth/death, one contiguous upload per frame). `raycast` is overridden to run the CPU mirror, so picking hits what is drawn. Used for coins, gems, halos and the block crystals (radius-0 orbit).
- `shading.ts` — `SceneUniforms` shared by reference across every material (focus height, head light, pulse) plus the GLSL history fade and hand-rolled lighting (no PMREM).
- `thread.ts` — one braided segment geometry, instanced per block and rotated into place; slots are `seq % MAX_BLOCKS`.
- `particles.ts` (crystal `Glows`, mempool `Vortex`), `cards.ts`, `fx.ts` (shockwaves/flares; block fanfare is throttled so catch-up bursts don't white out), `stage.ts` (nebula, stars, spindle, dial), `controls.ts` (pure `TimeTravel` + pointer/wheel input), `hud.ts`.
- Blocks are addressed by a local, monotonically increasing `seq` (not height); a re-sent height (reconnect snapshot) is skipped along with its spends, and a reorg rewinds `seq` to the first removed block so the replacement chain grows from the fork.

## Network

`GroveFeed` (`src/net/feed.ts`) connects to the WebSocket server, handles `Hello`/`Snapshot`/`Batch` messages, and dispatches `GroveEvent`s to the active theme. The `DrainQueue` drains the snapshot at 120 events/frame (~1.5 s at 60 fps) to avoid a single-frame spike.
