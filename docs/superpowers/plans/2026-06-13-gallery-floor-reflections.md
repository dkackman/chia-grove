# Gallery Floor Reflections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the gallery's fake-glossy floor with a true planar `Reflector` so the NFT cards, wall, and picture-lights reflect in a subtle wet-sheen.

**Architecture:** Swap the floor `Mesh`/`MeshStandardMaterial` in `createWall` for three's `Reflector` (`examples/jsm`), keeping the same geometry/rotation/position. A dark reflection tint (new `GALLERY.floorMirror` palette constant) and a capped render-target resolution produce the dim, slightly soft sheen. No data-flow or resize changes — `Reflector` integrates via `onBeforeRender` inside the existing postfx pipeline.

**Tech Stack:** TypeScript, three.js `^0.184.0` (`Reflector` from `three/examples/jsm/objects/Reflector.js`), Vitest.

---

### Task 1: Add the reflection tint to the palette

**Files:**

- Modify: `web/src/themes/gallery/palette.ts`
- Test: `web/test/palette.test.ts` (existing — verify it still passes; no new assertion required for a constant)

- [ ] **Step 1: Add the `floorMirror` constant**

In `web/src/themes/gallery/palette.ts`, add `floorMirror` to the `GALLERY` object (place it right after `floor`):

```ts
export const GALLERY = {
  wallTop: 0x14161c,
  wallBottom: 0x090a0d,
  floor: 0x0b0c10,
  floorMirror: 0x2a2d35, // dark tint scaling the floor reflection → subtle wet-sheen, not a bright mirror
  backdrop: 0x05060a,
  frame: 0x26282f,
  spot: 0xffe9c2, // warm picture-light
  fill: 0x2a3650, // cool ambient fill
};
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add web/src/themes/gallery/palette.ts
git commit -m "feat(gallery): add floorMirror reflection tint to palette"
```

---

### Task 2: Replace the floor with a Reflector

**Files:**

- Modify: `web/src/themes/gallery/wall.ts`
- Test: `web/test/gallery-wall.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `web/test/gallery-wall.test.ts`:

```ts
import * as THREE from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { expect, test } from "vitest";
import { createWall } from "../src/themes/gallery/wall.js";

test("createWall installs a reflective floor (Reflector) in the scene", () => {
  const scene = new THREE.Scene();
  createWall(scene);
  const reflectors = scene.children.filter((o) => o instanceof Reflector);
  expect(reflectors).toHaveLength(1);
});

test("the reflective floor lies flat at y=0", () => {
  const scene = new THREE.Scene();
  createWall(scene);
  const floor = scene.children.find((o) => o instanceof Reflector) as Reflector;
  expect(floor.rotation.x).toBeCloseTo(-Math.PI / 2);
  expect(floor.position.y).toBe(0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run web/test/gallery-wall.test.ts`
Expected: FAIL — no `Reflector` is added yet (current floor is a `Mesh` with `MeshStandardMaterial`), so `reflectors` has length 0.

- [ ] **Step 3: Implement the Reflector floor**

In `web/src/themes/gallery/wall.ts`:

Add the import at the top (after the existing `three` import):

```ts
import * as THREE from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { GALLERY } from "./palette.js";
import { WALL } from "./layout.js";
```

Replace the floor block:

```ts
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(span, 60),
  new THREE.MeshStandardMaterial({ color: GALLERY.floor, roughness: 0.35, metalness: 0.5 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.set(span / 2 - 20, 0, WALL.z + 14);
scene.add(floor);
```

with a `Reflector`:

```ts
// a real planar mirror: renders the scene from a mirrored virtual camera each
// frame (via onBeforeRender) so the cards, wall, and picture-lights reflect.
// the dark color tint keeps it a subtle wet-sheen rather than a bright mirror;
// the capped resolution softens the reflection slightly (no separate blur pass).
const floor = new Reflector(new THREE.PlaneGeometry(span, 60), {
  color: GALLERY.floorMirror,
  clipBias: 0.003,
  textureWidth: 1024,
  textureHeight: 1024,
});
floor.rotation.x = -Math.PI / 2;
floor.position.set(span / 2 - 20, 0, WALL.z + 14);
scene.add(floor);
```

Update the JSDoc on `createWall` so it no longer describes a `MeshStandardMaterial`:

```ts
/**
 * The salon backdrop: a long dark wall behind the pieces, a reflective floor that
 * mirrors the cards and picture-lights in a subtle wet-sheen, and a far backdrop.
 * Wide on x so the panning camera never runs off the end within a session.
 */
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run web/test/gallery-wall.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS — confirms the `three/examples/jsm/objects/Reflector.js` import resolves under the project's TS config.

- [ ] **Step 6: Commit**

```bash
git add web/src/themes/gallery/wall.ts web/test/gallery-wall.test.ts
git commit -m "feat(gallery): reflective floor plane mirroring the NFT cards"
```

---

### Task 3: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — all server and web tests green, including the new `gallery-wall.test.ts`.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: PASS (no new lint errors).

- [ ] **Step 3: Visual check**

Run: `npm run dev:web`, then open `http://localhost:5173/?theme=gallery&demo=1`.
Expected: As NFT cards hang on the wall, the floor shows a dim, slightly soft reflection of the cards and the warm picture-light — a wet-sheen, not a bright mirror. The dark areas of the floor stay near-black, matching the prior look. Panning left/right keeps the reflection tracking the cards.

- [ ] **Step 4: Update CLAUDE.md if needed**

The gallery floor is not described in `CLAUDE.md`'s scene internals, so no doc update is required. (Skip if still accurate.)

---

## Self-Review Notes

- **Spec coverage:** `wall.ts` Reflector swap (Task 2) ✓; `palette.ts` `floorMirror` constant (Task 1) ✓; preserved geometry/rotation/position ✓; no resize/data-flow changes ✓; visual + typecheck + unit testing (Tasks 2–3) ✓.
- **Placeholder scan:** none — all steps contain concrete code/commands.
- **Type consistency:** `GALLERY.floorMirror` defined in Task 1 and consumed in Task 2; `createWall(scene: THREE.Scene): void` signature unchanged, matching the test's call.
