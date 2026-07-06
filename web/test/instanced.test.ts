import * as THREE from "three";
import { expect, test } from "vitest";
import { InstancedKind } from "../src/themes/shared/instanced.js";
import type { SproutEvent } from "@grove/shared";

function meta(height: number): SproutEvent {
  return { type: "sprout", kind: "xch", height, coinId: "00".repeat(32), amount: "0" };
}
function makeKind(cap = 4) {
  const scene = new THREE.Scene();
  return new InstancedKind(
    scene,
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial(),
    cap,
    0
  );
}
function decompose(kind: ReturnType<typeof makeKind>, i: number) {
  const m = new THREE.Matrix4();
  kind.mesh.getMatrixAt(i, m);
  const pos = new THREE.Vector3(),
    scl = new THREE.Vector3(),
    q = new THREE.Quaternion();
  m.decompose(pos, q, scl);
  return { pos, scl };
}

test("plants at an explicit y and grows to full height", () => {
  const kind = makeKind();
  kind.plant(meta(5), 1, 2, 0, { height: 1, rotY: 0, tiltX: 0, tiltZ: 0, swayPhase: 0, y: 5 });
  kind.update(2, 1); // t past GROW_SECONDS → eased = 1
  const { pos, scl } = decompose(kind, 0);
  expect(pos.y).toBeCloseTo(5);
  expect(scl.y).toBeCloseTo(1);
});

test("y defaults to 0 so existing (grove) callers are unaffected", () => {
  const kind = makeKind();
  kind.plant(meta(1), 1, 2, 0, { height: 1, rotY: 0, tiltX: 0, tiltZ: 0, swayPhase: 0 });
  kind.update(2, 1);
  expect(decompose(kind, 0).pos.y).toBeCloseTo(0);
});

test("clearWhere removes matching instances and frees their metadata", () => {
  const kind = makeKind();
  kind.plant(meta(8), 0, 0, 0, { height: 1, rotY: 0, tiltX: 0, tiltZ: 0, swayPhase: 0, y: 1 });
  kind.plant(meta(9), 0, 0, 0, { height: 1, rotY: 0, tiltX: 0, tiltZ: 0, swayPhase: 0, y: 2 });
  kind.update(2, 1);
  kind.clearWhere((m) => m.height >= 9);
  expect(kind.metaAt(0)).not.toBeNull();
  expect(kind.metaAt(1)).toBeNull();
  const cleared = new THREE.Matrix4();
  kind.mesh.getMatrixAt(1, cleared);
  expect(cleared.elements[0]).toBe(0);
});

// three.js `needsUpdate` is a write-only setter that bumps `version`; the
// version counter is the observable signal that a GPU upload was requested.
const FLAT = { height: 1, rotY: 0, tiltX: 0, tiltZ: 0, swayPhase: 0 } as const;

test("a settled non-swaying mesh skips the per-frame matrix upload", () => {
  const kind = makeKind(); // swayAmp 0
  kind.plant(meta(1), 0, 0, 0, { ...FLAT });
  kind.update(5, 1); // well past GROW_SECONDS → grow animation settled, writes once
  const version = kind.mesh.instanceMatrix.version;
  kind.update(6, 1); // nothing changed → must not re-upload
  expect(kind.mesh.instanceMatrix.version).toBe(version);
});

test("a new plant re-dirties a settled non-swaying mesh", () => {
  const kind = makeKind();
  kind.plant(meta(1), 0, 0, 0, { ...FLAT });
  kind.update(5, 1);
  const version = kind.mesh.instanceMatrix.version;
  kind.plant(meta(2), 1, 0, 5, { ...FLAT });
  kind.update(5.1, 1); // the new plant is still growing → must re-upload
  expect(kind.mesh.instanceMatrix.version).toBeGreaterThan(version);
});

test("a gust re-dirties a settled non-swaying mesh and restores once it lifts", () => {
  const kind = makeKind();
  kind.plant(meta(1), 0, 0, 0, { ...FLAT });
  kind.update(5, 1);
  let version = kind.mesh.instanceMatrix.version;
  kind.update(6, 0.8); // gust dips height → must re-upload
  expect(kind.mesh.instanceMatrix.version).toBeGreaterThan(version);
  version = kind.mesh.instanceMatrix.version;
  kind.update(7, 1); // gust lifted → one more upload to restore full height
  expect(kind.mesh.instanceMatrix.version).toBeGreaterThan(version);
  version = kind.mesh.instanceMatrix.version;
  kind.update(8, 1); // settled again at rest → skip
  expect(kind.mesh.instanceMatrix.version).toBe(version);
});

