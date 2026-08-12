import * as THREE from "three";
import type { GroveEvent, SproutEvent } from "@grove/shared";
import type { GroveFeed } from "../../net/feed.js";
import { createFrameLimiter } from "../shared/frame-limiter.js";
import { createOrbitControl } from "../shared/orbit.js";
import { createPostFx } from "../shared/postfx.js";
import { createBed } from "./bed.js";
import { BED_Y, TOP_BAND_Y } from "./layout.js";
import { LAKE } from "./palette.js";
import { createLakeWater } from "./water.js";

/** Where the camera hangs in the column — high enough to see the surface. */
const CAM_Y = TOP_BAND_Y - 11;
const CAM_RADIUS = 34;

export function startLake(canvas: HTMLCanvasElement, feed: GroveFeed) {
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.setSize(innerWidth, innerHeight);

  const orbit = createOrbitControl(canvas);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(LAKE.deep);
  const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 400);

  const water = createLakeWater(scene);
  const bed = createBed(scene);

  const postfx = createPostFx(renderer, scene, camera, {
    toneMapping: THREE.ACESFilmicToneMapping,
    exposure: 1.0,
    bloomStrength: 0.12,
    bloomRadius: 0.6,
    bloomThreshold: 0.75,
  });

  // wired up by index.ts once the systems exist
  let onSprout = (_event: SproutEvent, _blocksSeen: number) => {};
  let onBlockExtra = (_blocksSeen: number) => {};
  let onAmbientExtra = (_mempoolSize: number) => {};
  let onReorgExtra = (_forkHeight: number) => {};
  let onContentFlag = (_launcherId: string) => {};
  let extraUpdate = (_dt: number, _t: number, _blocksSeen: number) => {};

  // Monotonic block counter. Every planted object stores this value as its
  // bornBlock; its depth is bandDepth(blocksSeen - bornBlock). That subtraction
  // is the entire sinking mechanism — there is no per-band state to keep in sync.
  let blocksSeen = 0;

  feed.onEvent((event: GroveEvent) => {
    switch (event.type) {
      case "block":
        blocksSeen++;
        onBlockExtra(blocksSeen);
        break;
      case "sprout":
        onSprout(event, blocksSeen);
        break;
      case "ambient":
        water.setNetspace(event.netspace);
        onAmbientExtra(event.mempoolSize);
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
    // look slightly upward so the surface and its shafts stay in frame — the
    // whole point of being submerged rather than looking down at a bed
    camera.lookAt(0, y + 5, 0);

    water.update(t);
    bed.update(t);
    extraUpdate(dt, t, blocksSeen);
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
    { renderer, camera, scene, water, bedDepth: BED_Y },
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
