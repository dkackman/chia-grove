# Gallery Floor Reflections — Design

**Date:** 2026-06-13
**Theme:** `gallery` (`web/src/themes/gallery/`)

## Goal

Make the gallery floor a true reflective plane that mirrors the NFT cards, wall,
and picture-lights — replacing the current fake-glossy floor that reflects
nothing. The reflection should read as a subtle wet-sheen, not a bright mirror,
so it never competes with the art.

## Current state

`createWall` in `web/src/themes/gallery/wall.ts` builds the floor as a
`THREE.Mesh` with a `MeshStandardMaterial` (`roughness: 0.35, metalness: 0.5`,
color `GALLERY.floor = 0x0b0c10`). A standard material looks shiny but reflects
no scene geometry without an environment map or a real reflector, so the floor
appears as a flat dark plane.

Geometry/placement to preserve:
- `PlaneGeometry(span, 60)` with `span = 600`
- `rotation.x = -Math.PI / 2` (laid flat)
- `position.set(span / 2 - 20, 0, WALL.z + 14)`

## Approach: true planar mirror (Reflector)

Use `Reflector` from `three/examples/jsm/objects/Reflector.js` (already present in
`node_modules`, three `^0.184.0`). It renders the scene from a mirrored virtual
camera into a render target each frame (via `onBeforeRender`) and projects it
onto the floor plane, so the actual cards/wall/lights reflect.

### Changes

1. **`web/src/themes/gallery/wall.ts` — `createWall`**
   - Replace the floor `Mesh` with a `Reflector` using the same geometry,
     rotation, and position listed above.
   - Construct with:
     - `clipBias: 0.003` (default; avoids reflection seam at the plane)
     - `textureWidth` / `textureHeight`: a modest fixed resolution (≈1024) — the
       cap gives a slight natural softening (the wet-sheen blur) and keeps the
       extra pass cheap. Resolution affects only sharpness, not geometry, because
       the reflector's virtual camera tracks the main camera.
     - `color`: a dark tint (`GALLERY.floorMirror`) so the reflection reads dim
       rather than a bright polished mirror. Where nothing reflects, the
       Reflector renders near-black, matching the existing dark floor look.

2. **`web/src/themes/gallery/palette.ts`**
   - Add `floorMirror` constant (≈`0x2a2d35`) so reflection strength lives with
     the other scene colors, consistent with how `floor`, `spot`, `fill`, etc.
     are defined there.

### What does NOT change

- Data flow is untouched. Reflector hooks `onBeforeRender`, so it works
  transparently inside the existing `postfx` / `EffectComposer` pipeline
  (`createPostFx`) and the camera-pan render loop in `gallery.ts`.
- Fog (`FogExp2`) and bloom thresholds are unaffected.
- No new resize plumbing: the fixed render-target resolution only changes
  sharpness, and the reflector's virtual camera derives its projection from the
  main camera each frame. `createWall` keeps its `void` return.

## Trade-offs

- One extra render pass per frame. Acceptable on desktop; the resolution cap
  bounds the cost.
- Reflector replaces the floor mesh entirely, so the floor's own
  `MeshStandardMaterial` tuning is dropped. The dark `color` tint reproduces the
  intended dark-floor base.

## Testing

- **Visual (primary):** `npm run dev:web` → `http://localhost:5173/?theme=gallery&demo=1`.
  Confirm cards/wall reflect in the floor with a dim, slightly soft sheen.
- **Typecheck:** `npm run typecheck` — verifies the `examples/jsm` import resolves.
- **Unit:** add `web/test/gallery-wall.test.ts` asserting `createWall(scene)`
  adds a `Reflector` instance to the scene, matching the existing gallery test
  style (construct a `THREE.Scene`, call the factory, inspect `scene.children`).
