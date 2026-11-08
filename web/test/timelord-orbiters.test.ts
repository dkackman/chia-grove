import * as THREE from "three";
import { describe, expect, test } from "vitest";
import {
  ERUPT_SECONDS,
  IMPLODE_SECONDS,
  orbitFor,
  orbitPoint,
  reachAt,
  scaleAt,
  type Orbit,
  type Vec3,
} from "../src/themes/timelord/layout.js";
import { ORBIT_VERTEX, Orbiters } from "../src/themes/timelord/orbiters.js";
import { createSceneUniforms } from "../src/themes/timelord/shading.js";
import { mulberry32 } from "../src/themes/shared/util.js";

// The orbit motion lives in ORBIT_VERTEX; layout.ts mirrors it on the CPU so
// raycast picking hits what is drawn. These tests keep the two in lockstep:
// (1) the shader still contains exactly the lines transcribed below, and
// (2) the transcription agrees with the CPU mirror. Editing the shader math
// fails (1) until the transcription — and so the mirror — is updated too.

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

const SHADER_LINES = [
  "vec3 rotY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c); }",
  "vec3 rotX(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c); }",
  `float p = clamp((uTime - born) / ${ERUPT_SECONDS.toFixed(3)}, 0.0, 1.0);`,
  "float reach = 1.0 - pow(1.0 - p, 3.0);",
  `float ps = clamp((uTime - born) / ${(ERUPT_SECONDS * 0.7).toFixed(3)}, 0.0, 1.0);`,
  "float scale = ps <= 0.0 ? 0.0 : 1.0 + 2.70158 * pow(ps - 1.0, 3.0) + 1.70158 * pow(ps - 1.0, 2.0);",
  `float k = clamp((uTime - dieAt) / ${IMPLODE_SECONDS.toFixed(3)}, 0.0, 1.0);`,
  "reach *= 1.0 - k * k;",
  "scale *= 1.0 - k;",
  "float a = aOrbit.y + uOrbitTime * aOrbit.z;",
  "float r = aOrbit.x * reach;",
  "vec3 orb = vec3(cos(a) * r, aOrbit.w * reach, sin(a) * r);",
  "orb = rotY(rotX(orb, aTilt.x), aTilt.y);",
  "vec3 body = aCenter + orb;",
];

// --- literal JS transcription of SHADER_LINES ---------------------------------
type V = [number, number, number];
const rotY = (p: V, a: number): V => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [p[0] * c - p[2] * s, p[1], p[0] * s + p[2] * c];
};
const rotX = (p: V, a: number): V => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c];
};
const clamp = (v: number) => Math.min(1, Math.max(0, v));
// the shader bakes the durations in at 3 decimals
const ERUPT = Number(ERUPT_SECONDS.toFixed(3));
const ERUPT_S = Number((ERUPT_SECONDS * 0.7).toFixed(3));
const IMPLODE = Number(IMPLODE_SECONDS.toFixed(3));

function shaderLife(t: number, born: number, dieAt: number): { reach: number; scale: number } {
  const p = clamp((t - born) / ERUPT);
  let reach = 1 - (1 - p) ** 3;
  const ps = clamp((t - born) / ERUPT_S);
  let scale = ps <= 0 ? 0 : 1 + 2.70158 * (ps - 1) ** 3 + 1.70158 * (ps - 1) ** 2;
  if (dieAt > 0) {
    const k = clamp((t - dieAt) / IMPLODE);
    reach *= 1 - k * k;
    scale *= 1 - k;
  }
  return { reach, scale };
}

function shaderBody(center: Vec3, o: Orbit, orbitTime: number, reach: number): V {
  const a = o.phase + orbitTime * o.speed;
  const r = o.radius * reach;
  const orb = rotY(rotX([Math.cos(a) * r, o.yOff * reach, Math.sin(a) * r], o.incl), o.node);
  return [center.x + orb[0], center.y + orb[1], center.z + orb[2]];
}
// -------------------------------------------------------------------------------

