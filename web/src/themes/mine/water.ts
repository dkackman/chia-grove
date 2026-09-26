import * as THREE from "three";

/** Sits just above the lowest (elevation-0) block bases so the shore laps them. */
export const WATER_LEVEL = 0.45;

/** Water "texture" pixels per block — chunky, like a 16px texture seen from afar. */
export const WATER_PX = 4;
/** Shore mask covers [-SHORE_HALF, SHORE_HALF) blocks on x and z. */
const SHORE_HALF = 64;
const SHORE_RES = SHORE_HALF * 2 * WATER_PX; // 512 texels, one per water pixel
/** Shallows reach this many blocks out from the land (Chebyshev distance). */
export const SHORE_REACH = 1.0;
/** Minimum seconds between shore-mask uploads while the island is growing. */
const SHORE_UPLOAD_EVERY = 0.25;

export function waterGeometry(): THREE.PlaneGeometry {
  // far past the fog horizon so the ocean has no visible edge
  const g = new THREE.PlaneGeometry(1100, 1100, 1, 1);
  g.rotateX(-Math.PI / 2);
  return g;
}

/**
 * Shore proximity for one mask texel (255 under land, fading to 0 at
 * SHORE_REACH blocks away) given the Chebyshev distance in blocks from a
 * block's 1×1 footprint. Pure so it is unit-testable.
 */
export function shoreValue(distBlocks: number): number {
  if (distBlocks <= 0) return 255;
  if (distBlocks >= SHORE_REACH) return 0;
  return Math.round(254 * (1 - distBlocks / SHORE_REACH));
}

export interface Water {
  update(t: number): void;
  /** A ground column now stands at (x, z): paint shallows around it. */
  markLand(x: number, z: number): void;
  /** Forget all land (reorg) — the island re-marks what survived. */
  resetLand(): void;
}

const FRAG_HEAD = /* glsl */ `
uniform float uTime;
uniform sampler2D uShore;
uniform vec3 uShallow;
uniform vec3 uFoam;
varying vec3 vWPos;
float waterHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
`;

// Pixel-art water: the surface is quantized into WATER_PX cells per block; two
// slow sine fields + a static per-pixel hash pick lighter ripple streaks and
// darker troughs (Minecraft's flowing water texture, procedurally). The shore
// mask (nearest-sampled at the same pixel grid) lays a pale foam line and a
// lighter band of shallows around the island. Ripples fade out with distance so
// far water doesn't shimmer.
const FRAG_BODY = /* glsl */ `
{
  vec2 pxl = floor(vWPos.xz * ${WATER_PX.toFixed(1)});
  vec2 c = (pxl + 0.5) / ${WATER_PX.toFixed(1)};
  float detail = 1.0 - smoothstep(35.0, 130.0, length(vWPos.xz - cameraPosition.xz));
  float r = sin(c.x * 1.1 + c.y * 0.35 + uTime * 0.8)
          + sin(c.y * 0.9 - c.x * 0.5 - uTime * 0.6)
          + (waterHash(pxl) - 0.5) * 1.1;
  float hi = step(1.2, r);
  float lo = step(r, -1.35);
  diffuseColor.rgb *= 1.0 + (hi * 0.32 - lo * 0.16) * detail;
  vec2 suv = (pxl + 0.5) / ${SHORE_RES.toFixed(1)} + 0.5;
  float shore = texture2D(uShore, suv).r;
  float shallow = step(0.08, shore);
  float foam = step(0.78, shore) * (0.75 + 0.25 * step(0.0, sin(uTime * 1.6 + (c.x + c.y) * 0.8)));
  diffuseColor.rgb = mix(diffuseColor.rgb, uShallow * (1.0 + hi * 0.2 * detail), shallow * 0.55);
  diffuseColor.rgb = mix(diffuseColor.rgb, uFoam, foam);
  diffuseColor.a = mix(diffuseColor.a, 0.92, max(foam, shallow * 0.3));
}
`;

/**
 * The ocean the island sits in — grounds the floating plates and turns terraces
 * into shoreline. Flat (like Minecraft water) with a pixel-quantized, animated
 * ripple pattern and shallows/foam around every ground column, all in the
 * fragment shader. The standard material keeps the sun glint + fog for free.
 */
export function createWater(scene: THREE.Scene): Water {
  const material = new THREE.MeshStandardMaterial({
    color: 0x2a64bd,
    transparent: true,
    opacity: 0.82,
    roughness: 0.7,
    metalness: 0,
  });

  const shoreData = new Uint8Array(SHORE_RES * SHORE_RES);
  const shoreTex = new THREE.DataTexture(
    shoreData,
    SHORE_RES,
    SHORE_RES,
    THREE.RedFormat,
    THREE.UnsignedByteType
  );
  shoreTex.magFilter = THREE.NearestFilter;
  shoreTex.minFilter = THREE.NearestFilter;
  shoreTex.generateMipmaps = false;
  shoreTex.needsUpdate = true;
  let shoreDirty = false;
  let lastUpload = -Infinity;

  const uniforms = {
    uTime: { value: 0 },
    uShore: { value: shoreTex },
    uShallow: { value: new THREE.Color(0x3f9ad6) },
    uFoam: { value: new THREE.Color(0xc4e8f6) },
  };
  material.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms);
    s.vertexShader =
      "varying vec3 vWPos;\n" +
      s.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\n\tvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;"
      );
    s.fragmentShader =
      FRAG_HEAD +
      s.fragmentShader.replace(
        "#include <color_fragment>",
        "#include <color_fragment>\n" + FRAG_BODY
      );
  };

  const mesh = new THREE.Mesh(waterGeometry(), material);
  mesh.position.y = WATER_LEVEL;
  scene.add(mesh);

  const reachPx = Math.ceil(SHORE_REACH * WATER_PX);
  return {
    update(t) {
      uniforms.uTime.value = t;
      if (shoreDirty && t - lastUpload >= SHORE_UPLOAD_EVERY) {
        shoreTex.needsUpdate = true;
        shoreDirty = false;
        lastUpload = t;
      }
    },
    markLand(x, z) {
      // texel (i, j) covers world [i/WATER_PX - SHORE_HALF, +1/WATER_PX)
      const ci = (x + SHORE_HALF) * WATER_PX;
      const cj = (z + SHORE_HALF) * WATER_PX;
      const half = WATER_PX / 2 + reachPx;
      const i0 = Math.max(0, Math.floor(ci - half));
      const i1 = Math.min(SHORE_RES - 1, Math.ceil(ci + half));
      const j0 = Math.max(0, Math.floor(cj - half));
      const j1 = Math.min(SHORE_RES - 1, Math.ceil(cj + half));
      for (let j = j0; j <= j1; j++) {
        const dz = Math.abs(j + 0.5 - cj) / WATER_PX - 0.5;
        for (let i = i0; i <= i1; i++) {
          const dx = Math.abs(i + 0.5 - ci) / WATER_PX - 0.5;
          const v = shoreValue(Math.max(dx, dz));
          const k = j * SHORE_RES + i;
          if (v > shoreData[k]) shoreData[k] = v;
        }
      }
      shoreDirty = true;
    },
    resetLand() {
      shoreData.fill(0);
      shoreDirty = true;
    },
  };
}
