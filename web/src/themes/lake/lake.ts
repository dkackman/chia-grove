import * as THREE from "three";
import type { AmbientEvent, BlockEvent, GroveEvent, SproutEvent } from "@grove/shared";
import type { GroveFeed } from "../../net/feed.js";
import { createFrameLimiter } from "../shared/frame-limiter.js";
import { createOrbitControl } from "../shared/orbit.js";
import { createPostFx } from "../shared/postfx.js";
import { createBed } from "./bed.js";
import { BED_Y, TOP_BAND_Y, easeBlocks } from "./layout.js";
import { LAKE } from "./palette.js";
import { createLakeWater } from "./water.js";

/**
 * Where the camera hangs in the column. Centered between the surface and the
 * bed (rather than hugging the surface) so both ends of the water column
 * land inside the frustum at once — a wide vertical FOV plus this midpoint
 * height is what gets the ceiling and the bed into the same shot.
 */
const CAM_Y = (TOP_BAND_Y + BED_Y) / 2;
const CAM_RADIUS = 34;

export function startLake(canvas: HTMLCanvasElement, feed: GroveFeed) {
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.setSize(innerWidth, innerHeight);

  const orbit = createOrbitControl(canvas);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(LAKE.deep);
  // A wide vertical FOV so the midpoint camera height still catches both the
  // surface (up) and the bed (down) inside the frame instead of only one.
  const camera = new THREE.PerspectiveCamera(84, innerWidth / innerHeight, 0.1, 400);

  const water = createLakeWater(scene);
  const bed = createBed(scene);

  const postfx = createPostFx(renderer, scene, camera, {
    toneMapping: THREE.ACESFilmicToneMapping,
    exposure: 1.0,
    bloomStrength: 0.12,
    bloomRadius: 0.6,
    // Raised from 0.75 — the pale shaft color (0xa8e0f5) is bright enough on
    // its own to trip a low threshold even at the low opacities the shafts
    // render at, blowing them out into solid wedges instead of a soft glow.
    bloomThreshold: 0.92,
  });

  // wired up by index.ts once the systems exist
  let onSprout = (_event: SproutEvent, _blocksSeen: number) => {};
  let onBlockExtra = (_event: BlockEvent, _blocksSeen: number) => {};
  let onAmbientExtra = (_event: AmbientEvent) => {};
  let onReorgExtra = (_forkHeight: number) => {};
  let onContentFlag = (_launcherId: string) => {};
  let extraUpdate = (_dt: number, _t: number, _blocksSeen: number) => {};

  // Monotonic block counter. Every planted object stores this value as its
  // bornBlock; its depth is bandDepth(blocksSeen - bornBlock). That subtraction
  // is the entire sinking mechanism — there is no per-band state to keep in sync.
  // A smoothed copy is eased toward this counter each frame and passed to per-frame
  // updates, so the lake glides down a band instead of snapping.
  let blocksSeen = 0;

  // Smoothed copy of the counter handed to per-frame updates: the lake glides
  // down a band over ~1.6 s per block instead of snapping 1.5 units. Planting
  // still uses the integer counter, so bornBlock stays exact.
  let blocksSmooth = 0;

  feed.onEvent((event: GroveEvent) => {
    switch (event.type) {
      case "block":
        blocksSeen++;
        onBlockExtra(event, blocksSeen);
        break;
      case "sprout":
        onSprout(event, blocksSeen);
        break;
      case "ambient":
        water.setNetspace(event.netspace);
        onAmbientExtra(event);
        break;
      case "reorg":
        onReorgExtra(event.forkHeight);
        break;
      case "content-flag":
        onContentFlag(event.launcherId);
        break;
    }
  });

  const timer = new THREE.Timer();
  const limiter = createFrameLimiter();
  function frame(): void {
    requestAnimationFrame(frame);
    if (!limiter.shouldRender(performance.now())) return;
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.1);
    const t = timer.getElapsed();

    const angle = (reducedMotion ? 0.6 : t * 0.02) + orbit.getOffset();
    const y = reducedMotion ? CAM_Y : CAM_Y + Math.sin(t * 0.05) * 2.2;
    camera.position.set(Math.cos(angle) * CAM_RADIUS, y, Math.sin(angle) * CAM_RADIUS);
    // Look toward the column's centerline, with only a light upward bias.
    // Combined with the wide FOV and the midpoint camera height, this keeps
    // the bright surface in the upper part of the frame and a dim glimpse of
    // the bed in the lower part — both ends of the water column at once.
    camera.lookAt(0, y + 2, 0);

    water.update(t);
    bed.update(t);
    blocksSmooth = easeBlocks(blocksSmooth, blocksSeen, dt);
    extraUpdate(dt, t, blocksSmooth);
    postfx.render();
  }
  frame();

  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    postfx.setSize(innerWidth, innerHeight);
  });

  return Object.assign(
    { renderer, camera, scene, water },
    {
      setSproutHandler: (fn: typeof onSprout) => (onSprout = fn),
      setBlockHandler: (fn: typeof onBlockExtra) => (onBlockExtra = fn),
      setAmbientHandler: (fn: typeof onAmbientExtra) => (onAmbientExtra = fn),
      setReorgHandler: (fn: typeof onReorgExtra) => (onReorgExtra = fn),
      setContentFlagHandler: (fn: typeof onContentFlag) => (onContentFlag = fn),
      setUpdateHandler: (fn: typeof extraUpdate) => (extraUpdate = fn),
      isDragging: () => orbit.isDragging(),
      reducedMotion,
    }
  );
}

export type LakeRuntime = ReturnType<typeof startLake>;
