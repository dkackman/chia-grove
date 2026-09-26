import * as THREE from "three";
import { FIELD } from "./layout.js";
import { FARM } from "./palette.js";
import { EDGE_X, PASS_SECONDS } from "./tractor.js";
import { mulberry32 } from "../shared/util.js";

/**
 * The plowed soil rows: a raised, clod-strewn bed per row (baked into an albedo
 * + normal map pair so the low sun rakes across real relief, with no extra
 * geometry), revealed behind the tractor as it passes, dark and wet when
 * freshly turned and drying out over the next few blocks.
 *
 * All of the per-row state lives in one instanced attribute, written only when
 * a row is plowed; the reveal, the drying and the along-row tone variation are
 * computed in the fragment shader from a single time uniform.
 */

/** Width of a soil strip across the row. Nearly the full row pitch, so plowed
 *  rows read as one worked field with a dark furrow between beds. */
export const STRIP_WIDTH = FIELD.rowSpacing * 0.94;
/** Length of a soil strip: a little past the row ends. */
export const STRIP_LENGTH = FIELD.rowLength + 1.4;
/** World length along the row that one tile of the soil texture covers. */
const TILE_X = 5;
/** Seconds for freshly turned soil to dry to 1/e of its wetness (~1.3 blocks). */
export const WET_SECONDS = 70;

/**
 * The time at which the plow reaches `x` on a row it started at `startedAt`
 * heading `direction`. Mirrors `Tractor.plowX` (and the soil shader, which must
 * stay in sync with this): the plow crosses from −EDGE_X to +EDGE_X (or back)
 * in PASS_SECONDS.
 */
export function plowReachedAt(startedAt: number, direction: 1 | -1, x: number): number {
  const along = THREE.MathUtils.clamp((direction * x + EDGE_X) / (2 * EDGE_X), 0, 1);
  return startedAt + along * PASS_SECONDS;
}

/** How wet the soil is `age` seconds after the plow turned it (1 fresh → 0 dry). */
export function soilWetness(age: number): number {
  return age < 0 ? 0 : Math.exp(-age / WET_SECONDS);
}

const hexRgb = (c: number): [number, number, number] => [(c >> 16) & 255, (c >> 8) & 255, c & 255];

/**
 * Bake the bed's height field and derive both maps from it. Heights are in
 * world units, so the normal map's slopes are the real ones: a bed ~7 cm
 * proud of its furrows, tine grooves, and scattered clods.
 */
export function soilTextures(): { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture } {
  const W = 512;
  const H = 96;
  const du = TILE_X / W;
  const dv = STRIP_WIDTH / H;
  const rand = mulberry32(0x5011);
  const h = new Float32Array(W * H);
  const clod = new Float32Array(W * H);

  // the raised bed, rolling down into a furrow at either edge, with two tine
  // grooves dragged along it (wobble frequencies are whole cycles per tile so
  // the texture tiles seamlessly along the row)
  for (let y = 0; y < H; y++) {
    const s = ((y + 0.5) / H) * 2 - 1;
    for (let x = 0; x < W; x++) {
      const u = x / W;
      let height = 0.07 * Math.pow(Math.cos((s * Math.PI) / 2), 1.4);
      for (const [g, k, ph] of [
        [-0.42, 3, 0.4],
        [0.4, 2, 2.1],
      ] as const) {
        const centre = g + 0.035 * Math.sin(u * Math.PI * 2 * k + ph);
        const d = (s - centre) / 0.07;
        height -= 0.012 * Math.exp(-d * d);
      }
      h[y * W + x] = height;
    }
  }

  // clods: smooth lumps, wrapped along x
  for (let i = 0; i < 420; i++) {
    const cx = rand() * W;
    const cy = rand() * H;
    const r = 0.025 + rand() * 0.05; // world units
    const amp = 0.008 + rand() * 0.022;
    const rx = r / du;
    const ry = (r * (0.6 + rand() * 0.5)) / dv;
    for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(H - 1, Math.ceil(cy + ry)); y++) {
      for (let xo = Math.floor(cx - rx); xo <= Math.ceil(cx + rx); xo++) {
        const dx = (xo - cx) / rx;
        const dy = (y - cy) / ry;
        const d2 = dx * dx + dy * dy;
        if (d2 >= 1) continue;
        const k = (1 - d2) * (1 - d2);
        const idx = y * W + (((xo % W) + W) % W);
        h[idx] += amp * k;
        clod[idx] = Math.max(clod[idx], k);
      }
    }
  }
  // fine grain
  for (let i = 0; i < h.length; i++) h[i] += (rand() - 0.5) * 0.003;

  const at = (x: number, y: number): number =>
    h[THREE.MathUtils.clamp(y, 0, H - 1) * W + (((x % W) + W) % W)];

  const colorCanvas = document.createElement("canvas");
  const normalCanvas = document.createElement("canvas");
  colorCanvas.width = normalCanvas.width = W;
  colorCanvas.height = normalCanvas.height = H;
  const cctx = colorCanvas.getContext("2d")!;
  const nctx = normalCanvas.getContext("2d")!;
  const colorData = cctx.createImageData(W, H);
  const normalData = nctx.createImageData(W, H);
  const dark = hexRgb(FARM.soilDark);
  const light = hexRgb(FARM.soilLight);

  const n = new THREE.Vector3();
  for (let y = 0; y < H; y++) {
    const s = ((y + 0.5) / H) * 2 - 1;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      // canvas rows run down while v runs up (CanvasTexture flips), so the
      // row below the pixel is the −v neighbour
      const dhdu = (at(x + 1, y) - at(x - 1, y)) / (2 * du);
      const dhdv = (at(x, y - 1) - at(x, y + 1)) / (2 * dv);
      n.set(-dhdu, -dhdv, 1).normalize();
      normalData.data[i * 4] = (n.x * 0.5 + 0.5) * 255;
      normalData.data[i * 4 + 1] = (n.y * 0.5 + 0.5) * 255;
      normalData.data[i * 4 + 2] = (n.z * 0.5 + 0.5) * 255;
      normalData.data[i * 4 + 3] = 255;

      // furrow bottoms darker (damp, shaded), bed crest and clod tops paler
      const crest = Math.pow(Math.cos((s * Math.PI) / 2), 0.8);
      const f = THREE.MathUtils.clamp(
        0.3 + 0.45 * crest + 0.25 * clod[i] + (rand() - 0.5) * 0.12,
        0,
        1
      );
      for (let c = 0; c < 3; c++) colorData.data[i * 4 + c] = dark[c] + (light[c] - dark[c]) * f;
      colorData.data[i * 4 + 3] = 255;
    }
  }
  cctx.putImageData(colorData, 0, 0);
  nctx.putImageData(normalData, 0, 0);

  // a little chopped straw and a few pebbles turned up by the plow
  const [sr, sg, sb] = hexRgb(FARM.straw);
  for (let i = 0; i < 70; i++) {
    const x = rand() * W;
    const y = H * (0.15 + rand() * 0.7);
    const a = rand() * Math.PI;
    const len = 3 + rand() * 6;
    cctx.strokeStyle = `rgba(${sr},${sg},${sb},${0.35 + rand() * 0.35})`;
    cctx.lineWidth = 1;
    cctx.beginPath();
    cctx.moveTo(x, y);
    cctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len * 0.4);
    cctx.stroke();
  }
  for (let i = 0; i < 40; i++) {
    const g = 120 + rand() * 50;
    cctx.fillStyle = `rgba(${g},${g - 6},${g - 14},0.8)`;
    cctx.beginPath();
    cctx.arc(rand() * W, H * (0.1 + rand() * 0.8), 0.8 + rand() * 1.2, 0, Math.PI * 2);
    cctx.fill();
  }

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const normalMap = new THREE.CanvasTexture(normalCanvas);
  for (const tex of [map, normalMap]) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.repeat.set(STRIP_LENGTH / TILE_X, 1);
  }
  return { map, normalMap };
}

