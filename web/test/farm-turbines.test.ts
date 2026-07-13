import * as THREE from "three";
import { expect, test } from "vitest";
import {
  gustPulse,
  rotorGeometry,
  towerGeometry,
  turbineLayout,
  Turbines,
  WIND_FARM,
} from "../src/themes/farm/turbines.js";

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

// The tower mesh is added to the scene first (one merged draw call), then one
// mesh per rotor, in the same order turbineLayout() produced their specs.
function rotorsOf(scene: THREE.Scene): THREE.Object3D[] {
  return scene.children.slice(1);
}

test("idle spin: with no gust, every rotor advances steadily over time", () => {
  const scene = new THREE.Scene();
  const turbines = new Turbines(scene, false);
  const rotors = rotorsOf(scene);
  const dt = 1 / 60;
  const secondsPerWindow = 1;
  const stepsPerWindow = Math.round(secondsPerWindow / dt);

  const start = rotors.map((r) => r.rotation.z);
  for (let i = 0; i < stepsPerWindow; i++) turbines.update(i * dt, dt);
  const afterFirstWindow = rotors.map((r) => r.rotation.z);
  for (let i = 0; i < stepsPerWindow; i++) turbines.update((stepsPerWindow + i) * dt, dt);
  const afterSecondWindow = rotors.map((r) => r.rotation.z);

  for (let i = 0; i < rotors.length; i++) {
    const firstWindowDelta = afterFirstWindow[i] - start[i];
    const secondWindowDelta = afterSecondWindow[i] - afterFirstWindow[i];
    expect(firstWindowDelta).toBeGreaterThan(0); // every rotor is turning
    // same-length windows advance the same amount — a steady idle rate, not a ramp
    expect(secondWindowDelta).toBeCloseTo(firstWindowDelta, 9);
  }
});

test("a gust turns a rotor measurably further than the un-gusted idle baseline", () => {
  const dt = 1 / 60;
  // generous enough to comfortably cover the sweep delay to any turbine plus
  // the rise and fall of its gust envelope, regardless of which one we sample
  const steps = Math.round(6 / dt);

  const idleScene = new THREE.Scene();
  const idle = new Turbines(idleScene, false);
  const idleRotor = rotorsOf(idleScene)[0];
  const idleStart = idleRotor.rotation.z;
  for (let i = 0; i < steps; i++) idle.update(i * dt, dt);
  const idleDelta = idleRotor.rotation.z - idleStart;

  const gustedScene = new THREE.Scene();
  const gusted = new Turbines(gustedScene, false);
  const gustedRotor = rotorsOf(gustedScene)[0];
  const gustedStart = gustedRotor.rotation.z;
  gusted.gust(0);
  for (let i = 0; i < steps; i++) gusted.update(i * dt, dt);
  const gustedDelta = gustedRotor.rotation.z - gustedStart;

  // same seed, same turbine, same idle rate — the only difference is the gust,
  // so if it does anything at all the gusted rotor must have turned further
  expect(gustedDelta).toBeGreaterThan(idleDelta);
});

test("a gust sweeps downwind: an upwind (low-x) turbine speeds up before a downwind (high-x) one", () => {
  const specs = turbineLayout();
  let lowIdx = 0;
  let highIdx = 0;
  for (let i = 1; i < specs.length; i++) {
    if (specs[i].x < specs[lowIdx].x) lowIdx = i;
    if (specs[i].x > specs[highIdx].x) highIdx = i;
  }
  expect(lowIdx).not.toBe(highIdx); // the ridge actually spans a range of x

  const scene = new THREE.Scene();
  const turbines = new Turbines(scene, false);
  const rotors = rotorsOf(scene);
  const lowRotor = rotors[lowIdx];
  const highRotor = rotors[highIdx];
  // confirm the index mapping is right before trusting it: rotor meshes are
  // built in spec order, and each one is positioned at its own spec.x
  expect(lowRotor.position.x).toBeCloseTo(specs[lowIdx].x, 6);
  expect(highRotor.position.x).toBeCloseTo(specs[highIdx].x, 6);

  turbines.gust(0);

  const dt = 1 / 60;
  const lowIdleStep = specs[lowIdx].rate * dt;
  const highIdleStep = specs[highIdx].rate * dt;
  const threshold = 1.2; // a step 20% above idle counts as "has begun speeding up"

  let lowStartedAt = -1;
  let highStartedAt = -1;
  let prevLow = lowRotor.rotation.z;
  let prevHigh = highRotor.rotation.z;
  const steps = Math.round(6 / dt);
  for (let i = 0; i < steps; i++) {
    const t = i * dt;
    turbines.update(t, dt);
    const stepLow = lowRotor.rotation.z - prevLow;
    const stepHigh = highRotor.rotation.z - prevHigh;
    if (lowStartedAt < 0 && stepLow > lowIdleStep * threshold) lowStartedAt = t;
    if (highStartedAt < 0 && stepHigh > highIdleStep * threshold) highStartedAt = t;
    prevLow = lowRotor.rotation.z;
    prevHigh = highRotor.rotation.z;
  }

  expect(lowStartedAt).toBeGreaterThanOrEqual(0); // the gust did reach it...
  expect(highStartedAt).toBeGreaterThanOrEqual(0); // ...and it, eventually, too
  expect(lowStartedAt).toBeLessThan(highStartedAt); // but the near turbine first
});

test("reduced motion: a gust does not speed the blades up, and idle spin is slower", () => {
  const dt = 1 / 60;
  const steps = Math.round(6 / dt);

  const baselineScene = new THREE.Scene();
  const baseline = new Turbines(baselineScene, true);
  const baselineRotor = rotorsOf(baselineScene)[0];
  const baselineStart = baselineRotor.rotation.z;
  for (let i = 0; i < steps; i++) baseline.update(i * dt, dt);
  const baselineDelta = baselineRotor.rotation.z - baselineStart;

  const gustedScene = new THREE.Scene();
  const gusted = new Turbines(gustedScene, true);
  const gustedRotor = rotorsOf(gustedScene)[0];
  const gustedStart = gustedRotor.rotation.z;
  gusted.gust(0);
  for (let i = 0; i < steps; i++) gusted.update(i * dt, dt);
  const gustedDelta = gustedRotor.rotation.z - gustedStart;

  // same seed, same turbine — gust() under reduced motion must be a no-op
  expect(gustedDelta).toBeCloseTo(baselineDelta, 9);

  const normalScene = new THREE.Scene();
  const normal = new Turbines(normalScene, false);
  const normalRotor = rotorsOf(normalScene)[0];
  const normalStart = normalRotor.rotation.z;
  for (let i = 0; i < steps; i++) normal.update(i * dt, dt);
  const normalDelta = normalRotor.rotation.z - normalStart;

  // reduced-motion idle spin is throttled well below the normal idle rate
  expect(baselineDelta).toBeLessThan(normalDelta);
});
