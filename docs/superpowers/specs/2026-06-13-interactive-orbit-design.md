# Interactive Orbit — Grove & Farm

**Date:** 2026-06-13  
**Scope:** Add horizontal drag-to-orbit to the grove and farm scenes. On release the auto-drift resumes from the released angle (no snap-back).

---

## Summary

Users can drag horizontally on the canvas to rotate the camera around the scene. The drag accumulates an angle offset that is added to each scene's existing auto-drift. On pointer release the offset is left in place, so the slow auto-drift simply continues from wherever the user let go; a later drag stacks further onto it. The orbit is horizontal-only (yaw); no pitch change. Touch and mouse both work.

---

## Architecture

### New shared utility: `web/src/themes/shared/orbit.ts`

```ts
createOrbitControl(canvas: HTMLCanvasElement, opts?: {
  sensitivity?: number   // default 2.0 — radians per full screen-width drag
  dragThreshold?: number // default 4 — pixels before a press counts as drag
}): {
  getOffset(): number
  isDragging(): boolean
  dispose(): void
}
```

The pure angle state lives in a small `OrbitState` class (`offset` + `accumulate`) so it can be unit-tested without a DOM; `createOrbitControl` owns the pointer wiring around it.

**Internal state:**
- `offset: number` — accumulated horizontal angle offset in radians; persists for the life of the scene
- `dragging: boolean` — true between pointerdown+threshold and pointerup
- `suppressNextClick: boolean` — armed on drag release, consumed once by `isDragging()` so the click the browser fires after a drag does not pin the picker card

**Pointer event handling (on `canvas`):**
- `pointerdown` — clear `suppressNextClick`, record `downX`, seed `lastX = e.clientX`, call `canvas.setPointerCapture`
- `pointermove` (buttons & 1) — if moved more than `dragThreshold` px from `downX`, set `dragging = true`; accumulate `offset += (dx / innerWidth) * Math.PI * 2 * sensitivity`; set cursor to `grabbing`
- `pointerup` / `pointercancel` — clear `dragging`, arm `suppressNextClick`, release pointer capture, revert cursor
- The offset is **not** reset on release — auto-drift resumes from the current angle.

**`isDragging()`:** returns `true` while actively dragging. It also consumes the one-shot `suppressNextClick` flag (returns `true` once after a drag ends, then clears it) so the picker's click handler ignores the post-drag click.

**`dispose()`:** removes all event listeners (`pointerdown`, `pointermove`, `pointerup`, `pointercancel`).

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
4. Add `isDragging: () => orbit.isDragging()` to the returned object.
5. `dispose()` is available but not wired — no teardown path currently exists (themes aren't torn down without a page reload).

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
   // auto-drift position (unchanged)
   const autoX = reducedMotion ? 8 : Math.sin(t * 0.02) * 16;
   const autoZ = rowZ(0) + 14 + (reducedMotion ? 0 : Math.cos(t * 0.013) * 2);

   // rotate the drift position around the look target (0, _, -6) on the XZ plane
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
   ```

4. Add `isDragging: () => orbit.isDragging()` to the returned handle.

---

## Behaviour Details

| Scenario | Behaviour |
|---|---|
| Short tap (< 4 px movement) | No orbit; picker fires normally (hover, card pin) |
| Horizontal drag | Camera rotates; hover suppressed; the post-drag click is suppressed so it doesn't pin the card |
| Release | Offset stays put; auto-drift resumes from the released angle (no snap-back) |
| Second drag | Stacks further offset onto the current angle |
| `prefers-reduced-motion` | Drag still works (orbit is user-initiated); auto-drift is already paused per existing logic |
| Touch | Works via pointer events (no separate touch handling needed) |
| Rapid swipe | Offset may be large; no momentum/fling — the view stops where the drag ends |

---

## What is NOT in scope

- Vertical tilt / pitch (horizontal only, as specified)
- Momentum / fling on release (the view simply stops where the drag ends)
- Snap-back to the original angle (the released angle is kept)
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
