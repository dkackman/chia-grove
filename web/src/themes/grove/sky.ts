import * as THREE from "three";
import { COLORS } from "./palette.js";
import { glowTexture } from "../shared/textures.js";
import { NOISE_GLSL } from "./glsl.js";
import { safeBigInt } from "../shared/util.js";

/** Low over the horizon, left of the opening view direction. */
const MOON_POSITION = new THREE.Vector3(-156, 19, 6);
/** Billboard quad edge (world units); the disc is MOON_DISC of the half-size. */
const MOON_QUAD = 44;
const MOON_DISC = 0.19;

const AURORA_RADIUS = 172;
const AURORA_ARC = Math.PI * 0.95;
const AURORA_BASE = -4;
const AURORA_HEIGHT = 70;
/** Resting aurora strength between blocks (a block flares it to 1). */
const AURORA_REST = 0.4;

const MOON_VERT = /* glsl */ `
uniform float uSize;
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * uSize;
  gl_Position = projectionMatrix * mv;
}
`;

const MOON_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uHalo;
uniform float uBright;
varying vec2 vUv;
${NOISE_GLSL}
void main() {
  const float R = ${MOON_DISC.toFixed(3)};
  float r = length(vUv);
  float aa = fwidth(r);
  float disc = 1.0 - smoothstep(R - aa, R + aa, r);
  vec2 q = vUv / R;
  float mu = sqrt(max(0.0, 1.0 - dot(q, q)));
  float limb = 0.6 + 0.4 * mu;
  float maria = gFbm(q * 1.7 + vec2(3.7, 1.2));
  float surface = mix(1.0, 0.58, smoothstep(0.42, 0.7, maria));
  vec3 face = uColor * limb * surface * 0.95;
  float out_ = max(r - R, 0.0);
  float halo = (exp(-out_ * 7.0) * 0.28 + exp(-out_ * 30.0) * 0.45) * (1.0 - smoothstep(0.6, 1.0, r));
  vec3 rgb = (face * disc + uHalo * halo * (1.0 - disc)) * uBright;
  gl_FragColor = vec4(rgb, disc);
}
`;

const AURORA_VERT = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position;
  // slow folds: push the ribbon in and out along its length
  float fold = sin(uv.x * 11.0 + uTime * 0.12) * 0.05 + sin(uv.x * 27.0 - uTime * 0.2) * 0.02;
  p.xz *= 1.0 + fold;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const AURORA_FRAG = /* glsl */ `
