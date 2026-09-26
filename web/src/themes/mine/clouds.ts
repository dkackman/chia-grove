import * as THREE from "three";

/** Cloud grid: GRID × GRID cells of CELL blocks each (Minecraft's 12×4 cells). */
export const CLOUD_GRID = 48;
export const CLOUD_CELL = 12;
export const CLOUD_THICKNESS = 4;
const PERIOD = CLOUD_GRID * CLOUD_CELL; // the layer tiles every 576 units
const DRIFT_SPEED = 1.1; // units/s along -x, like Minecraft's westward drift
const LIFT = 17; // cloud base above the camera — keeps them in the visible sky band
const MIN_ALTITUDE = 24;

export interface CloudRun {
  /** first cell column of the run */
  x: number;
  /** cell row */
  z: number;
  /** run length in cells */
  len: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic, seamlessly tiling cloud cover: wrapped bilinear value noise on
 * a coarse lattice (blob shapes) plus a little per-cell jitter (ragged edges),
 * thresholded to ~30 % cover. Returns a GRID×GRID occupancy mask.
 */
export function cloudMask(grid = CLOUD_GRID, seed = 0x5eed): Uint8Array {
  const rand = mulberry32(seed);
  const L = 8; // coarse lattice (grid must be a multiple for clean tiling)
  const lattice = Float32Array.from({ length: L * L }, rand);
  const at = (i: number, j: number): number => lattice[((j + L) % L) * L + ((i + L) % L)];
  const mask = new Uint8Array(grid * grid);
  const step = grid / L;
  for (let z = 0; z < grid; z++) {
    for (let x = 0; x < grid; x++) {
      const fx = x / step;
      const fz = z / step;
      const i = Math.floor(fx);
      const j = Math.floor(fz);
      const u = fx - i;
      const v = fz - j;
      const n =
        at(i, j) * (1 - u) * (1 - v) +
        at(i + 1, j) * u * (1 - v) +
        at(i, j + 1) * (1 - u) * v +
        at(i + 1, j + 1) * u * v;
      mask[z * grid + x] = n + (rand() - 0.5) * 0.22 > 0.6 ? 1 : 0;
    }
  }
  return mask;
}

/** Merge each row's occupied cells into horizontal runs → one box per run. */
export function cloudRuns(mask: Uint8Array, grid = CLOUD_GRID): CloudRun[] {
  const runs: CloudRun[] = [];
  for (let z = 0; z < grid; z++) {
    let x = 0;
    while (x < grid) {
      if (!mask[z * grid + x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < grid && mask[z * grid + x]) x++;
      runs.push({ x: start, z, len: x - start });
    }
  }
  return runs;
}

const VERT = /* glsl */ `
uniform vec2 uOffset;
uniform vec3 uCenter;
uniform float uPeriod;
varying vec3 vN;
varying float vFogDist;
varying float vEdge;
void main() {
  // wrap each box (by its origin, so boxes never tear) into a period-sized
  // window centered on the camera: an endless, drifting cloud layer
  vec2 o = instanceMatrix[3].xz + uOffset - uCenter.xz;
  o = mod(o + 0.5 * uPeriod, uPeriod) - 0.5 * uPeriod;
  vec3 local = mat3(instanceMatrix) * position;
  vec3 wp = vec3(uCenter.x + o.x + local.x, uCenter.y + local.y, uCenter.z + o.y + local.z);
  vN = normal;
  vEdge = length(o) / (0.5 * uPeriod);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vFogDist = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uOpacity;
varying vec3 vN;
varying float vFogDist;
varying float vEdge;
void main() {
  // Minecraft's fixed face shading: bright tops, dim bellies, two side tones
  float shade = vN.y > 0.5 ? 1.0 : vN.y < -0.5 ? 0.74 : abs(vN.x) > 0.5 ? 0.88 : 0.82;
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * vFogDist * vFogDist);
  vec3 col = mix(uColor * shade, uFogColor, fogF);
  float a = uOpacity * (1.0 - smoothstep(0.7, 0.98, vEdge));
  gl_FragColor = vec4(col, a);
}`;

export interface Clouds {
  update(t: number, camera: THREE.Camera, color: THREE.Color): void;
}

/**
 * Minecraft's flat, blocky cloud layer: one instanced box per merged run of
 * cloud cells, wrapped around the camera in the vertex shader and drifting
 * slowly west. Translucent, face-shaded, fogged into the horizon. The layer's
 * base rides a fixed height above the camera so it always crosses the narrow
 * band of sky the orbiting camera sees. No per-frame CPU work beyond uniforms.
 */
export function createClouds(
  scene: THREE.Scene,
  fog: THREE.FogExp2,
  reducedMotion: boolean
): Clouds {
  const runs = cloudRuns(cloudMask());
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const uniforms = {
    uOffset: { value: new THREE.Vector2() },
    uCenter: { value: new THREE.Vector3() },
    uPeriod: { value: PERIOD },
    uColor: { value: new THREE.Color(0xffffff) },
    uFogColor: { value: fog.color },
    uFogDensity: { value: fog.density * 0.8 },
    uOpacity: { value: 0.82 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    fog: false,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, runs.length));
  const m = new THREE.Matrix4();
  runs.forEach((r, i) => {
    m.makeScale(r.len * CLOUD_CELL, CLOUD_THICKNESS, CLOUD_CELL);
    m.setPosition(
      (r.x + r.len / 2) * CLOUD_CELL - PERIOD / 2,
      0,
      (r.z + 0.5) * CLOUD_CELL - PERIOD / 2
    );
    mesh.setMatrixAt(i, m);
  });
  mesh.count = runs.length;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false; // positions are rewritten in the shader
  mesh.raycast = () => {}; // sky decoration: never intercept picking
  scene.add(mesh);

  return {
    update(t, camera, color) {
      const cam = camera.position;
      uniforms.uCenter.value.set(cam.x, Math.max(MIN_ALTITUDE, cam.y + LIFT), cam.z);
      uniforms.uOffset.value.x = reducedMotion ? 0 : -((t * DRIFT_SPEED) % PERIOD);
      uniforms.uColor.value.copy(color);
    },
  };
}
