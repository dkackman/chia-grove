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