uniform float uTime;
uniform float uEnergy;
uniform vec3 uLow;
uniform vec3 uMid;
uniform vec3 uHigh;
varying vec2 vUv;
${NOISE_GLSL}
void main() {
  float x = vUv.x;
  float y = vUv.y;
  // wavy, drifting lower hem
  float hem = 0.2 + 0.06 * sin(x * 9.0 + uTime * 0.09) + 0.035 * sin(x * 23.0 - uTime * 0.16)
    + 0.03 * (gNoise(vec2(x * 14.0, uTime * 0.05)) - 0.5);
  float h = y - hem;
  float lower = smoothstep(-0.025, 0.03, h);
  // bright hem line, long soft fade upward
  float body = exp(-max(h, 0.0) * 3.2) + exp(-max(h, 0.0) * 22.0) * 0.8;
  // vertical ray streaks that shimmer and drift sideways
  float rays = gNoise(vec2(x * 140.0 + uTime * 0.35, uTime * 0.25))
    * (0.45 + 0.55 * gNoise(vec2(x * 45.0 - uTime * 0.2, 3.0)));
  rays = 0.3 + 0.9 * rays * rays;
  // big patches of brighter curtain wander along the arc
  float patches = smoothstep(0.2, 0.8, gFbm(vec2(x * 5.0 - uTime * 0.03, 1.7)));
  float ends = smoothstep(0.0, 0.2, x) * smoothstep(1.0, 0.8, x);
  float top = 1.0 - smoothstep(0.45, 0.95, y);
  float intensity = lower * body * rays * (0.25 + 0.75 * patches) * ends * top;
  vec3 col = mix(uLow, uMid, smoothstep(0.02, 0.2, h));
  col = mix(col, uHigh, smoothstep(0.18, 0.5, h));
  gl_FragColor = vec4(col * intensity * uEnergy * 0.55, 1.0);
}
`;

export interface Sky {
  update(dt: number, t: number): void;
  pulse(): void;
  setNetspace(bytes: string): void;
  setSignalLost(lost: boolean): void;
}

export function createSky(scene: THREE.Scene, reducedMotion = false): Sky {
  const glowMap = glowTexture();
  const METEOR_AXIS = new THREE.Vector3(1, 0, 0);

  // starfield dome — twinkle runs entirely on the GPU via a uTime uniform so
  // there are no per-frame CPU writes or buffer uploads for 900 stars
  const starCount = 900;
  const positions = new Float32Array(starCount * 3);
  const starPhase = new Float32Array(starCount);
  const starSpeed = new Float32Array(starCount);
  const baseStar = new THREE.Color(0xd6e8e2);
  for (let i = 0; i < starCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(0.15 + Math.random() * 0.85); // bias upward
    const radius = 180;
    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = radius * Math.cos(phi);
    positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
    starPhase[i] = Math.random() * Math.PI * 2;
    starSpeed[i] = 0.6 + Math.random() * 1.6;
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  starGeometry.setAttribute("aPhase", new THREE.BufferAttribute(starPhase, 1));
  starGeometry.setAttribute("aSpeed", new THREE.BufferAttribute(starSpeed, 1));

  let starShader: { uniforms: Record<string, { value: number }> } | null = null;
  const starMaterial = new THREE.PointsMaterial({
    size: 1.5,
    map: glowMap,
    color: baseStar,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false, // stars are at the edge of the dome (r=180); meadow fog would erase them entirely
  });
  starMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.vertexShader =
      "attribute float aPhase;\nattribute float aSpeed;\nuniform float uTime;\nvarying float vTwinkle;\n" +
      shader.vertexShader.replace(
        "#include <color_vertex>",
        "#include <color_vertex>\nvTwinkle = 0.7 + 0.3 * sin(uTime * aSpeed + aPhase);"
      );
    shader.fragmentShader =
      "varying float vTwinkle;\n" +
      shader.fragmentShader.replace(
        "#include <color_fragment>",
        "#include <color_fragment>\ndiffuseColor.rgb *= vTwinkle;"
      );
    starShader = shader as unknown as typeof starShader;
  };
  const stars = new THREE.Points(starGeometry, starMaterial);
  stars.renderOrder = -3;
  scene.add(stars);

  // moon: a billboarded disc with soft maria, limb darkening and a halo, sat
  // low over the horizon where the tilted orbit camera actually sees it (the
  // old high glow sprite was always above the frame). Brightness tracks
  // netspace via `moonLevel`. Premultiplied blending lets the disc occlude the
  // stars behind it while the halo stays additive.
  const moonUniforms = {
    uSize: { value: MOON_QUAD },
    uColor: { value: new THREE.Color(COLORS.moon) },
    uHalo: { value: new THREE.Color(0x7fa6d8) },
    uBright: { value: 0.9 },
  };
  const moon = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShaderMaterial({
      uniforms: moonUniforms,
      vertexShader: MOON_VERT,
      fragmentShader: MOON_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    })
  );
  moon.position.copy(MOON_POSITION);
  moon.frustumCulled = false; // billboarded in the vertex shader
  moon.renderOrder = -1; // after the stars, so the disc hides the ones behind it
  scene.add(moon);

  const moonLight = new THREE.DirectionalLight(0xbfd8ff, 0.55);
  moonLight.position.set(-60, 58, -95); // high key light for the flora, independent of the visible disc
  scene.add(moonLight);

  // aurora: a curved curtain ribbon far behind the meadow. The shader draws
  // vertical ray streaks with a wavy, drifting lower hem and soft falloff on
  // every edge — no geometry edge is ever visible. It glows faintly at rest
  // and flares on each block.
  const auroraUniforms = {
    uTime: { value: 0 },
    uEnergy: { value: 0 },
    uLow: { value: new THREE.Color(COLORS.aurora) },
    uMid: { value: new THREE.Color(0x3fc6d8) },
    uHigh: { value: new THREE.Color(0x7a4dd8) },
  };
  const aurora = new THREE.Mesh(
    new THREE.CylinderGeometry(
      AURORA_RADIUS,
      AURORA_RADIUS,
      AURORA_HEIGHT,
      96,
      1,
      true,
      Math.PI - AURORA_ARC / 2,
      AURORA_ARC
    ),
    new THREE.ShaderMaterial({
      uniforms: auroraUniforms,
      vertexShader: AURORA_VERT,
      fragmentShader: AURORA_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    })
  );
  aurora.position.y = AURORA_BASE + AURORA_HEIGHT / 2;
  aurora.frustumCulled = false;
  aurora.renderOrder = -2;
  scene.add(aurora);

  // occasional shooting star: a tapering streak (head bright, tail fading via
  // additive vertex colors) plus a soft glow head. Rare and off-beat — a
  // reward for watching, never tied to an event.
  const METEOR_LEN = 11;
  const METEOR_SEGMENTS = 12;
  const METEOR_DURATION = 1.1;
  const meteorPos = new Float32Array((METEOR_SEGMENTS + 1) * 3);
  const meteorCol = new Float32Array((METEOR_SEGMENTS + 1) * 3);
  for (let i = 0; i <= METEOR_SEGMENTS; i++) {
    const f = i / METEOR_SEGMENTS; // 0 at head, 1 at tail
    meteorPos[i * 3] = -f * METEOR_LEN; // trail extends along local -X
    const b = (1 - f) ** 1.5; // additive brightness fades toward the tail
    meteorCol[i * 3] = b;
    meteorCol[i * 3 + 1] = b;
    meteorCol[i * 3 + 2] = b;
  }
  const meteorGeometry = new THREE.BufferGeometry();
  meteorGeometry.setAttribute("position", new THREE.BufferAttribute(meteorPos, 3));
  meteorGeometry.setAttribute("color", new THREE.BufferAttribute(meteorCol, 3));
  const meteor = new THREE.Line(
    meteorGeometry,
    new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    })
  );
  meteor.visible = false;
  scene.add(meteor);

  const meteorHead = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowMap,
      color: 0xeaf2ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    })
  );
  meteorHead.scale.setScalar(3);
  meteorHead.visible = false;
  scene.add(meteorHead);

  const meteorFrom = new THREE.Vector3();
  const meteorDir = new THREE.Vector3();
  const meteorAt = new THREE.Vector3();
  let meteorActive = false;
  let meteorStart = 0;
  let nextMeteor = 8 + Math.random() * 20; // first within the opening ~30s

  function launchMeteor(t: number): void {
    const R = 150;
    const theta = Math.random() * Math.PI * 2;
    meteorFrom.set(Math.cos(theta) * R, R * (0.55 + Math.random() * 0.4), Math.sin(theta) * R - 40);
    // travel mostly downward with a lateral drift
    meteorDir
      .set((Math.random() - 0.5) * 1.4, -(0.5 + Math.random() * 0.4), (Math.random() - 0.5) * 1.4)
      .normalize();
    meteor.quaternion.setFromUnitVectors(METEOR_AXIS, meteorDir);
    meteorActive = true;
    meteorStart = t;
    meteor.visible = true;
    meteorHead.visible = true;
  }

  function updateMeteor(t: number): void {
    if (meteorActive) {
      const p = (t - meteorStart) / METEOR_DURATION;
      if (p >= 1) {
        meteorActive = false;
        meteor.visible = false;
        meteorHead.visible = false;
        nextMeteor = t + 18 + Math.random() * 22; // 18–40s between sightings
        return;
      }
      meteorAt.copy(meteorFrom).addScaledVector(meteorDir, p * 90);
      meteor.position.copy(meteorAt);
      meteorHead.position.copy(meteorAt);
      const env = Math.sin(p * Math.PI); // fade in, then out
      (meteor.material as THREE.LineBasicMaterial).opacity = env * 0.9;
      meteorHead.material.opacity = env * 0.8;
    } else if (!reducedMotion && !signalLost && t >= nextMeteor) {
      launchMeteor(t);
    }
  }

  let auroraEnergy = 0;
  let moonTarget = 0.9;
  let moonLevel = 0.9;
  let signalLost = false;

  return {
    update(dt, t) {
      auroraEnergy = Math.max(0, auroraEnergy - dt / 4);
      auroraUniforms.uEnergy.value =
        (AURORA_REST + (1 - AURORA_REST) * auroraEnergy) * (signalLost ? 0.4 : 1);
      auroraUniforms.uTime.value = reducedMotion ? t * 0.1 : t;

      const target = signalLost ? moonTarget * 0.35 : moonTarget;
      moonLevel += (target - moonLevel) * Math.min(dt, 1);
      moonUniforms.uBright.value = moonLevel;
      moonLight.intensity = 0.15 + moonLevel * 0.5;

      stars.rotation.y = t * 0.004;
      if (starShader) starShader.uniforms.uTime.value = reducedMotion ? 0 : t;
      updateMeteor(t);
    },
    pulse() {
      auroraEnergy = 1;
    },
    setNetspace(bytes) {
      const eib = Number(safeBigInt(bytes) >> 50n) / 1024;
      moonTarget = Math.min(1.05, Math.max(0.55, 0.55 + (eib - 10) * 0.0125));
    },
    setSignalLost(lost) {
      signalLost = lost;
    },
  };
}
