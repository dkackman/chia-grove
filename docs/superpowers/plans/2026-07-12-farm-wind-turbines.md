# Farm Wind Turbines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a distant ridgeline wind farm to the farm theme — turbines in seeded random groupings on the far horizon, turning idly and gusting when a new block arrives.

**Architecture:** One new module, `web/src/themes/farm/turbines.ts`. It exports a pure `turbineLayout()` (deterministic placement, unit-tested), a pure `gustPulse()` (the gust envelope, unit-tested), pure geometry factories, and a `Turbines` class that owns the meshes. All towers and nacelles merge into one static mesh; each rotor is its own mesh sharing one geometry and one material, because each must spin independently. `farm/index.ts` constructs it, ticks it each frame, and calls `gust()` on `block` events.

**Tech Stack:** TypeScript, Three.js (r1xx, `three/addons/utils/BufferGeometryUtils.js`), Vitest, Vite.

> **Executed and amended.** The code blocks below have been corrected in place so that re-executing this plan cannot reintroduce a bug that shipped once already. `web/src/themes/farm/turbines.ts` remains the truth. Four things changed during execution, found by an eyes-on browser check and the final review, and the spec has been corrected to match:
>
> 1. **Tower heights 34–50 → 14–20.** The farm camera is pitched ~13° down at the field, so only a narrow band of sky sits above the horizon; at 34–50 the turbines were cropped by the top of the frame (by 35 world units, in the *default* view). The floor of 14 keeps the lowest blade tip clear of the hill each turbine stands on.
> 2. **The gust sweep is normalised against the layout's actual x extent** (`GUST_SPAN = 2` seconds end to end), not a fixed seconds-per-unit `GUST_SWEEP`. The original constant was sized for an assumed ±110 span; the real layout spans ~85 units, which gave a 0.68 s stagger against a 0.9 s rise — the ridge snapped in near-unison — plus a ~1 s uniform dead beat after each block.
> 3. **`rotorYaw()` returns `-Math.PI / 2 + spec.yaw`.** The original `+π/2` pointed the nose cone downwind, contradicting its own comments.
> 4. **Tests added** for the gust actually speeding the blades up, the downwind sweep (ordering *and* magnitude), reduced-motion suppression, and the rotor hub sitting atop its tower.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-12-farm-wind-turbines-design.md`.
- Turbines are **scenery**. They get **no legend entry** in `farm/index.ts`, and no `GroveEvent` type changes.
- The turf is a `CircleGeometry(140)` centred on the origin. Every turbine must stand within **radius 132** of the origin or it will float over open sky.
- Every turbine must sit at **z ≤ −85** — beyond the barn (z ≈ −26), clear of the field and the camera drift path.
- Placement is seeded from a **fixed constant** via `mulberry32` from `../shared/util.js`. The layout must be byte-identical on every reload and every snapshot replay. Never call `Math.random()` in the layout.
- `prefers-reduced-motion` must be honoured, as it is by the tractor, crows, smoke, and motes: slow idle spin, no gust.
- `mergeGeometries()` returns **null** if you mix indexed and non-indexed geometries, and a null geometry crashes the renderer on the first frame. `CylinderGeometry`, `BoxGeometry`, and `ConeGeometry` are all indexed, so as long as you never call `.toNonIndexed()` you are fine — and the geometry test in Task 2 guards this.
- Follow the file's neighbours: `flatShading` on standard materials, comments that explain *why* rather than *what*, no comment restating the next line.

---

### Task 1: Deterministic layout and gust envelope

The two pure pieces, with no Three.js scene involved. Both are unit-tested.

**Files:**

- Create: `web/src/themes/farm/turbines.ts`
- Create: `web/test/farm-turbines.test.ts`
- Modify: `web/src/themes/farm/palette.ts` (add two colours)

**Interfaces:**

- Consumes: `mulberry32` from `web/src/themes/shared/util.js`.
- Produces, for Task 2:
  - `interface TurbineSpec { x: number; z: number; height: number; yaw: number; rate: number; phase: number }`
  - `const WIND_FARM` — the placement constants, including `maxRadius: 132`, `zLimit: -85`, `baseHeight: 42`.
  - `function turbineLayout(): TurbineSpec[]`
  - `function gustPulse(u: number): number`

- [ ] **Step 1: Write the failing test**

Create `web/test/farm-turbines.test.ts`:

```ts
import { expect, test } from "vitest";
import { gustPulse, turbineLayout, WIND_FARM } from "../src/themes/farm/turbines.js";

