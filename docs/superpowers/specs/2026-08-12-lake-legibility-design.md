# Lake legibility — mempool weather, block descent, readable strata

**Date:** 2026-08-12
**Status:** approved design, ready for implementation planning

## Problem

The lake reads as chaos. It has exactly one semantic axis — depth means age — and
that axis is invisible; everything else on screen is motion without meaning.

- **Blocks are not countable.** A band is 1.5 units inside a 60-unit column seen
  at 84° FOV from radius 34. Nothing marks where band N ends and N+1 begins, so
  the idea the whole theme rests on cannot be seen. Both `mine` and `board`
  received dedicated block-delineation passes; the lake never did.
- **Horizontal position is hash noise.** `seatOffset(coinId)` (`layout.ts:61`)
  draws radius and angle from a coin-id-seeded PRNG. Farm makes each block a
  plowed row and mine winds blocks into a spiral; in the lake, X and Z carry no
  information at all.
- **There is no still reference frame.** Around 2,400 fish swim wandering
  circuits while turtles stroke, jellies pulse, bubbles rise, shafts breathe, and
  the camera auto-orbits on one period while bobbing vertically on another. When
  everything moves constantly, motion cannot signal an event.
- **The camera fights the story.** `lake.ts:101` swings the camera ±2.2 units
  vertically on a 125 s sine. The theme communicates through vertical position —
  the whole lake glides down 1.5 units per block — so the bob is cancelling the
  one cue the theme is built on. `CAM_RADIUS` is also fixed at 34, framing an
  empty lake and a full one identically, unlike `mine`'s adaptive `camDist`.
- **The mempool is upside down.** `vfx.setMempool` lights bubble vents on the
  **bed**. The bed is the deep past; the mempool is the future.
- **The chain's numbers are discarded.** `lake.ts:69-89` consumes only `netspace`
  and `mempoolSize`. `spendCount`, `fees`, `timestamp`, `mempoolCost`,
  `mempoolFees`, and block height are all dropped.

## Direction

Give the lake a narrative spine — pending above, confirming now, settled below —
and make the strata that carry it visible and countable. Keep the calm palette,
the meditative pace, the creature vocabulary, and the media/picking pipelines
exactly as they are.

## Enabling fact

`classifyBlock` (`server/src/classify/classify.ts:42`) pushes the `BlockEvent`
**first**, then that block's spends:

```ts
const events: GroveEvent[] = [blockEvent(block)];
for (const spend of block.spends) { ...; events.push(classifySpend(...)); }
```

So the theme learns `spendCount` and `fees` before a single sprout of that block
arrives. The confirmation descent depends on this ordering; it is a server
guarantee, not an accident of timing, and the plan should assert it in a test.

No server or `@grove/shared` change. `PROTOCOL_VERSION` is untouched.

## 1. The mempool moves to the surface (`pending.ts`, new)

A new system owns a **shallow churn layer** between the surface and the newest
band. `TOP_BAND_Y` moves from −3 to −12 to open y ∈ [−9, −2] for it.

The layer holds small, deliberately anonymous silhouettes — `fishGeometry()` at a
small fixed scale, desaturated toward `LAKE.deep` — milling in a restless
horizontal churn. One `InstancedMesh` with a wrapping pool, same shape as
`Shoal`, but with no `meta`, no picking and no `bornBlock`: these are not events.

- Active count tracks `mempoolSize` from `AmbientEvent`.
- Churn agitation tracks `mempoolCost / mempoolSize` — average cost per pending
  spend — so congestion reads as turbulence.

The anonymity is honest, not a shortcut. The server reports mempool size, cost
and fees and never reports _what_ is pending, so the layer can only say "N
transactions are waiting." Giving these silhouettes kinds or colors would be
inventing data.

The bed bubbles in `vfx.ts` stay as scenery at a fixed low density and stop
encoding anything; `Vfx.setMempool` and `bubbleCount()` go away with their tests.

## 2. The block becomes a descent (`pending.ts` + entry animation)

The block event is currently one surface ripple (`index.ts:70`) competing with
2,400 swimming fish. It becomes the scene's one dramatic beat.

On `BlockEvent`:

1. `pending.release(spendCount)` detaches that many silhouettes from the churn
   layer and sinks them through the top band boundary over ~1 s, fading as they
   cross.
2. The block's sprouts arrive immediately after and plant in the new band with an
   **entry animation** — scaling and fading in from just above the band over
   ~0.8 s with a downward entry velocity, instead of popping in at full size.

The two motions overlap, so the eye reads one continuous event: anonymous pending
things fall, identified creatures resolve out of them. That is what confirmation
is, and no other theme shows it.

