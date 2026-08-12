import * as THREE from "three";
import { expect, test } from "vitest";
import * as motion from "../src/themes/lake/motion.js";
import { fishGeometry, pikeGeometry, applySwimShader } from "../src/themes/lake/bodies.js";

function bounds(g: THREE.BufferGeometry): THREE.Box3 {
  g.computeBoundingBox();
  return g.boundingBox!;
}

test("the fish is a smooth body, not a 9-triangle dart", () => {
  const g = fishGeometry();
  expect(g.getAttribute("position").count).toBeGreaterThan(100);
  expect(g.getIndex()).not.toBeNull();
  expect(g.getAttribute("normal")).toBeDefined();
});

test("the fish keeps the old envelope: nose at +X, tail fin behind", () => {
  const b = bounds(fishGeometry());
  expect(b.max.x).toBeCloseTo(0.6, 1);
  expect(b.min.x).toBeLessThan(-0.55); // caudal fin extends past the tail
  expect(b.max.y).toBeLessThan(0.45); // dorsal + body stay in the old height class
  expect(Math.abs(b.max.z)).toBeLessThan(0.2); // slimmer than it is tall
});

test("the pike is a stretched predator body", () => {
  const b = bounds(pikeGeometry());
  expect(b.max.x - b.min.x).toBeGreaterThan(4.5);
  expect(b.max.x).toBeGreaterThan(2.5); // nose forward, same +X convention
});

test("the swim shader injects undulation and wires uTime", () => {
  const material = new THREE.MeshStandardMaterial();
  const swim = applySwimShader(material, {
    instanced: true,
    amp: 0.1,
    freq: 6.5,
    waveLen: 3.2,
    nose: 0.6,
    span: 1.2,
  });
  const fake = { uniforms: {} as Record<string, unknown>, vertexShader: "#include <begin_vertex>" };
  material.onBeforeCompile!(fake as never, null as never);
  expect(fake.uniforms.uTime).toBe(swim.uniforms.uTime);
  expect(fake.vertexShader).toContain("transformed.z +=");
  expect(fake.vertexShader).toContain("instanceMatrix");
  swim.uniforms.uTime.value = 42; // the returned holder is live
  expect((fake.uniforms.uTime as { value: number }).value).toBe(42);
});

test("a non-instanced swim shader never references instanceMatrix", () => {
  const material = new THREE.MeshStandardMaterial();
  applySwimShader(material, {
    instanced: false,
    amp: 0.5,
    freq: 5,
    waveLen: 1.1,
    nose: 2.8,
    span: 5.2,
  });
  const fake = { uniforms: {} as Record<string, unknown>, vertexShader: "#include <begin_vertex>" };
  material.onBeforeCompile!(fake as never, null as never);
  expect(fake.vertexShader).not.toContain("instanceMatrix");
});

test("PULSE_SKEW is exported for the GLSL copy to mirror", () => {
  expect(motion.PULSE_SKEW).toBeCloseTo(0.65, 10);
});