test("the layout is identical on every call, so reloads and replays match", () => {
  expect(turbineLayout()).toEqual(turbineLayout());
});

test("every turbine stands on the turf disc, not over open sky", () => {
  for (const t of turbineLayout()) {
    expect(Math.hypot(t.x, t.z)).toBeLessThanOrEqual(WIND_FARM.maxRadius + 1e-6);
  }
});

test("every turbine is out in the distance, beyond the barn and the camera path", () => {
  for (const t of turbineLayout()) {
    expect(t.z).toBeLessThanOrEqual(WIND_FARM.zLimit);
  }
});

test("turbines come in groups — each one has a cluster-mate nearby", () => {
  const turbines = turbineLayout();
  expect(turbines.length).toBeGreaterThanOrEqual(8);
  for (const t of turbines) {
    const nearest = Math.min(
      ...turbines.filter((o) => o !== t).map((o) => Math.hypot(o.x - t.x, o.z - t.z))
    );
    expect(nearest).toBeLessThan(60);
  }
});

test("the groups are spread across the horizon rather than piled in one spot", () => {
  const xs = turbineLayout().map((t) => t.x);
  expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(60);
});

test("turbines vary in height and idle speed", () => {
  const turbines = turbineLayout();
  const heights = turbines.map((t) => t.height);
  expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(5);
  for (const t of turbines) {
    expect(t.height).toBeGreaterThanOrEqual(WIND_FARM.minHeight);
    expect(t.height).toBeLessThanOrEqual(WIND_FARM.maxHeight);
    expect(t.rate).toBeGreaterThan(0);
  }
});