If `spendCount` exceeds the currently lit silhouettes (a snapshot replay arrives
with no ambient history, and a big block can outrun a small mempool), release
whatever is lit and no more. The descent is a gesture, not an accounting.

The surface ripple stays as punctuation.

Entry animation lives in each creature system as a per-slot `bornAt` timestamp
feeding a scale/opacity envelope, evaluated in the existing `update()` pass. It
must be replay-safe: a snapshot replay plants hundreds of sprouts across a few
frames, and every one animating in is correct — they genuinely are arriving.

## 3. Bands become visible objects (`bands.ts`, new)

This reverses a decision the original lake spec was proud of — "no band ring or
per-band state, one subtraction, no bookkeeping." That was right when a band was
invisible. Now the band must _be_ something, so `bands.ts` keeps a small ring
buffer of `{ height, spendCount, fees, bornBlock }`, one entry per block, capped
at `MAX_BANDS`.

`bandDepth(age)` stays exactly as it is: pure, uniformly stepped, unit-tested.
The ring buffer is presentation state layered on top, not a replacement for the
subtraction that drives sinking.

**Rim rings.** Each band gets a thin annulus at radius ~28 — outside the creature
annulus (`BAND_RADIUS_MIN` 6 … `BAND_RADIUS_MAX` 26) and inside the camera orbit,
so the camera looks in past them rather than through them. Rings, not filled
discs: eighteen stacked translucent discs would turn the column to mud, whereas
rings are mostly empty space and read as shelf edges. `spendCount` sets ring
brightness and thickness; `fees` shifts hue warm. Rings dim with depth, so the
newest band is the brightest thing in the column.

**Height labels.** The top several rings each carry their block height as a
billboarded `CanvasTexture` sprite, redrawn only when a band is created — once
per block, which is free. Labels fade out below the top few so the deep column
stays quiet.

Deliberately **not** reusing `board/glyphs.ts`: the flap atlas exists to animate
a riffle, and here it would be all machinery and no benefit.

### Rejected: variable band thickness

The obvious move is to make busy blocks physically thicker. Don't. `bandDepth`
is a pure function of age with a uniform step; variable thickness turns it into a
cumulative prefix sum over the band ring that every creature update, the reorg
cull, and `easeBlocks` would have to respect. The legibility gain is small and
the cost is the theme's cleanest abstraction. `spendCount` rides the ring's
brightness and thickness instead.

### Reorg

`bands.clearAbove(forkHeight)` drops orphaned band entries alongside the existing
per-system culls, so rings and labels disappear with their creatures.

## 4. The camera stops fighting the story (`lake.ts`)

**FOV 84 → 55.** The wide FOV exists so a midpoint camera catches both surface
and bed at once. With fewer, thicker bands it no longer has to, and 84° costs
heavy edge distortion on every creature.

**Delete the vertical bob.** See Problem. The camera must not move on the axis
the theme uses to mean time.

**Adaptive framing.** `CAM_RADIUS` eases toward a distance that frames the
_filled_ depth, the way `mine.ts:79-107` eases `camDist` toward the spiral's
extent, and `lookAt` targets the center of the filled column rather than a fixed
midpoint. An empty lake frames the top bands and the churn layer; a full one
pulls back to the whole column. Borrow the fit math from `board/fit.ts`
`fitDistance()`.

The eased distance is clamped to a floor above the rim-ring radius (section 3),
so a sparsely filled lake never pulls the camera inside the rings and starts
clipping through them — the same reasoning that parks the god-ray cones at radius
42–66, outside today's fixed `CAM_RADIUS`.

**Shallower history.** `MAX_BANDS` 40 → **18**, `BAND_STEP` 1.5 → **2.6**, so the
column stays roughly its current height while bands become 73% thicker and
countable. This is the design's real cost: history drops from ~12 minutes to
~5.5 at 18.75 s blocks. Accepted deliberately — 40 indistinguishable bands
communicate less than 18 countable ones.

`prefers-reduced-motion` keeps its current treatment: fixed angle, no drift. With
the bob gone, the reduced-motion and normal cameras differ only in orbit.

## 5. A mempool/netspace strip (`ui/`)

Not a full HUD. `BlockConsole` (`web/src/ui/console.ts`) already runs for every
theme and already prints height, per-kind spend counts and fees, and block height
is about to be in-world on the band labels. A lake HUD would mostly duplicate
both.

What is genuinely missing on screen is mempool and netspace — `board`'s header
has them, the console does not. So: a compact DOM strip showing only those two.

