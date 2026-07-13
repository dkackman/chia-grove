# Farm landscape detail — design

## Goal

The farm's surroundings read as a flat green mat. Give the landscape texture and
weight so the farm feels **grounded** — sited in worked countryside rather than
placed on a putting green.

Everything added here is **static scenery**: built once at scene construction,
never updated per frame, no legend entry, no `reducedMotion` branch. The field,
the tractor and the crops stay unambiguously the subject. The detail should be
felt more than noticed.

## Context

What the farm scene currently puts on the ground (see `web/src/themes/farm/`):

- **Turf** — a `CircleGeometry(140, 48)` at exactly `y = 0`, material `map` =
  `mottledTexture(...)`.
- **Field** — a furrow-line plane at `y = 0.012` and 48 instanced soil strips at
  `y = 0.02`, all inside x ∈ [−23, 23], z ∈ [−20, 20].
- **Props** — barn (x = −10, z ≈ −26), silo (x ≈ −4.6, z ≈ −26), a fence at
  z ≈ 22.8, 14 hand-placed trees, three hazy hills.
- **Fake shadows** — `blobShadow` planes at `y = 0.03` under barn, silo, trees.
- **Cloud shadows** — four drifting planes at `y = 0.04` (`sky.ts`), travelling
  +x and wrapping at x = ±60.

Facts the design depends on:

- **The mottled turf texture is invisible.** `mottledTexture` builds a 256 px
  canvas but never sets `repeat`, so it is stretched once across the whole
  280-unit disc. In practice the ground is a solid flat green. This is the single
  biggest cause of the flatness and is fixed first.
- **Everything on the ground assumes `y = 0`.** Crops (`plantPosition`), the
  tractor (`EDGE_X = 24`, y = 0.04), the chickens (home x ≈ −14, z ≈ −23), the
  fence, the furrows, the soil strips and every `blobShadow`. Nothing samples a
  ground height, and nothing should have to.
- **Turbines stand with their tower base at `y = 0`** and rely on the hills
  occluding the base to read as standing on the ridge.
  `web/test/farm-turbines.test.ts` pins the lowest blade tip against the hill
  surface, re-deriving it from the exported `HILLS`.
- **The hills are squashed spheres** — `SphereGeometry(r)` scaled `(1.3, 0.16, 1)`
  and translated to `y = 0`, so their **lower hemisphere is buried** under the
  flat turf and their surface height rises from 0 to ~1.5 within the first 2 % of
  their footprint. Ground that rises near a hill's fringe pokes through it;
  ground that dips there exposes the hill's back-facing underside, which is
  culled and reads as a hole. Undulation must therefore stay away from the hills.
- **Fog** is `FogExp2` at density 0.005 — noticeable past ~100 units, strong by
  ~150. The far distance does not need to be crisp; it needs a silhouette.
- The camera drifts along the field's near edge (z ≈ +34, y ≈ 11) looking at
  (0, 1, −6), pitched down at the field.

## The flat zone

One constant, in `terrain.ts`, defines the region of ground that must stay
**exactly** at `y = 0`:

```ts
/** Ground inside this box stays exactly flat: every system that sits on the
 *  turf (crops, tractor, chickens, fence, furrows, soil strips, blob shadows)
 *  assumes y = 0, and none of them sample a ground height. */
const FLAT = { halfX: 26, centerZ: -3, halfZ: 29 } as const; // z ∈ [−32, 26]
```

It is sized to contain, with margin: the tractor's headland turns (x = ±24), the
fence (z = 22.8), the field (z ∈ [−20, 20]), the barn (z ∈ [−28.3, −23.7]), the
silo, the chicken yard, and every existing `blobShadow`.

## Architecture

`field.ts` is 607 lines and currently owns the turf, the furrows, the soil
strips, the barn, the silo, the fence, the trees, the hills, the shadows and the
chimney smoke. Adding four more categories of scenery to it is not viable. The
surroundings move out into their own modules and `field.ts` keeps the field and
the farmstead.