describe("orbit shader ↔ CPU mirror", () => {
  test("the vertex shader still contains the transcribed lines", () => {
    const src = squash(ORBIT_VERTEX);
    for (const line of SHADER_LINES) expect(src).toContain(squash(line));
  });

  test("orbitPoint matches the shader's body position", () => {
    const rand = mulberry32(7);
    for (let j = 0; j < 300; j++) {
      const o = orbitFor(j, rand);
      const center = { x: rand() * 20 - 10, y: rand() * 50, z: rand() * 20 - 10 };
      const orbitTime = rand() * 1000;
      const reach = rand();
      const cpu = orbitPoint(center, o, orbitTime, reach);
      const gpu = shaderBody(center, o, orbitTime, reach);
      expect(cpu.x).toBeCloseTo(gpu[0], 9);
      expect(cpu.y).toBeCloseTo(gpu[1], 9);
      expect(cpu.z).toBeCloseTo(gpu[2], 9);
    }
  });

  test("reachAt / scaleAt match the shader's eruption and implosion", () => {
    const born = 10;
    for (let t = born - 1; t < born + 6; t += 0.05) {
      for (const dieAt of [0, born + 2, born + 0.5]) {
        const gpu = shaderLife(t, born, dieAt);
        // the only gap is the shader's 3-decimal durations; well under a pixel
        expect(reachAt(t, born, dieAt)).toBeCloseTo(gpu.reach, 3);
        expect(scaleAt(t, born, dieAt)).toBeCloseTo(gpu.scale, 3);
      }
    }
  });

  test("scale pops in with an overshoot, settles at 1, and is 0 once imploded", () => {
    let peak = 0;
    for (let t = 0; t <= ERUPT_SECONDS; t += 0.01) peak = Math.max(peak, scaleAt(t, 0, 0));
    expect(peak).toBeGreaterThan(1.05);
    expect(peak).toBeLessThan(1.15);
    expect(scaleAt(ERUPT_SECONDS, 0, 0)).toBeCloseTo(1, 9);
    expect(scaleAt(-0.1, 0, 0)).toBe(0);
    expect(scaleAt(5 + IMPLODE_SECONDS, 0, 5)).toBe(0);
    expect(reachAt(5 + IMPLODE_SECONDS, 0, 5)).toBe(0);
  });
});

describe("Orbiters picking", () => {
  function setup() {
    const scene = new THREE.Scene();
    const shared = createSceneUniforms();
    const orbiters = new Orbiters<string>(scene, shared, new THREE.SphereGeometry(1, 8, 6), 16, {
      metal: 0,
      spec: 0,
      shininess: 1,
      rim: 0,
      ambient: 1,
      glow: 0,
    });
    return { orbiters, shared };
  }
  const rayThrough = (p: Vec3): THREE.Raycaster => {
    // look at the body from 20 units out along +z
    const origin = new THREE.Vector3(p.x, p.y, p.z + 20);
    return new THREE.Raycaster(origin, new THREE.Vector3(0, 0, -1), 0, 1000);
  };

  test("a ray through a body's drawn position hits that instance", () => {
    const { orbiters } = setup();
    const center = { x: 0, y: 0, z: 0 };
    const rand = mulberry32(3);
    const slot = orbiters.add("coin", center, orbitFor(4, rand), 0.5, new THREE.Color(1, 1, 1), 0);
    orbiters.update(10, 37); // long after the eruption: fully out on its orbit
    const at = orbiters.positionOf(slot);
    const hits: THREE.Intersection[] = [];
    orbiters.mesh.raycast(rayThrough(at), hits);
    expect(hits.map((h) => h.instanceId)).toEqual([slot]);
    expect(orbiters.metaAt(hits[0].instanceId)).toBe("coin");
  });

  test("a killed body stops being pickable once it has imploded", () => {
    const { orbiters } = setup();
    const rand = mulberry32(5);
    const slot = orbiters.add(
      "coin",
      { x: 0, y: 0, z: 0 },
      orbitFor(2, rand),
      0.5,
      new THREE.Color(),
      0
    );
    orbiters.update(10, 10);
    const at = orbiters.positionOf(slot);
    orbiters.kill(() => true, 10, true);
    orbiters.update(10, 10);
    const hits: THREE.Intersection[] = [];
    orbiters.mesh.raycast(rayThrough(at), hits);
    expect(hits).toHaveLength(0);
  });

  test("bodies faded deep into history are not pickable", () => {
    const { orbiters, shared } = setup();
    const rand = mulberry32(9);
    const slot = orbiters.add(
      "old",
      { x: 0, y: 0, z: 0 },
      orbitFor(1, rand),
      0.5,
      new THREE.Color(),
      0
    );
    orbiters.update(10, 10);
    const at = orbiters.positionOf(slot);
    shared.uFocusY.value = 100; // camera focus far above: the body is in the abyss
    const hits: THREE.Intersection[] = [];
    orbiters.mesh.raycast(rayThrough(at), hits);
    expect(hits).toHaveLength(0);
  });
});