test("the gust envelope rises from nothing, peaks, and dies away", () => {
  expect(gustPulse(-1)).toBe(0);
  expect(gustPulse(0)).toBe(0);
  expect(gustPulse(1)).toBeCloseTo(1); // peaks one time-constant after the wind arrives
  expect(gustPulse(4)).toBeLessThan(0.25);
  expect(gustPulse(Infinity)).toBe(0); // never NaN, however long ago the last block was
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run web/test/farm-turbines.test.ts`
Expected: FAIL — cannot resolve `../src/themes/farm/turbines.js`.

- [ ] **Step 3: Add the palette colours**

In `web/src/themes/farm/palette.ts`, add two entries to the `FARM` object (keep the existing trailing entries; just insert these before the closing brace):

```ts
  turbine: 0xdde5ea,
  turbineHub: 0xc2ccd3,
```

They sit a little darker than the `sky` (`0xbfe3ff`) so the towers and blades still read against it once the fog has pulled them toward `haze`.

- [ ] **Step 4: Write the layout and the gust envelope**

Create `web/src/themes/farm/turbines.ts`:

```ts
import { mulberry32 } from "../shared/util.js";

/** Fixed seed — the wind farm must be identical on every reload and every replay. */
const SEED = 0x77696e64;

export const WIND_FARM = {
  clusters: 4,
  minPerCluster: 2,
  maxPerCluster: 4,
  /** Cluster centres land between these two z values. */
  farZ: -124,
  nearZ: -88,
  /** After scatter, no turbine may come nearer than this or stand further out than this. */
  zLimit: -85,
  zFloor: -128,
  /** The turf is a CircleGeometry(140); past this radius a turbine floats over open sky. */
  maxRadius: 132,
  minHeight: 14, // amended from 34 — see the note at the top of this plan
  maxHeight: 20, // amended from 50 — see the note at the top of this plan
  /** The height the geometry is modelled at; each turbine scales off this. */
  baseHeight: 42,
} as const;

export interface TurbineSpec {
  x: number;
  z: number;
  /** Tower height in world units; also the uniform scale factor, via baseHeight. */
  height: number;
  /** Rotor facing: the wind blows +x, so the rotors face across it, with a little jitter. */
  yaw: number;
  /** Idle spin rate, rad/s. */
  rate: number;
  /** Starting blade angle, so no two rotors are in step. */
  phase: number;
}

/** Half-width of the turf disc at a given z — how far out in x a turbine can stand there. */
function maxX(z: number): number {
  return Math.sqrt(Math.max(0, WIND_FARM.maxRadius ** 2 - z * z));
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * Turbines in a handful of loose groups along the far horizon. Seeded, so the
 * wind farm is the same every time — a snapshot replay must not reshuffle it.
 *
 * The turf disc narrows as it recedes, so the further back a cluster sits the
 * less room it has to spread in x; maxX() keeps every turbine on the ground.
 */
export function turbineLayout(): TurbineSpec[] {
  const rand = mulberry32(SEED);
  const turbines: TurbineSpec[] = [];

  for (let c = 0; c < WIND_FARM.clusters; c++) {
    const cz = WIND_FARM.farZ + rand() * (WIND_FARM.nearZ - WIND_FARM.farZ);
    // hold the centre well inside the disc edge so the cluster has room to scatter
    const cx = (rand() * 2 - 1) * maxX(cz) * 0.7;
    const span = WIND_FARM.maxPerCluster - WIND_FARM.minPerCluster + 1;
    const count = WIND_FARM.minPerCluster + Math.floor(rand() * span);

    for (let i = 0; i < count; i++) {
      const z = clamp(cz + (rand() - 0.5) * 32, WIND_FARM.zFloor, WIND_FARM.zLimit);
      const x = clamp(cx + (rand() - 0.5) * 44, -maxX(z), maxX(z));
      turbines.push({
        x,
        z,
        height: WIND_FARM.minHeight + rand() * (WIND_FARM.maxHeight - WIND_FARM.minHeight),
        yaw: (rand() - 0.5) * 0.35, // ±10°, so they don't look stamped from a template
        rate: 0.35 + rand() * 0.25,
        phase: rand() * Math.PI * 2,
      });
    }
  }
  return turbines;
}

/**
 * The gust envelope, in time-constants since the wind reached a turbine: nothing
 * before it arrives, a smooth peak of 1 one constant later, then a long fall-off.
 * Guarded at both ends so a turbine that has never been gusted reads 0, not NaN.
 */
export function gustPulse(u: number): number {
  if (!(u > 0) || u > 12) return 0;
  return u * Math.exp(1 - u);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run web/test/farm-turbines.test.ts`
Expected: PASS, 7 tests.

If "turbines come in groups" or "spread across the horizon" fails, the seed happened to draw a poor layout — change `SEED` to another constant and re-run rather than loosening the assertions. The assertions describe what the scene needs to look like.

- [ ] **Step 6: Commit**

```bash
git add web/src/themes/farm/turbines.ts web/src/themes/farm/palette.ts web/test/farm-turbines.test.ts
git commit -m "feat(farm): seeded wind-turbine layout and gust envelope"
```

---

### Task 2: Turbine geometry and the Turbines class

**Files:**

- Modify: `web/src/themes/farm/turbines.ts` (append geometry factories and the `Turbines` class)
- Modify: `web/test/farm-turbines.test.ts` (append the geometry test)

**Interfaces:**

- Consumes: `TurbineSpec`, `WIND_FARM`, `turbineLayout`, `gustPulse` from Task 1; `FARM.turbine` and `FARM.turbineHub` from Task 1's palette change.
- Produces, for Task 3:
  - `class Turbines { constructor(scene: THREE.Scene, reducedMotion: boolean); update(t: number, dt: number): void; gust(t: number): void }`

Geometry orientation, which is the one fiddly part — read before writing:

- The rotor geometry is modelled **spinning about its local z axis** (blades in the local xy plane), so spinning it is just `rotor.rotation.z = angle`.
- A `THREE.Euler` in its default `XYZ` order applies **z first, then y** to a vertex. So setting `rotor.rotation.y = yaw` (constant) and `rotor.rotation.z = angle` (animated) spins the blades in their own plane and *then* swings the whole rotor to face the wind. That is exactly what's wanted, and it means each turbine needs a single `Mesh` — no wrapper `Group`.
- The scene's wind blows **+x**, so the rotor's spin axis must lie along x: the yaw is `-Math.PI / 2 + spec.yaw` (amended from `+Math.PI / 2`, which pointed the nose cone downwind).
- The tower is a cylinder and therefore rotationally symmetric, so the tower and nacelle can be merged and yawed **together** — the yaw is a no-op for the tower and correctly swings the nacelle.

- [ ] **Step 1: Write the failing test**

Append to `web/test/farm-turbines.test.ts`:

```ts
import { rotorGeometry, towerGeometry } from "../src/themes/farm/turbines.js";

// mergeGeometries returns null when inputs mix indexed and non-indexed
// geometries; a null geometry crashes the renderer on the first frame.
test("the turbine geometries are valid and renderable", () => {
  const rotor = rotorGeometry();
  expect(rotor).not.toBeNull();
  expect(rotor.getAttribute("position").count).toBeGreaterThan(0);

  for (const spec of turbineLayout()) {
    const tower = towerGeometry(spec);
    expect(tower).not.toBeNull();
    expect(tower.getAttribute("position").count).toBeGreaterThan(0);
  }
});

test("each tower stands on the ground and reaches its full height", () => {
  const spec = turbineLayout()[0];
  const tower = towerGeometry(spec);
  tower.computeBoundingBox();
  const box = tower.boundingBox;
  expect(box).not.toBeNull();
  expect(box?.min.y).toBeCloseTo(0, 1); // seated on the turf, not floating or sunk
  // the hub sits at spec.height; the nacelle shell adds a little above it
  expect(box?.max.y).toBeGreaterThanOrEqual(spec.height);
  expect(box?.max.y).toBeLessThan(spec.height + 3);
});
```

Merge this import into the existing import from `../src/themes/farm/turbines.js` at the top of the file rather than adding a second import statement — ESLint will flag a duplicate import.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run web/test/farm-turbines.test.ts`
Expected: FAIL — `rotorGeometry is not a function`.

- [ ] **Step 3: Write the geometry factories and the Turbines class**

Append to `web/src/themes/farm/turbines.ts` (and add the two imports at the top of the file):

```ts
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { FARM } from "./palette.js";
```

```ts
/** How far the hub stands proud of the nacelle, in modelled (baseHeight) units. */
const HUB_Z = 2.4;
const BLADE_LEN = 14;

/** Where the rotor's spin axis points: across the scene's +x wind, plus jitter. */
function rotorYaw(spec: TurbineSpec): number {
  return -Math.PI / 2 + spec.yaw; // amended — see the note at the top of this plan
}

/**
 * Tower and nacelle for one turbine, already placed in world space and ready to
 * merge with the rest. Yawing the pair is safe: the tower is a cylinder, so the
 * rotation only swings the nacelle, which must line up with its rotor.
 */
export function towerGeometry(spec: TurbineSpec): THREE.BufferGeometry {
  const tower = new THREE.CylinderGeometry(0.55, 1.5, WIND_FARM.baseHeight, 10);
  tower.translate(0, WIND_FARM.baseHeight / 2, 0);

  const nacelle = new THREE.BoxGeometry(2, 1.8, 5.4);
  nacelle.translate(0, WIND_FARM.baseHeight, -0.6);

  const geo = mergeGeometries([tower, nacelle]);
  const scale = spec.height / WIND_FARM.baseHeight;
  geo.rotateY(rotorYaw(spec));
  geo.scale(scale, scale, scale);
  geo.translate(spec.x, 0, spec.z);
  return geo;
}

/**
 * One rotor — nose cone plus three blades — modelled about its local z axis, so
 * the caller spins it with rotation.z alone. Every turbine shares this geometry
 * and scales the mesh to its own height.
 */
export function rotorGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  const nose = new THREE.ConeGeometry(0.85, 1.8, 8);
  nose.rotateX(Math.PI / 2); // swing the cone's point from +y round to +z, into the wind
  nose.translate(0, 0, HUB_Z + 0.9);
  parts.push(nose);

  for (let i = 0; i < 3; i++) {
    const blade = new THREE.CylinderGeometry(0.12, 0.5, BLADE_LEN, 4);
    blade.rotateY(Math.PI / 4);
    blade.scale(1, 1, 0.3); // flatten the prism into a slab
    blade.rotateY(0.2); // a little twist, so the three blades don't all catch the light at once
    blade.translate(0, BLADE_LEN / 2 + 0.8, HUB_Z);
    blade.rotateZ((i * Math.PI * 2) / 3);
    parts.push(blade);
  }
  return mergeGeometries(parts);
}

/** Rate multiplier added at the peak of a gust — blades run ~2.5× idle. */
const GUST_PEAK = 1.5;
/** Seconds from the wind reaching a turbine to the top of its gust. */
const GUST_TAU = 0.9;
/** Seconds for a gust to travel the full width of the wind farm, riding the +x wind. */
const GUST_SPAN = 2; // amended from a fixed per-unit GUST_SWEEP — see the note at the top of this plan
/** Idle spin is barely perceptible under prefers-reduced-motion. */
const REDUCED_IDLE = 0.15;

/**
 * The wind farm on the horizon. Scenery: the rotors turn on their own, and a new
 * block sends a gust sweeping across them downwind, so the ridgeline ripples
 * with the chain without claiming a legend row.
 */
export class Turbines {
  private readonly specs: TurbineSpec[];
  private readonly rotors: THREE.Mesh[];
  private readonly angles: number[];
  /** When the current gust reaches each turbine; -Infinity until the first block. */
  private readonly gustAt: number[];
  /** Per-turbine delay from gust() to arrival, spread across the layout's actual x extent. */
  private readonly sweep: number[];

  constructor(
    scene: THREE.Scene,
    private readonly reducedMotion: boolean
  ) {
    this.specs = turbineLayout();
    this.angles = this.specs.map((spec) => spec.phase);
    this.gustAt = this.specs.map(() => -Infinity);

    // normalise against the layout's real x span (not an assumed one) so the sweep
    // stays perceptible however the seed or layout later changes
    const xs = this.specs.map((spec) => spec.x);
    const minX = Math.min(...xs);
    const extent = Math.max(...xs) - minX;
    this.sweep = this.specs.map((spec) =>
      extent > 0 ? ((spec.x - minX) / extent) * GUST_SPAN : 0
    );

    // every tower is static, so they all collapse into one draw call
    const towers = new THREE.Mesh(
      mergeGeometries(this.specs.map(towerGeometry)),
      new THREE.MeshStandardMaterial({
        color: FARM.turbine,
        roughness: 0.55,
        metalness: 0.1,
        flatShading: true,
      })
    );
    scene.add(towers);

    // the rotors each turn at their own rate, so they need their own meshes — but
    // they share one geometry and one material between them
    const rotor = rotorGeometry();
    const rotorMat = new THREE.MeshStandardMaterial({
      color: FARM.turbineHub,
      roughness: 0.6,
      metalness: 0.1,
      flatShading: true,
    });
    this.rotors = this.specs.map((spec) => {
      const mesh = new THREE.Mesh(rotor, rotorMat);
      const scale = spec.height / WIND_FARM.baseHeight;
      mesh.position.set(spec.x, spec.height, spec.z);
      mesh.scale.setScalar(scale);
      // default XYZ euler order applies z (the spin) before y (the yaw), so the
      // blades turn in their own plane and the whole rotor then faces the wind
      mesh.rotation.y = rotorYaw(spec);
      mesh.rotation.z = spec.phase;
      scene.add(mesh);
      return mesh;
    });
  }

  /** A new block: send a gust down the ridge, riding the +x wind. */
  gust(t: number): void {
    if (this.reducedMotion) return;
    for (let i = 0; i < this.specs.length; i++) {
      this.gustAt[i] = t + this.sweep[i];
    }
  }

  update(t: number, dt: number): void {
    const idle = this.reducedMotion ? REDUCED_IDLE : 1;
    for (let i = 0; i < this.specs.length; i++) {
      const boost = gustPulse((t - this.gustAt[i]) / GUST_TAU);
      this.angles[i] += this.specs[i].rate * idle * (1 + GUST_PEAK * boost) * dt;
      this.rotors[i].rotation.z = this.angles[i];
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run web/test/farm-turbines.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/themes/farm/turbines.ts web/test/farm-turbines.test.ts
git commit -m "feat(farm): wind-turbine geometry and gusting rotors"
```

---

### Task 3: Wire the turbines into the farm scene

**Files:**

- Modify: `web/src/themes/farm/index.ts` (import, construct, tick, gust on block)
- Modify: `web/CLAUDE.md` (one sentence in the farm section)

**Interfaces:**

- Consumes: `Turbines` from Task 2.
- Produces: nothing — this is the last task.

- [ ] **Step 1: Import and construct**

In `web/src/themes/farm/index.ts`, add the import beside the other farm imports (after the `Crows` import on line 15):

```ts
import { Turbines } from "./turbines.js";
```

Then construct it beside the other props, right after the `crows` line:

```ts
    const crows = new Crows(scene, reducedMotion ? 10 : 24);
    const turbines = new Turbines(scene, reducedMotion);
```

- [ ] **Step 2: Gust on each new block**

In the `feed.onEvent` switch, in the existing `case "block":` arm, add the gust after `chickens.chase(...)`:

```ts
        case "block":
          currentRow = blockIndex % FIELD.rows;
          blockIndex += 1;
          plantIndex = 0;
          tractor.startRow(currentRow, clockT);
          field.plow(currentRow);
          chickens.chase(0, rowZ(currentRow), clockT);
          turbines.gust(clockT);
          break;
```

- [ ] **Step 3: Tick each frame**

In `frame()`, add the update beside the others, after `crows.update(t);`:

```ts
      crows.update(t);
      turbines.update(t, dt);
```

Do **not** add a legend entry. The turbines are scenery, like the barn and the trees.

- [ ] **Step 4: Verify the whole project is green**

Run each and confirm before moving on:

```bash
npm run typecheck   # expect: no errors
npm run lint        # expect: no errors
npm test            # expect: all suites pass, including web/test/farm-turbines.test.ts
```

- [ ] **Step 5: Look at it**

```bash
npm run dev:web
```

Open `http://localhost:5173/?theme=farm&demo=1` — the `demo=1` flag feeds synthetic events, so no server is needed and blocks arrive on their own.

Confirm, and say what you actually saw:

- Turbines stand on the far horizon in loose groups, hazed by the fog, at a range of distances. None float above the ground, and none sit close enough to crowd the barn or the field.
- The rotors turn idly, out of step with each other.
- On each new block a gust sweeps across the ridge from −x to +x, spinning the blades up and letting them settle back.
- Drag to orbit the camera and confirm the wind farm looks right from the full sweep of angles, with no turbine standing off the edge of the turf.

If a turbine looks sunk into a hill, that is expected and wanted — the hills are opaque domes, so a turbine behind one reads as standing on the ridge.

- [ ] **Step 6: Document it**

In `web/CLAUDE.md`, in the `### farm` section, add a sentence after the existing description:

```md
A distant wind farm (`turbines.ts`) stands on the horizon as scenery — seeded random groupings, rotors turning idly, with a gust sweeping downwind across the ridge on each new block.
```

- [ ] **Step 7: Commit**

```bash
git add web/src/themes/farm/index.ts web/CLAUDE.md
git commit -m "feat(farm): stand a wind farm on the horizon"
```
