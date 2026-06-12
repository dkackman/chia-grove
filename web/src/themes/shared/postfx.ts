import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

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
}

export interface PostFx {
  render(): void;
  setSize(width: number, height: number): void;
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
  composer.addPass(
    new UnrealBloomPass(
      new THREE.Vector2(innerWidth, innerHeight),
      opts.bloomStrength,
      opts.bloomRadius,
      opts.bloomThreshold
    )
  );
  // OutputPass applies renderer.toneMapping and converts to the output color
  // space; it must be last.
  composer.addPass(new OutputPass());

  return {
    render: () => composer.render(),
    // EffectComposer.setSize resizes its targets and every pass (incl. bloom)
    setSize: (width, height) => composer.setSize(width, height),
  };
}