| module               | owns                                                                  |
| -------------------- | --------------------------------------------------------------------- |
| `terrain.ts` (new)   | the shape of the ground: turf disc, undulation, `groundHeight`, hills |
| `landscape.ts` (new) | the ground overlay canvas: parcels, mowing stripes, track, yard       |
| `scenery.ts` (new)   | trees, hedgerows, far horizon silhouettes, `blobShadow`               |
| `props.ts` (new)     | boulders, grass tufts, scrub, hay bales, barnyard clutter             |
| `field.ts`           | furrows, soil strips, barn, silo, fence, chimney smoke, weathervane   |

Hills move into `terrain.ts` — they are the shape of the ground, and the
undulation is defined in terms of them, so keeping them in `scenery.ts` would
make `terrain.ts` ↔ `scenery.ts` circular. `HILLS` keeps its name and its
contents; `web/test/farm-turbines.test.ts` only changes its import path.

### 1. `terrain.ts` — the ground surface

**Geometry.** `RingGeometry(0, 140, 128, 72)` replaces `CircleGeometry(140, 48)`.
A ring gives 72 radial subdivisions (a circle is a single fan and cannot be
displaced), and its UVs are already world-proportional — `uv = xz / 280 + 0.5` —
so the mottled tile maps linearly.

**Height field.** A pure, exported function; the same one the vertices are
displaced by, so props seat themselves on the surface the renderer draws rather
than on an approximation of it:

```ts
export function groundHeight(x: number, z: number): number;
```

It is `AMPLITUDE * noise(x, z) * damp(x, z)`, where `noise` is a sum of three
sines (wavelengths ≈ 70, 40 and 22 units, normalised to roughly ±1),
`AMPLITUDE = 1.2`, and `damp` is the product of three factors, each of which
takes the height to **exactly zero** where something requires flat ground:

- **`inner`** — `smoothstep(1.0, 1.6, max(|x| / FLAT.halfX, |z − FLAT.centerZ| / FLAT.halfZ))`.
  Zero inside the flat zone; full amplitude by ~1.6× out (x ≈ ±42, z ≈ −49 / +43).
  Chebyshev, not Euclidean, so the flat zone is the rectangle the farm actually
  occupies rather than a circle circumscribing it.
- **`hillMask`** — for each hill, the normalised elliptical distance
  `e = hypot((x − hx) / (1.3 r), (z − hz) / r)`; the mask is the minimum over all
  hills of `smoothstep(1.05, 1.20, e)`. Zero from 5 % inside a hill's footprint
  outward, reaching full amplitude ~5 units clear of the fringe. This is what
  keeps the undulation off the hills' buried underside.
- **`rimFade`** — `1 − smoothstep(95, 120, hypot(x, z))`. The disc's rim is the
  horizon silhouette against the sky; a wavy rim reads as a torn edge.

The net effect is that the roll lives where the flat green actually shows: the
wide wings left and right of the field, and the near turf outside the fence.

**Material.** `mottledTexture` (in `themes/shared/textures.ts`) gains an optional
`repeat` argument. The farm turf passes ~22 (`RepeatWrapping`, one tile per ~13
units) so the ground finally has grain at any distance. This alone is most of the
fix.

Two constraints on that change:

- The grove theme is the other caller (`grove/ground.ts`). `repeat` defaults to
  `1` with no wrapping, so grove's ground is byte-for-byte unchanged.
- **The blotches must wrap.** Today they are drawn at random positions and
  clipped at the canvas edge — invisible when the texture is stretched once, but
  a hard seam on every tile boundary once it repeats. Each blotch is drawn nine
  times (offset by −1, 0, +1 tiles in each axis) so it wraps continuously, and
  the canvas grows to 512² so a 13-unit tile still has usable resolution close
  to the camera.

**Overlay mesh.** A second mesh on a **clone of the displaced geometry**, lifted
`+0.02` in y, carrying the `landscape.ts` canvas as a transparent map with
`depthWrite: false`. Because it shares the terrain's displacement it drapes
instead of z-fighting. This is the same overlay idiom the theme already uses for
the furrow plane and the cloud shadows.

### 2. `landscape.ts` — the ground overlay canvas

