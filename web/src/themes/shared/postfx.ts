import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

/** A light colour grade applied after bloom, before tone mapping/output. */
export interface GradeOptions {
  /** 1 = unchanged; >1 richer colour. */
  saturation?: number;
  /** 1 = unchanged; >1 steeper around mid-grey. */
  contrast?: number;
  /** 0 = none; fraction of light lost in the extreme corners. */
  vignette?: number;
}

const GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uSaturation: { value: 1 },
    uContrast: { value: 1 },
    uVignette: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uSaturation;
    uniform float uContrast;
    uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 c = texel.rgb;
      float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = max(mix(vec3(luma), c, uSaturation), 0.0);
      // linear-light contrast pivoting on mid-grey (0.18)
      c = 0.18 * pow(c / 0.18, vec3(uContrast));
      vec2 q = vUv - 0.5;
      c *= 1.0 - uVignette * smoothstep(0.25, 0.85, dot(q, q) * 2.0);
      gl_FragColor = vec4(c, texel.a);
    }`,
};

export interface PostFxOptions {
  /** Tone-mapping curve. Default NoToneMapping (preserves the raw palette). */
  toneMapping?: THREE.ToneMapping;
  /** Exposure multiplier; only meaningful when a tone-mapping curve is set. */
  exposure?: number;
  /** Bloom intensity. */
  bloomStrength: number;
  /** Bloom spread (0–1). */
  bloomRadius: number;
  /** Luminance above which pixels bloom (high = only the brightest highlights). */
  bloomThreshold: number;
  /** Optional colour grade (saturation / contrast / vignette). Omitted = no pass. */
  grade?: GradeOptions;
}

export interface PostFx {
  render(): void;
  setSize(width: number, height: number): void;
  setPixelRatio(ratio: number): void;
  /** Toggle the bloom pass (the adaptive-quality governor drops it on slow devices). */
  setBloomEnabled(on: boolean): void;
}

/**
 * Wraps the renderer in an EffectComposer: scene → bloom → tone-map/output.
 * Tone mapping is applied by OutputPass, so a theme can opt into ACES for a
 * glow-heavy night scene or leave it off to keep a bright daytime palette
 * untouched while still getting a subtle highlight bloom.
 */
export function createPostFx(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  opts: PostFxOptions
): PostFx {
  renderer.toneMapping = opts.toneMapping ?? THREE.NoToneMapping;
  renderer.toneMappingExposure = opts.exposure ?? 1;

  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(innerWidth, innerHeight);

  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(innerWidth, innerHeight),
    opts.bloomStrength,
    opts.bloomRadius,
    opts.bloomThreshold
  );
  composer.addPass(bloom);
  if (opts.grade) {
    const grade = new ShaderPass(GRADE_SHADER);
    grade.uniforms.uSaturation.value = opts.grade.saturation ?? 1;
    grade.uniforms.uContrast.value = opts.grade.contrast ?? 1;
    grade.uniforms.uVignette.value = opts.grade.vignette ?? 0;
    composer.addPass(grade);
  }
  // OutputPass applies renderer.toneMapping and converts to the output color
  // space; it must be last.
  composer.addPass(new OutputPass());

  return {
    render: () => composer.render(),
    // EffectComposer.setSize resizes its targets and every pass (incl. bloom)
    setSize: (width, height) => composer.setSize(width, height),
    setPixelRatio: (ratio) => composer.setPixelRatio(ratio),
    setBloomEnabled: (on) => {
      bloom.enabled = on;
    },
  };
}
