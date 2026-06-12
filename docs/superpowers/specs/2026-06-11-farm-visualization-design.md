# Selectable Visualizations + Farm Theme — Design

2026-06-11

## Goal

Make the front-end visualization selectable in the UI and add a second, farm-themed
visualization alongside the existing grove. Both themes render the same data — XCH/CAT/NFT/DID
spends, blocks, mempool, netspace, reorgs — but each may represent it in structurally
different ways (the farm is not a reskin of the grove).

## Decisions made during brainstorming

- **Switch mode:** persist the choice and reload the page. The WebSocket snapshot
  (last 500 events replayed over ~3 s) repopulates the new scene, so no live teardown
  logic is needed.
- **Farm metaphor:** row crops planted by a tractor (concept A), with the fresher
  daylight palette of the orchard concept (soft blue sky, light haze, fresh greens,
  warm soil browns) instead of golden-hour amber.
- **Architecture:** self-contained theme modules behind a tiny `Visualization`
  interface and registry; themes own their entire scene (camera, layout, lighting,
  event consumption).

## Architecture

### Folder layout

```
web/src/
  themes/
    index.ts          registry: { grove, farm }; resolve/persist active theme
    types.ts          Visualization + VisualizationHandle interfaces
    shared/
      instanced.ts    InstancedKind/Pose/Slot extracted from grove flora.ts
      textures.ts     glowTexture (moved from scene/textures.ts)
    grove/            grove.ts, flora.ts, fireflies.ts, sky.ts, ground.ts,
                      layout.ts, palette.ts — moved, behavior unchanged
    farm/             all new farm scene code
  net/, ui/           shared, theme-agnostic
```

`main.ts` shrinks to: resolve theme → `theme.start(canvas, feed)` → attach shared UI
(legend, console, detail card, picker) via the returned handle. The current grove
wiring in `main.ts` (flora + fireflies + handler hookup) moves into
`themes/grove/index.ts` nearly unchanged.

### Interfaces

```ts
interface Visualization {
  id: string; // "grove" | "farm"
  label: string; // shown in the legend picker
  legend: Array<[swatchClass: string, label: string]>;
  start(canvas: HTMLCanvasElement, feed: GroveFeed): VisualizationHandle;
}

interface VisualizationHandle {
  camera: THREE.Camera; // for the picker raycaster
  pickables(): THREE.Object3D[]; // hover/click targets
  metaFor(obj: THREE.Object3D, instanceId: number | undefined): SproutEvent | null;
  setHovered(obj: THREE.Object3D | null, instanceId: number | undefined): void;
}
```

### Theme selection

Priority: `?theme=` URL param → `localStorage["grove.theme"]` → default `"grove"`.
Unknown ids fall back to grove silently. The legend picker writes localStorage,
rewrites the `?theme=` param, and reloads. `?demo=1` works identically in both themes.
Both themes are statically imported — no code splitting (Three.js dominates the bundle).

### Shared instancing module

`InstancedKind` (slot ring buffer, grow easing, sway, per-instance color highlight,
raycast metadata, pinned bounding sphere) is theme-neutral and moves to
`themes/shared/instanced.ts`. Grove flora and farm crops both use it; sway amplitude
is already a constructor parameter (wheat sways like grass, gourds barely move).

## Farm theme (`themes/farm/`)

Daylight scene: soft blue sky, light distance haze (no dark fog), fresh green turf,
warm brown plowed soil. Low-poly barn at one field edge. Directional sun +
hemisphere light.

### Layout — serpentine rows

Fixed rectangular field (~44 × 40 units, ~48 rows). Each `BlockEvent` plows the next
row; direction alternates per row so the tractor path is continuous. When rows run
out, planting wraps to row 0 and the oldest crops are plowed under (the farm's
version of the grove's 300 wrapping spiral slots). Spends plant in arrival order
along the row at fixed spacing with small coin-id-seeded jitter; overflow from busy
blocks packs in with jittered positions, so crowded rows read as dense blocks.

### Tractor — block indicator (replaces ripple + sky pulse)

On each block, a box-geometry tractor drives the new row over ~2.5 s. Each crop's
grow animation starts when the tractor has passed its row position. If the next
block arrives before the pass finishes (e.g. during snapshot replay), the tractor
jumps to the new row and pending crops pop in immediately — replay compresses
naturally, live blocks get the full pass.

### Crops

| Event | Representation                                                                                                              | Cap |
| ----- | --------------------------------------------------------------------------------------------------------------------------- | --- |
| XCH   | Wheat stalks; height = log(amount) (reuse grove's `xchHeight` scale); 3 geometry variants                                   | 800 |
| CAT   | Gourds (pumpkin / cabbage / tall squash); hue from the same `catColor` asset hash, re-lit for daylight; girth = log(amount) | 140 |
| NFT   | Sunflowers (head + petal ring + stalk); mint = oversized head + brief golden glow sprite                                    | 40  |
| DID   | Scarecrows (cross-post, sacking head), sparse and distinctive                                                               | 80  |

### Ambient, status, reorg

- **Mempool** → chicken flock milling near the barn; count scales with mempool size
  (analog of fireflies). On a new block, chickens briefly chase the tractor.
- **Netspace** → sun warmth/intensity (the moonlight mapping, inverted to daylight).
- **Signal lost** → sky dims toward overcast.
- **Reorg** → crow flock sweeps across the youngest rows; crops there dip/wilt for a
  couple of seconds. Visual only — nothing is deleted (matches grove gust+scatter).

### Camera

Slow low arc drifting along the field's long edge, looking across the rows toward
the barn. Static framing under `prefers-reduced-motion` (tractor still moves — it is
the block signal; chicken/crow counts are reduced, like the grove's firefly count).

### Picker

Unchanged mechanics: crop instanced meshes + scarecrow meshes are pickables, hover
boosts instance color, click shows the same detail card.

## UI changes

The legend body gains a "scene" row at the top: a `<select>` built from the registry
(grove / farm). Changing it persists the choice and reloads. The swatch list below it
comes from the active theme's `legend` array. Farm legend entries: wheat — XCH spend
(taller = larger); gourd — CAT transfer (color = asset, plumper = larger);
sunflower — NFT (blooms big on mint); scarecrow — DID activity; chickens — mempool;
sunlight — netspace; tractor pass — new block; crows — reorg. Collapse behavior and
its localStorage flag are unchanged. Console, detail card, and status indicator are
untouched.

## Testing

- `farm/layout`: serpentine row positions alternate direction, wrap at the row
  count, jitter is deterministic per coin id.
- Farm geometry validity: every crop variant merges to a non-null geometry with
  vertices (same guard as `flora-geometry.test.ts`).
- Registry: unknown id falls back to grove; both themes registered with non-empty
  legends.
- Existing layout/palette/flora-geometry tests keep passing with updated import
  paths.
- `npm run typecheck` and `npm run lint` stay clean.

## Out of scope

- Live theme switching without reload (scene disposal/lifecycle).
- Server or shared-event-type changes — none are needed.
- Additional themes beyond grove and farm (the registry makes them cheap later).