A pure canvas painter — `landscapeTexture(): THREE.CanvasTexture` — drawing into
a 2048² transparent canvas in world space (the disc's 280 × 280 bounding square),
seeded from a fixed constant via `mulberry32` so it is identical on every reload.
Everything is drawn at low alpha; the intent is tonal, not graphic.

- **Parcels** — soft-edged polygonal patches outside the field footprint, tinted
  a few percent lighter or darker than the turf, with faint mowing stripes at a
  different angle per parcel. This is what makes the country read as a quilt.
- **Dirt track** — a two-rut lane in worn-earth tones running from the barn doors
  east past the field's edge and off toward the horizon.
- **Barnyard apron** — packed bare earth under and around the barn and silo,
  feathered into the turf, so the farmstead sits in worn ground instead of on
  mown lawn. The strongest single grounding cue in the scene.

The track and apron are painted, not geometry, so they cost nothing and cannot
collide with the props standing on them.

### 3. `scenery.ts` — trees, hedges, horizon

- `TREES`, `makeConifer`, `makeBroadleaf`, `addTrees` move here unchanged, except
  that each tree is now seated at `groundHeight(x, z)` — several of the existing
  trees stand where the ground will now roll — and its `blobShadow` with it.
- **Hedgerows** — lines of low instanced shrubs (a small faceted blob, reusing
  the broadleaf canopy vocabulary) along the parcel boundaries painted in
  `landscape.ts`, seated on `groundHeight`, jittered in scale and offset so they
  read as growth rather than a fence of beads. This gives the parcels a
  silhouette to go with their tone.
- **Far horizon** — a `FAR_HILLS` set behind the existing `HILLS`: lower, flatter,
  hazier, and a line of distant hedgerow silhouettes. Exported separately so the
  `HILLS` contract that `farm-turbines.test.ts` relies on is untouched; both sets
  feed `hillMask`.
- `blobShadow` moves here from `field.ts`; `field.ts` and `props.ts` both import
  it.

### 4. `props.ts` — the static scatter

All merged (per material) or instanced, all seated via `groundHeight`, all
seeded from a fixed constant so a snapshot replay never reshuffles them, all
placed clear of the field, the tractor's headlands, the chicken yard and the
camera's drift path.

- **Boulders and grass tufts** — scattered along the field edges, the fence line
  and the tree bases. These also hide the seam where the turf meets the props.
- **Scrub** — sparse low bushes in the parcels.
- **Hay bales** — a few round bales lying in the pasture, and a small stack
  beside the barn.
- **Barnyard clutter** — a woodpile, a water trough, a ladder leaning on the
  barn, a couple of crates. Human-scale objects near the barn doors, standing on
  the painted apron.

Each prop above a token size gets a `blobShadow`.

### 5. `sky.ts` — one adjustment

The four drifting cloud-shadow planes are flat and travel out to x = ±60, into
the newly rolling wings, where a hummock would occlude part of a shadow — a
shadow that disappears behind a rise reads as a bug. They gain an opacity ramp
that fades them in and out over the last ~15 units of their travel, so they are
already gone before they reach ground that rolls. This also removes the existing
hard wrap-around pop.

## Tests

`web/test/farm-terrain.test.ts` — pure functions only, no WebGL:

- `groundHeight` is **exactly 0** at every point the rest of the farm assumes is
  flat: a grid over the field footprint, the tractor's headland extremes
  (x = ±24), the fence line, the barn and silo footprints, and the chicken yard.
- `groundHeight` is **exactly 0** inside every `HILLS` and `FAR_HILLS` footprint,
  and at the disc rim (r ≥ 120).
- `groundHeight` is **non-zero** somewhere in the wings (the roll actually
  happens — a damping bug that flattened everything would otherwise pass
  silently).
- `|groundHeight|` never exceeds `AMPLITUDE` anywhere on the disc.

`web/test/farm-geometry.test.ts` — extended with the existing
"every variant is valid and renderable" pattern for the new merged prop and
hedge geometries (`mergeGeometries` returns `null` when inputs mix indexed and
non-indexed geometry, and a null geometry crashes the renderer on frame one).

`web/test/farm-turbines.test.ts` — import path for `HILLS` updated; assertions
unchanged.

## Non-goals

- No animation. Nothing added here updates per frame.
- No new data channels. None of this is driven by chain events, and none of it
  gets a legend row.
- The crops, tractor, chickens, crows and fence are not touched.
- No heightfield sampling in the field: crops and the tractor keep their `y = 0`
  world, and the flat zone exists to guarantee that stays true.