`board/header.ts` already has the pure formatters. `mempoolGauge()` is exported;
`netspaceText()` is currently private. Lift both into a shared module
(`web/src/ui/gauges.ts`) and have `board/header.ts` import them, so there is one
implementation and `board`'s existing tests keep covering it.

## 6. Quieting the scene

Motion should be the exception that marks an event.

- Auto-orbit 0.02 → ~0.012 rad/s.
- Fish wander amplitude down (`motion.ts` `wanderedRadius`/`wanderedAngle`
  currently swing ±1.8 radius and ±0.3 rad) so circuits stay legibly inside their
  band.
- Fish caps 1200/1200 → lower. With 18 bands rather than 40 the standing
  population falls by more than half anyway; the caps should follow rather than
  leaving dead headroom that only delays pool wrap.

## Files

**New**

| File              | Responsibility                                             |
| ----------------- | ---------------------------------------------------------- |
| `lake/pending.ts` | Churn layer, `setMempool`, `release(n)`, per-frame update. |
| `lake/bands.ts`   | Band ring buffer, rim rings, height labels, `clearAbove`.  |
| `ui/gauges.ts`    | `mempoolGauge` + `netspaceText`, lifted from `board`.      |
| `lake/strip.ts`   | The mempool/netspace DOM strip.                            |

**Modified**

`lake/layout.ts` (constants), `lake/lake.ts` (camera, `spendCount`/`fees`
plumbing, ambient `mempoolCost`), `lake/index.ts` (wiring, legend), `lake/vfx.ts`
(bubbles demoted), `lake/shoal.ts` / `jellies.ts` / `turtles.ts` (entry
animation, caps), `lake/motion.ts` (wander amplitude), `lake/palette.ts` (ring
and pending colors), `board/header.ts` (import the lifted formatters),
`web/src/style.css` (strip styling, legend swatches).

## Testing

Two tiers, both already established here: pure logic unit-tested like
`lake-layout.test.ts`, scene classes constructed against a real `new
THREE.Scene()` in Node like `lake-shoal.test.ts` — no renderer, no DOM. New pool
classes take an optional cap constructor parameter so a test can force a wrap.

- `web/test/lake-layout.test.ts` — extend for the new constants: `bandDepth`
  monotonic and clamped at 0 and `MAX_BANDS` with the new step; `TOP_BAND_Y`
  leaves the churn layer clear of band 0.
- `web/test/lake-pending.test.ts` — `setMempool` lit count; `release(n)` detaches
  exactly `min(n, lit)`; released silhouettes reach the top band and are recycled;
  agitation derived from cost/size handles size 0 and non-numeric input.
- `web/test/lake-bands.test.ts` — one entry per block, ring wraps at `MAX_BANDS`,
  `clearAbove` drops entries at or above the fork height, ring brightness is
  monotonic in `spendCount`, labels only on the top N.
- `web/test/lake-camera.test.ts` — fit distance grows with filled depth and is
  bounded; look target tracks the filled column center; no vertical oscillation
  in the camera path (a regression guard on the deleted bob).
- `web/test/lake-shoal.test.ts` — extend: entry envelope starts near zero scale
  and reaches full size, and is idempotent across repeated `update()` calls.
- `web/test/ui-gauges.test.ts` — the lifted formatters; `board`'s existing header
  tests keep passing unchanged.
- `server/test/classify.test.ts` — assert `classifyBlock` returns the
  `BlockEvent` at index 0 ahead of every spend, since the descent depends on it.

`npm run typecheck`, `npm run lint`, and `npm test` must pass.

## Risks

- **Descent/sprout timing.** The descent assumes sprouts follow their block
  closely. `DrainQueue` releases 120 events per frame during snapshot replay, so
  a large block can straddle frames. The entry animation is per-sprout and
  replay-safe, so the worst case is a descent that finishes slightly before the
  last creatures land — a cosmetic lag, not a broken frame.
- **Ring occlusion.** Eighteen rings at radius 28 from a camera at ~34 should
  read as edges, but the margin is thin. If they crowd, the lever is fading
  opacity with depth harder rather than removing rings.
- **History loss.** 18 bands is a real reduction. If it proves too shallow in
  practice the fallback is 24–28 bands with labels only on the top handful and
  faster opacity falloff, which keeps most of the legibility gain.
- **Determinism.** Everything visual must still derive from coin id, slot index
  or elapsed time — never `Math.random` — so snapshot replays rebuild the same
  lake. The churn layer's scatter uses a fixed `mulberry32` seed, as `vfx.ts`
  already does for bubbles.
