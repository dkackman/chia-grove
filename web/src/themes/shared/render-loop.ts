import * as THREE from "three";
import { createFrameLimiter } from "./frame-limiter.js";
import type { PostFx } from "./postfx.js";
import { QualityGovernor } from "./quality.js";

/** Largest dt handed to a theme's update; longer gaps are clamped. */
const MAX_DT = 0.1;

export interface RenderLoopStart {
  camera: THREE.PerspectiveCamera;
  /** Per-frame theme logic, run before `onFrame` callbacks and the draw. */
  update(dt: number, t: number): void;
  /** Draw through the post-processing chain (and let the governor toggle bloom)... */
  postfx?: PostFx;
  /** ...or draw `scene` directly with the renderer. */
  scene?: THREE.Scene;
}

export interface RenderLoop {
  readonly renderer: THREE.WebGLRenderer;
  /** Current `prefers-reduced-motion` preference; tracks changes live. */
  readonly reducedMotion: boolean;
  onReducedMotionChange(fn: (reduced: boolean) => void): void;
  /** Register a callback run every rendered frame, after `update`, before the draw. */
  onFrame(fn: () => void): void;
  /** Register extra resize work; runs after the camera/renderer/postfx resize. */
  onResize(fn: () => void): void;
  /** Start the rAF loop. Call once, after the scene is built. */
  start(opts: RenderLoopStart): void;
}

/**
 * The boilerplate every theme shares: the WebGL renderer, a 60 fps-capped rAF
 * loop on a page-visibility-aware `THREE.Timer` (so `t` doesn't jump after a
 * hidden tab), the resize handler (re-reading devicePixelRatio, e.g. after the
 * window moves to another display), a live reduced-motion flag, and an
 * adaptive-quality governor that steps the pixel ratio 1.75 → 1.25 → 1 and
 * finally drops bloom when frames run long, recovering slowly once they don't.
 */
export function createRenderLoop(canvas: HTMLCanvasElement): RenderLoop {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  const governor = new QualityGovernor();
  const pixelRatio = () => Math.min(devicePixelRatio, governor.level.maxPixelRatio);
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(innerWidth, innerHeight);

  const motionQuery = matchMedia("(prefers-reduced-motion: reduce)");
  let reducedMotion = motionQuery.matches;
  const motionListeners: Array<(reduced: boolean) => void> = [];
  motionQuery.addEventListener("change", (e) => {
    reducedMotion = e.matches;
    for (const fn of motionListeners) fn(reducedMotion);
  });

  const frameCallbacks: Array<() => void> = [];
  const resizeCallbacks: Array<() => void> = [];
  let started = false;

  return {
    renderer,
    get reducedMotion() {
      return reducedMotion;
    },
    onReducedMotionChange: (fn) => void motionListeners.push(fn),
    onFrame: (fn) => void frameCallbacks.push(fn),
    onResize: (fn) => void resizeCallbacks.push(fn),

    start({ camera, update, postfx, scene }) {
      if (started) return;
      started = true;
      if (!postfx && !scene) throw new Error("createRenderLoop.start needs postfx or scene");

      const resize = (): void => {
        camera.aspect = innerWidth / innerHeight;
        camera.updateProjectionMatrix();
        const ratio = pixelRatio();
        renderer.setPixelRatio(ratio);
        renderer.setSize(innerWidth, innerHeight);
        postfx?.setPixelRatio(ratio);
        postfx?.setSize(innerWidth, innerHeight);
        for (const fn of resizeCallbacks) fn();
      };
      addEventListener("resize", resize);

      const timer = new THREE.Timer();
      timer.connect(document);
      const limiter = createFrameLimiter();
      let lastFrameAt: number | null = null;

      const frame = (): void => {
        requestAnimationFrame(frame);
        const now = performance.now();
        if (!limiter.shouldRender(now)) return;
        if (lastFrameAt !== null) {
          const changed = governor.sample(now - lastFrameAt, now);
          if (changed) {
            postfx?.setBloomEnabled(changed.bloom);
            resize();
          }
        }
        lastFrameAt = now;

        timer.update();
        const dt = Math.min(timer.getDelta(), MAX_DT);
        const t = timer.getElapsed();
        update(dt, t);
        for (const fn of frameCallbacks) fn();
        if (postfx) postfx.render();
        else renderer.render(scene!, camera);
      };
      frame();
    },
  };
}
