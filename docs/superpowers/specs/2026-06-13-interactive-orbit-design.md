# Interactive Orbit — Grove & Farm

**Date:** 2026-06-13  
**Scope:** Add horizontal drag-to-orbit to the grove and farm scenes, with automatic snap-back to auto-drift on release.

---

## Summary

Users can drag horizontally on the canvas to rotate the camera around the scene. On pointer release, the camera eases back to the existing auto-drift path over roughly 2 seconds. The orbit is horizontal-only (yaw); no pitch change. Touch and mouse both work.

---

## Architecture

### New shared utility: `web/src/themes/shared/orbit.ts`

```ts
createOrbitControl(canvas: HTMLCanvasElement, opts?: {
  sensitivity?: number   // default 2.0 — radians per full screen-width drag
  returnSpeed?: number   // default 2.0 — exponential decay rate (radians/s)
  dragThreshold?: number // default 4 — pixels before a press counts as drag
}): {
  getOffset(): number
  isDragging(): boolean
  update(dt: number): void
  dispose(): void
}
```

**Internal state:**
- `offset: number` — accumulated horizontal angle offset in radians
- `dragging: boolean` — true between pointerdown+threshold and pointerup
- `easing: boolean` — true after release, while offset decays to 0

**Pointer event handling (on `canvas`):**
- `pointerdown` — record `downX`, seed `lastX = e.clientX`, call `canvas.setPointerCapture`
- `pointermove` (buttons & 1) — if moved more than `dragThreshold` px from `downX`, set `dragging = true`; accumulate `offset += (dx / innerWidth) * Math.PI * 2 * sensitivity`; set cursor to `grabbing`
- `pointerup` — clear `dragging`, set `easing = true`, release pointer capture, revert cursor

**`update(dt)`:**
- If `easing` and `Math.abs(offset) > 0.0001`: `offset *= Math.pow(Math.E, -returnSpeed * dt)` (exponential decay)
- Else if easing: `offset = 0; easing = false`

**`dispose()`:** removes all event listeners.

---

### `web/src/themes/types.ts` — extend `VisualizationHandle`

Add one optional field:

```ts
isDragging?(): boolean
```

Used by `attachPicker` to suppress hover and click while the user is orbiting.

---

### `web/src/ui/picker.ts` — suppress input while dragging

Two changes:

1. **`onFrame` callback** (hover update): skip the `intersect` call and hover update when `viz.isDragging?.()` returns true. Also skip cursor update — orbit control owns the cursor during drag.

2. **`click` handler**: bail early (don't pin card) when `viz.isDragging?.()` returns true. (Belt-and-suspenders: the browser shouldn't fire `click` after a real drag anyway, but this guards against short fast swipes.)

---

### Grove

**`web/src/themes/grove/grove.ts`**

1. Import `createOrbitControl` from `../shared/orbit.js`
2. Instantiate after creating the renderer: `const orbit = createOrbitControl(canvas)`
3. Frame loop — replace the angle line:
   ```ts
   // before
   const angle = reducedMotion ? 0.8 : t * 0.02;
   // after
   const angle = (reducedMotion ? 0.8 : t * 0.02) + orbit.getOffset();
   ```
4. In `extraUpdate` (which is called each frame): add `orbit.update(dt)` call. Since `extraUpdate` is replaced by `setUpdateHandler`, expose `orbit` via the returned object instead — simpler to call `orbit.update(dt)` directly inside the frame loop, before `extraUpdate`.
5. Add `isDragging: () => orbit.isDragging()` to the returned object.
6. Call `orbit.dispose()` — no teardown path currently exists; leave `dispose` available but don't wire it (themes aren't torn down without a page reload).

**`web/src/themes/grove/index.ts`**

Pass `isDragging` from the runtime to the returned `VisualizationHandle`:

```ts
return {
  camera: runtime.camera,
  onFrame: (fn) => frameCallbacks.push(fn),
  isDragging: runtime.isDragging,   // ← add this
  pickables: () => flora.pickables(),
  metaFor: (object, instanceId) => flora.metaFor(object, instanceId),
  setHovered: (object, instanceId) => flora.setHovered(object, instanceId),
};
```

---

### Farm

**`web/src/themes/farm/index.ts`**

1. Import `createOrbitControl`.
2. Instantiate: `const orbit = createOrbitControl(canvas)`.
3. In the frame loop, replace the camera block with orbit-aware positioning:

   ```ts
   // Auto-drift position (unchanged)
   const autoX = reducedMotion ? 8 : Math.sin(t * 0.02) * 16;
   const autoZ = rowZ(0) + 14 + (reducedMotion ? 0 : Math.cos(t * 0.013) * 2);

   // Rotate auto position around the look target (0, 1, -6) on the XZ plane
   const ltX = 0, ltZ = -6;
   const dx = autoX - ltX;
   const dz = autoZ - ltZ;
   const a = orbit.getOffset();
   const cosA = Math.cos(a), sinA = Math.sin(a);
   camera.position.set(
     ltX + dx * cosA - dz * sinA,
     11 + Math.sin(t * 0.05) * 0.6,
     ltZ + dx * sinA + dz * cosA,
   );
   camera.lookAt(0, 1, -6);

   orbit.update(dt);
   ```

4. Add `isDragging: () => orbit.isDragging()` to the returned handle.

---

## Behaviour Details

| Scenario | Behaviour |
|---|---|
| Short tap (< 4 px movement) | No orbit; picker fires normally (hover, card pin) |
| Horizontal drag | Camera rotates; hover and card pin suppressed |
| Release | `easing = true`; offset decays exponentially, ~87% return in 1 s, settled by 2 s |
| `prefers-reduced-motion` | Drag still works (orbit is user-initiated); auto-drift is already paused per existing logic |
| Touch | Works via pointer events (no separate touch handling needed) |
| Rapid swipe | Offset may be large; decay still applies — no momentum/fling (keeps it simple) |

---

## What is NOT in scope

- Vertical tilt / pitch (horizontal only, as specified)
- Momentum / fling on release (simple decay is sufficient)
- Gallery scene (it already has its own self-managed pan/zoom input)
- Any new UI affordance (no drag hint overlay)

---

## Files changed

| File | Change |
|---|---|
| `web/src/themes/shared/orbit.ts` | New — `createOrbitControl` utility |
| `web/src/themes/types.ts` | Add `isDragging?()` to `VisualizationHandle` |
| `web/src/ui/picker.ts` | Skip hover + click when `isDragging` is true |
| `web/src/themes/grove/grove.ts` | Instantiate orbit control, wire into angle + frame loop |
| `web/src/themes/grove/index.ts` | Forward `isDragging` to handle |
| `web/src/themes/farm/index.ts` | Instantiate orbit control, rotate camera around look target |