test("a swaying mesh uploads every frame", () => {
  const scene = new THREE.Scene();
  const kind = new InstancedKind(
    scene,
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial(),
    4,
    0.1 // swayAmp > 0 → continuous motion
  );
  kind.plant(meta(1), 0, 0, 0, { ...FLAT });
  kind.update(10, 1);
  const version = kind.mesh.instanceMatrix.version;
  kind.update(11, 1); // sway is continuous → must re-upload
  expect(kind.mesh.instanceMatrix.version).toBeGreaterThan(version);
});

// InstancedBufferAttribute.needsUpdate alone forces a full-buffer GPU reupload
// every time. addUpdateRange scopes the upload to just the touched instances —
// costly to skip at the 2,000–6,000-slot caps mine/terrain use.

test("plant() marks only the new instance's color range dirty, not the whole buffer", () => {
  const kind = makeKind(6);
  kind.plant(meta(1), 0, 0, 0, { ...FLAT });
  expect(kind.mesh.instanceColor!.updateRanges).toEqual([{ start: 0, count: 3 }]);
});

test("setHighlight marks only that instance's color range dirty", () => {
  const kind = makeKind(6);
  kind.plant(meta(1), 0, 0, 0, { ...FLAT });
  kind.mesh.instanceColor!.clearUpdateRanges(); // discard the range plant() just added
  kind.setHighlight(0, true);
  expect(kind.mesh.instanceColor!.updateRanges).toEqual([{ start: 0, count: 3 }]);
});

test("update() marks only touched instances' matrix ranges dirty, not the whole buffer", () => {
  const kind = makeKind(8); // cap 8, but only 2 instances ever planted
  kind.plant(meta(1), 0, 0, 0, { ...FLAT });
  kind.plant(meta(2), 1, 0, 0, { ...FLAT });
  kind.update(5, 1); // settle both — writes each instance's matrix once
  const starts = kind.mesh.instanceMatrix.updateRanges.map((r) => r.start).sort((a, b) => a - b);
  expect(starts).toEqual([0, 16]); // instances 0 and 1 (16 floats/matrix) — not all 8 cap slots
});

test("clearWhere() marks only the zeroed instance's matrix range dirty", () => {
  const kind = makeKind(8);
  kind.plant(meta(8), 0, 0, 0, { ...FLAT, y: 1 });
  kind.plant(meta(9), 0, 0, 0, { ...FLAT, y: 2 });
  kind.update(5, 1);
  kind.mesh.instanceMatrix.clearUpdateRanges(); // discard ranges from the settle above
  kind.clearWhere((m) => m.height === 9); // only instance 1 cleared
  expect(kind.mesh.instanceMatrix.updateRanges).toEqual([{ start: 16, count: 16 }]);
});

test("clearWhere() shrinks mesh.count to the highest still-active slot", () => {
  const kind = makeKind(4);
  kind.plant(meta(8), 0, 0, 0, { ...FLAT, y: 1 }); // index 0 — survives
  kind.plant(meta(9), 0, 0, 0, { ...FLAT, y: 2 }); // index 1 — cleared
  expect(kind.mesh.count).toBe(2);
  kind.clearWhere((m) => m.height === 9);
  expect(kind.mesh.count).toBe(1); // the GPU no longer draws the dead tail slot forever
});

test("clearWhere() that matches everything shrinks count to 0", () => {
  const kind = makeKind(4);
  kind.plant(meta(8), 0, 0, 0, { ...FLAT, y: 1 });
  kind.plant(meta(9), 0, 0, 0, { ...FLAT, y: 2 });
  kind.clearWhere(() => true);
  expect(kind.mesh.count).toBe(0);
});

test("custom bounds set the instanced mesh bounding sphere", () => {
  const scene = new THREE.Scene();
  const kind = new InstancedKind(
    scene,
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial(),
    4,
    0,
    140,
    1
  );
  expect(kind.mesh.boundingSphere!.radius).toBe(140);
  expect(kind.mesh.boundingSphere!.center.y).toBe(1);
});