export const soilUniforms = {
  uSoilTime: { value: 0 },
};

/**
 * The soil material. Expects an instanced `aPlow` attribute per row:
 * (plow start time, direction ±1, 1 if the row was already plowed before this
 * pass — so the part the tractor hasn't reached yet stays as old soil rather
 * than vanishing back to turf).
 */
export function soilMaterial(anisotropy: number): THREE.MeshStandardMaterial {
  const { map, normalMap } = soilTextures();
  map.anisotropy = normalMap.anisotropy = anisotropy;
  const material = new THREE.MeshStandardMaterial({
    map,
    normalMap,
    normalScale: new THREE.Vector2(1.3, 1.3),
    roughness: 0.97,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSoilTime = soilUniforms.uSoilTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute vec3 aPlow;
        varying vec3 vPlow;
        varying vec2 vSoilXZ;`
      )
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        vPlow = aPlow;
        vSoilXZ = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xz;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uSoilTime;
        varying vec3 vPlow;
        varying vec2 vSoilXZ;
        float soilHash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float soilNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(soilHash(i), soilHash(i + vec2(1.0, 0.0)), u.x),
            mix(soilHash(i + vec2(0.0, 1.0)), soilHash(i + vec2(1.0, 1.0)), u.x),
            u.y
          );
        }`
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        // mirrors plowReachedAt() in soil.ts
        float soilAlong = clamp((vPlow.y * vSoilXZ.x + ${EDGE_X.toFixed(3)}) / ${(2 * EDGE_X).toFixed(3)}, 0.0, 1.0);
        float soilAge = uSoilTime - (vPlow.x + soilAlong * ${PASS_SECONDS.toFixed(1)});
        if (soilAge < 0.0) {
          if (vPlow.z < 0.5) discard; // not reached yet: still turf
          soilAge = 1e6;              // an earlier pass's old, dry soil
        }
        float soilWet = exp(-soilAge / ${WET_SECONDS.toFixed(1)});
        // patchy tone along the row, plus a little per-row character
        float soilTone = 0.8 + 0.34 * soilNoise(vec2(vSoilXZ.x * 0.16, vSoilXZ.y * 0.9))
          + 0.08 * (soilHash(vec2(floor(vSoilXZ.y * 1.2), 3.0)) - 0.5);
        diffuseColor.rgb *= soilTone * mix(1.0, 0.5, soilWet);`
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.72, soilWet);`
      );
  };
  material.customProgramCacheKey = () => "farm-soil";
  return material;
}
