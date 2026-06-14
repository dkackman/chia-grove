# Interactive Orbit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add horizontal drag-to-orbit to the grove and farm scenes; on pointer release the camera eases back to the existing auto-drift over ~2 seconds.

**Architecture:** A shared `createOrbitControl` utility manages pointer events and exponential decay via a testable inner class (`OrbitState`). Each scene instantiates one control, adds its angle offset to the camera each frame, and exposes `isDragging()` so the shared picker suppresses hover/click during drags.

**Tech Stack:** TypeScript, Three.js, Vitest, Pointer Events API

---

## File Map

| File                             | Action | Responsibility                                                             |
| -------------------------------- | ------ | -------------------------------------------------------------------------- |
| `web/src/themes/shared/orbit.ts` | Create | `OrbitState` class (pure decay logic) + `createOrbitControl` (DOM binding) |
| `web/test/orbit.test.ts`         | Create | Unit tests for `OrbitState` decay behaviour                                |
| `web/src/themes/types.ts`        | Modify | Add `isDragging?(): boolean` to `VisualizationHandle`                      |
| `web/src/ui/picker.ts`           | Modify | Skip hover + click when `viz.isDragging?.()` is true                       |
| `web/src/themes/grove/grove.ts`  | Modify | Instantiate orbit control, add offset to camera angle, expose `isDragging` |
| `web/src/themes/grove/index.ts`  | Modify | Forward `isDragging` from runtime to `VisualizationHandle`                 |
| `web/src/themes/farm/index.ts`   | Modify | Instantiate orbit control, rotate camera around look target by offset      |

---

## Task 1: `OrbitState` class and `createOrbitControl` utility

**Files:**

- Create: `web/src/themes/shared/orbit.ts`

- [ ] **Step 1: Write the file**

```ts
// web/src/themes/shared/orbit.ts

const SETTLED = 0.0001;

/**
 * Pure decay state — no DOM, fully testable.
 * Caller converts pixels → radians and passes the result to `accumulate`.
 */
export class OrbitState {
  offset = 0;
  private _easing = false;

  /** Called each pointermove frame while dragging. */
  accumulate(deltaRadians: number): void {
    this._easing = false;
    this.offset += deltaRadians;
  }

  /** Called on pointerup to start the snap-back. */
  release(): void {
    this._easing = Math.abs(this.offset) > SETTLED;
  }

  /** Call every frame. Decays offset exponentially toward zero. */
  update(dt: number, returnSpeed: number): void {
    if (!this._easing) return;
    this.offset *= Math.pow(Math.E, -returnSpeed * dt);
    if (Math.abs(this.offset) < SETTLED) {
      this.offset = 0;
      this._easing = false;
    }
  }
}

export interface OrbitControl {
  getOffset(): number;
  isDragging(): boolean;
  update(dt: number): void;
  dispose(): void;
}

export function createOrbitControl(
  canvas: HTMLCanvasElement,
  opts: { sensitivity?: number; returnSpeed?: number; dragThreshold?: number } = {}
): OrbitControl {
  const { sensitivity = 2.0, returnSpeed = 2.0, dragThreshold = 4 } = opts;
  const state = new OrbitState();
  let dragging = false;
  let downX = 0;
  let lastX = 0;

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    downX = lastX = e.clientX;
    dragging = false;
    canvas.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: PointerEvent): void {
    if (!(e.buttons & 1)) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    if (!dragging && Math.abs(e.clientX - downX) > dragThreshold) dragging = true;
    if (dragging) {
      state.accumulate((dx / innerWidth) * Math.PI * 2 * sensitivity);
      canvas.style.cursor = "grabbing";
    }
  }

  function onPointerUp(e: PointerEvent): void {
    canvas.releasePointerCapture?.(e.pointerId);
    if (dragging) {
      dragging = false;
      canvas.style.cursor = "";
      state.release();
    }
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);

  return {
    getOffset: () => state.offset,
    isDragging: () => dragging,
    update: (dt) => state.update(dt, returnSpeed),
    dispose: () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
    },
  };
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

---

## Task 2: Unit tests for `OrbitState`

**Files:**

- Create: `web/test/orbit.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// web/test/orbit.test.ts
import { expect, test } from "vitest";
import { OrbitState } from "../src/themes/shared/orbit.js";

