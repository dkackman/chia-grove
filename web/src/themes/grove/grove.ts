import * as THREE from "three";
import type { GroveEvent, SproutEvent } from "@grove/shared";
import type { GroveFeed } from "../../net/feed.js";
import { type XZ } from "../shared/util.js";
import { createFrameLimiter } from "../shared/frame-limiter.js";
import { createGround } from "./ground.js";
import { blockPosition } from "./layout.js";
import { COLORS } from "./palette.js";
import { createSky } from "./sky.js";
import { createPostFx } from "../shared/postfx.js";
import { createOrbitControl } from "../shared/orbit.js";

/** Spiral slots wrap so the grove never grows beyond the meadow. */
const MAX_BLOCK_SLOTS = 500;

/**
 * Vertical night-sky gradient: a near-black zenith easing to a faint teal
 * horizon glow, so the dark meadow reads as a silhouette against the sky
 * instead of blending into a flat black void. (Background is not fogged, so
 * the glow stays visible behind the fogged-out far ground.)
 */
function nightSkyGradient(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, "#03070d"); // zenith
  g.addColorStop(0.25, "#0a2330");
  g.addColorStop(0.4, "#1f5a70"); // horizon glow — sits where the tilted camera puts the horizon
  g.addColorStop(0.58, "#0e2f3c");
  g.addColorStop(1, "#071520");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// NOTE: no explicit return-type annotation — the inferred type must include
// the handler setters added via Object.assign (later tasks rely on them).
export function startGrove(canvas: HTMLCanvasElement, feed: GroveFeed) {
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.setSize(innerWidth, innerHeight);

  const orbit = createOrbitControl(canvas);

  const scene = new THREE.Scene();
  scene.background = nightSkyGradient();
  scene.fog = new THREE.FogExp2(COLORS.fog, 0.016);

  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 500);

  scene.add(new THREE.HemisphereLight(0x23402e, 0x050a06, 0.7));

  const sky = createSky(scene, reducedMotion);
  const ground = createGround(scene, reducedMotion);

  // bloom makes the bioluminescent emissives, moon, and fireflies truly glow;
  // ACES rolls the bright additive highlights off instead of clipping to white
  const postfx = createPostFx(renderer, scene, camera, {
    toneMapping: THREE.ACESFilmicToneMapping,
    exposure: 1.15,
    bloomStrength: 0.1,
    bloomRadius: 0.4,
    bloomThreshold: 0.5,
  });

  // wired up by later tasks (flora, fireflies):
  let onSprout = (_event: SproutEvent, _blockPos: XZ) => {};
  let onAmbientExtra = (_mempoolSize: number, _mempoolCost: string) => {};
  let onBlockExtra = (_pos: XZ) => {};
  let onReorgExtra = () => {};
  let extraUpdate = (_dt: number, _t: number) => {};

  let blockIndex = 0;
  let currentBlockPos = blockPosition(0);

  feed.onEvent((event: GroveEvent) => {
    switch (event.type) {
      case "block":
        currentBlockPos = blockPosition(blockIndex);
        blockIndex = (blockIndex + 1) % MAX_BLOCK_SLOTS;
        ground.ripple(currentBlockPos.x, currentBlockPos.z);
        sky.pulse();
        onBlockExtra(currentBlockPos);
        break;
      case "sprout":
        onSprout(event, currentBlockPos);
        break;
      case "ambient":
        sky.setNetspace(event.netspace);
        onAmbientExtra(event.mempoolSize, event.mempoolCost);
        break;
      case "reorg":
        ground.ripple(0, 0);
        onReorgExtra();
        break;
    }
  });

  feed.onStatus((status) => sky.setSignalLost(status === "stale"));

  const timer = new THREE.Timer();
  const limiter = createFrameLimiter();
  function frame(): void {
    requestAnimationFrame(frame);
    if (!limiter.shouldRender(performance.now())) return;
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.1);
    const t = timer.getElapsed();

    const angle = (reducedMotion ? 0.8 : t * 0.02) + orbit.getOffset();
    const radius = 34 + (reducedMotion ? 0 : Math.sin(t * 0.07) * 2.5);
    camera.position.set(
      Math.cos(angle) * radius,
      13.5 + Math.sin(t * 0.05) * 0.8,
      Math.sin(angle) * radius
    );
    camera.lookAt(0, 2.5, 0);

    sky.update(dt, t);
    ground.update(dt);
    extraUpdate(dt, t);
    postfx.render();
  }
  frame();

  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    postfx.setSize(innerWidth, innerHeight);
  });

  // hooks consumed by later tasks (kept on the handle object via closure setters)
  return Object.assign(
    { renderer, camera, scene },
    {
      setSproutHandler: (fn: typeof onSprout) => (onSprout = fn),
      setAmbientHandler: (fn: typeof onAmbientExtra) => (onAmbientExtra = fn),
      setBlockHandler: (fn: typeof onBlockExtra) => (onBlockExtra = fn),
      setReorgHandler: (fn: typeof onReorgExtra) => (onReorgExtra = fn),
      setUpdateHandler: (fn: typeof extraUpdate) => (extraUpdate = fn),
      isDragging: () => orbit.isDragging(),
      reducedMotion,
    }
  );
}

export type GroveRuntime = ReturnType<typeof startGrove>;
