import { expect, test } from "vitest";
import * as THREE from "three";
import { hitKey } from "../src/ui/picker.js";

test("null hit has an empty key", () => {
  expect(hitKey(null)).toBe("");
});

test("same object and instanceId produce the same key", () => {
  const mesh = new THREE.Mesh();
  expect(hitKey({ object: mesh, instanceId: 5 })).toBe(hitKey({ object: mesh, instanceId: 5 }));
});

test("different instanceIds on the same object produce different keys", () => {
  const mesh = new THREE.Mesh();
  expect(hitKey({ object: mesh, instanceId: 5 })).not.toBe(hitKey({ object: mesh, instanceId: 6 }));
});

test("different objects produce different keys even with the same instanceId", () => {
  const a = new THREE.Mesh();
  const b = new THREE.Mesh();
  expect(hitKey({ object: a, instanceId: 1 })).not.toBe(hitKey({ object: b, instanceId: 1 }));
});