test("offset starts at zero", () => {
  const s = new OrbitState();
  expect(s.offset).toBe(0);
});

test("accumulate increases offset by the given radians", () => {
  const s = new OrbitState();
  s.accumulate(0.5);
  expect(s.offset).toBeCloseTo(0.5);
  s.accumulate(0.3);
  expect(s.offset).toBeCloseTo(0.8);
});

test("update before release does not decay the offset", () => {
  const s = new OrbitState();
  s.accumulate(1.0);
  s.update(2.0, 2.0); // 2 seconds at returnSpeed 2 — no release yet
  expect(s.offset).toBeCloseTo(1.0);
});

test("after release, update decays offset exponentially", () => {
  const s = new OrbitState();
  s.accumulate(1.0);
  s.release();
  s.update(1.0, 2.0); // 1 second at returnSpeed 2.0
  // expected: 1.0 * e^(-2) ≈ 0.1353
  expect(s.offset).toBeCloseTo(Math.E ** -2, 3);
});

test("offset settles to exactly zero after sufficient updates", () => {
  const s = new OrbitState();
  s.accumulate(1.0);
  s.release();
  // 300 frames at ~16ms ≈ 5 seconds; 1.0 * e^(-10) ≈ 4.5e-5 < threshold
  for (let i = 0; i < 300; i++) s.update(1 / 60, 2.0);
  expect(s.offset).toBe(0);
});

test("accumulating during easing cancels the easing and adds to offset", () => {
  const s = new OrbitState();
  s.accumulate(1.0);
  s.release();
  s.accumulate(0.5); // user drags again mid-ease
  s.update(1.0, 2.0); // should NOT decay — easing was cancelled by accumulate
  expect(s.offset).toBeCloseTo(1.5);
});

test("release on zero offset does not start easing", () => {
  const s = new OrbitState();
  s.release(); // offset is 0, nothing to ease
  s.update(1.0, 2.0); // should be no-op
  expect(s.offset).toBe(0);
});
```

- [ ] **Step 2: Run tests — expect FAIL (module not found)**

```bash
npx vitest run web/test/orbit.test.ts
```

Expected output includes: `Cannot find module` or all tests pass if Task 1 was done first — if Task 1 is done, expect all 7 tests to PASS.

- [ ] **Step 3: Run full suite to confirm no regressions**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add web/src/themes/shared/orbit.ts web/test/orbit.test.ts
git commit -m "feat(web): OrbitState and createOrbitControl for horizontal drag orbit"
```

---

## Task 3: Extend `VisualizationHandle` with `isDragging`

**Files:**

- Modify: `web/src/themes/types.ts`

- [ ] **Step 1: Add the optional field**

Current file (`web/src/themes/types.ts`):

```ts
export interface VisualizationHandle {
  camera: THREE.PerspectiveCamera;
  onFrame(fn: () => void): void;
  selfManagedInput?: boolean;
  pickables?(): THREE.Object3D[];
  metaFor?(object: THREE.Object3D, instanceId: number | undefined): SproutEvent | null;
  setHovered?(object: THREE.Object3D | null, instanceId: number | undefined): void;
}
```

Add `isDragging?` after `selfManagedInput`:

```ts
export interface VisualizationHandle {
  camera: THREE.PerspectiveCamera;
  onFrame(fn: () => void): void;
  selfManagedInput?: boolean;
  isDragging?(): boolean;
  pickables?(): THREE.Object3D[];
  metaFor?(object: THREE.Object3D, instanceId: number | undefined): SproutEvent | null;
  setHovered?(object: THREE.Object3D | null, instanceId: number | undefined): void;
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors (field is optional, no existing implementors break).

- [ ] **Step 3: Commit**

```bash
git add web/src/themes/types.ts
git commit -m "feat(web): add isDragging to VisualizationHandle for orbit suppression"
```

---

## Task 4: Suppress picker hover and click while dragging

**Files:**

- Modify: `web/src/ui/picker.ts`

- [ ] **Step 1: Update `onFrame` to bail when dragging**

In `attachPicker`, the `viz.onFrame(...)` callback currently starts:

```ts
viz.onFrame(() => {
  if (pendingX < 0) return;
  const hit = intersect(pendingX, pendingY);
  pendingX = -1;
  // ...
```

Change to:

```ts
viz.onFrame(() => {
  if (pendingX < 0) return;
  if (viz.isDragging?.()) {
    pendingX = -1;
    return;
  }
  const hit = intersect(pendingX, pendingY);
  pendingX = -1;
  // ...
```

- [ ] **Step 2: Update `click` handler to bail when dragging**

Current:

```ts
canvas.addEventListener("click", (event) => {
  const hit = intersect(event.clientX, event.clientY);
  clearCardTimers();
  if (hit) {
```

Change to:

```ts
canvas.addEventListener("click", (event) => {
  if (viz.isDragging?.()) return;
  const hit = intersect(event.clientX, event.clientY);
  clearCardTimers();
  if (hit) {
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/ui/picker.ts
git commit -m "fix(web): suppress picker hover and click while orbit dragging"
```

---

## Task 5: Wire orbit into grove

**Files:**

- Modify: `web/src/themes/grove/grove.ts`
- Modify: `web/src/themes/grove/index.ts`

- [ ] **Step 1: Update `grove.ts`**

Add the import at the top of `web/src/themes/grove/grove.ts`:

```ts
import { createOrbitControl } from "../shared/orbit.js";
```

Inside `startGrove`, after the renderer is created (after `renderer.setSize(innerWidth, innerHeight);`), add:

```ts
const orbit = createOrbitControl(canvas);
```

In the `frame()` function, replace the angle line and add `orbit.update`:

```ts
// before:
const angle = reducedMotion ? 0.8 : t * 0.02;
const radius = 34 + (reducedMotion ? 0 : Math.sin(t * 0.07) * 2.5);
camera.position.set(
  Math.cos(angle) * radius,
  13.5 + Math.sin(t * 0.05) * 0.8,
  Math.sin(angle) * radius
);
camera.lookAt(0, 2.5, 0);

sky.update(dt, t);
ground.update(dt);
extraUpdate(dt, t);

// after:
const angle = (reducedMotion ? 0.8 : t * 0.02) + orbit.getOffset();
const radius = 34 + (reducedMotion ? 0 : Math.sin(t * 0.07) * 2.5);
camera.position.set(
  Math.cos(angle) * radius,
  13.5 + Math.sin(t * 0.05) * 0.8,
  Math.sin(angle) * radius
);
camera.lookAt(0, 2.5, 0);

orbit.update(dt);
sky.update(dt, t);
ground.update(dt);
extraUpdate(dt, t);
```

In the `return Object.assign(...)` at the bottom, add `isDragging`:

```ts
return Object.assign(
  { renderer, camera, scene },
  {
    setSproutHandler: (fn: typeof onSprout) => (onSprout = fn),
    setAmbientHandler: (fn: typeof onAmbientExtra) => (onAmbientExtra = fn),
    setBlockHandler: (fn: typeof onBlockExtra) => (onBlockExtra = fn),
    setReorgHandler: (fn: typeof onReorgExtra) => (onReorgExtra = fn),
    setUpdateHandler: (fn: typeof extraUpdate) => (extraUpdate = fn),
    isDragging: () => orbit.isDragging(),
    reducedMotion,
  }
);
```

- [ ] **Step 2: Update `grove/index.ts` to forward `isDragging`**

In the `return { ... }` block at the bottom of `start()`:

```ts
// before:
return {
  camera: runtime.camera,
  onFrame: (fn) => frameCallbacks.push(fn),
  pickables: () => flora.pickables(),
  metaFor: (object, instanceId) => flora.metaFor(object, instanceId),
  setHovered: (object, instanceId) => flora.setHovered(object, instanceId),
};

// after:
return {
  camera: runtime.camera,
  onFrame: (fn) => frameCallbacks.push(fn),
  isDragging: () => runtime.isDragging(),
  pickables: () => flora.pickables(),
  metaFor: (object, instanceId) => flora.metaFor(object, instanceId),
  setHovered: (object, instanceId) => flora.setHovered(object, instanceId),
};
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Manual test — grove orbit**

```bash
npm run dev:web
```

Open `http://localhost:5173/?theme=grove`. Drag horizontally — the meadow should rotate. Release — it should ease back to slow auto-orbit over ~2 seconds. Click a plant (no drag) — detail card should still open.

- [ ] **Step 5: Commit**

```bash
git add web/src/themes/grove/grove.ts web/src/themes/grove/index.ts
git commit -m "feat(web): interactive horizontal orbit for grove scene"
```

---

## Task 6: Wire orbit into farm

**Files:**

- Modify: `web/src/themes/farm/index.ts`

- [ ] **Step 1: Add import**

At the top of `web/src/themes/farm/index.ts`, add:

```ts
import { createOrbitControl } from "../shared/orbit.js";
```

- [ ] **Step 2: Instantiate the orbit control**

Inside `start()`, after `const reducedMotion = ...` and before the renderer is created, add:

```ts
const orbit = createOrbitControl(canvas);
```

- [ ] **Step 3: Replace the camera block in the frame loop**

Current frame loop camera code:

```ts
const x = reducedMotion ? 8 : Math.sin(t * 0.02) * 16;
const z = rowZ(0) + 14 + (reducedMotion ? 0 : Math.cos(t * 0.013) * 2);
camera.position.set(x, 11 + Math.sin(t * 0.05) * 0.6, z);
camera.lookAt(0, 1, -6);
```

Replace with:

```ts
// Auto-drift position
const autoX = reducedMotion ? 8 : Math.sin(t * 0.02) * 16;
const autoZ = rowZ(0) + 14 + (reducedMotion ? 0 : Math.cos(t * 0.013) * 2);

// Rotate auto position around the look target (0, _, -6) on the XZ plane
const ltX = 0,
  ltZ = -6;
const dx = autoX - ltX;
const dz = autoZ - ltZ;
const a = orbit.getOffset();
const cosA = Math.cos(a),
  sinA = Math.sin(a);
camera.position.set(
  ltX + dx * cosA - dz * sinA,
  11 + Math.sin(t * 0.05) * 0.6,
  ltZ + dx * sinA + dz * cosA
);
camera.lookAt(0, 1, -6);

orbit.update(dt);
```

- [ ] **Step 4: Add `isDragging` to the returned handle**

The `start()` return at the bottom of the `farm` visualization currently returns:

```ts
return {
  camera,
  onFrame: (fn) => frameCallbacks.push(fn),
  pickables: () => crops.pickables(),
  metaFor: (object, instanceId) => crops.metaFor(object, instanceId),
  setHovered: (object, instanceId) => crops.setHovered(object, instanceId),
};
```

Add `isDragging`:

```ts
return {
  camera,
  onFrame: (fn) => frameCallbacks.push(fn),
  isDragging: () => orbit.isDragging(),
  pickables: () => crops.pickables(),
  metaFor: (object, instanceId) => crops.metaFor(object, instanceId),
  setHovered: (object, instanceId) => crops.setHovered(object, instanceId),
};
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 6: Manual test — farm orbit**

Open `http://localhost:5173/?theme=farm`. Drag horizontally — the field should rotate around the look target. Release — it should ease back to slow sway over ~2 seconds. Click a crop — detail card should still open.

- [ ] **Step 7: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add web/src/themes/farm/index.ts
git commit -m "feat(web): interactive horizontal orbit for farm scene"
```

---

## Task 7: Final verification

- [ ] **Step 1: Lint**

```bash
npm run lint
```

Expected: no errors or warnings introduced by the new files.

- [ ] **Step 2: Cross-check gallery is unaffected**

Open `http://localhost:5173/?theme=gallery`. Confirm panning still works and no regressions (gallery uses `selfManagedInput: true` and is untouched by this feature).

- [ ] **Step 3: Test reduced-motion**

In browser DevTools → Rendering → Emulate CSS media feature `prefers-reduced-motion: reduce`. Open grove and farm. Confirm:

- Auto-drift is paused (expected existing behaviour)
- Drag orbit still works (orbit is user-initiated, not motion)
- Release eases back

- [ ] **Step 4: Test touch**

On a touch device or DevTools touch emulation: drag across grove/farm. Confirm orbit works and plants are still tappable with a short tap.
