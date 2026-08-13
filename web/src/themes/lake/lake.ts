import * as THREE from "three";
import type { AmbientEvent, BlockEvent, GroveEvent, SproutEvent } from "@grove/shared";
import type { GroveFeed } from "../../net/feed.js";
import { createFrameLimiter } from "../shared/frame-limiter.js";
import { createOrbitControl } from "../shared/orbit.js";
import { createPostFx } from "../shared/postfx.js";
import { createBed } from "./bed.js";
import { LAKE_FOV, ORBIT_RATE, frameTarget } from "./camera.js";
import { MAX_BANDS, easeBlocks } from "./layout.js";
import { LAKE } from "./palette.js";
import { createLakeWater } from "./water.js";

export function startLake(canvas: HTMLCanvasElement, feed: GroveFeed) {
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.setSize(innerWidth, innerHeight);

  const orbit = createOrbitControl(canvas);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(LAKE.deep);
  const camera = new THREE.PerspectiveCamera(LAKE_FOV, innerWidth / innerHeight, 0.1, 400);

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

  // Eased camera state. Neither is a function of time — see frameTarget.
  // Seeded from the empty framing so the first frame does not sweep in from
  // the origin.
  let camDistance = 0;
  let camCenterY = 0;
  {
    const initial = frameTarget(0, LAKE_FOV, camera.aspect);
    camDistance = initial.distance;
    camCenterY = initial.centerY;
  }

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

    const target = frameTarget(Math.min(blocksSeen, MAX_BANDS), LAKE_FOV, camera.aspect);
    // ease at rate 0.8 — slower than easeBlocks's 2.2, so the camera lags the
    // band sink instead of racing it. Framing should follow the motion it is
    // tracking, not fight it for who leads.
    const k = 1 - Math.exp(-dt * 0.8);
    camDistance += (target.distance - camDistance) * k;
    camCenterY += (target.centerY - camCenterY) * k;

    const angle = (reducedMotion ? 0.6 : t * ORBIT_RATE) + orbit.getOffset();
    camera.position.set(Math.cos(angle) * camDistance, camCenterY, Math.sin(angle) * camDistance);
    camera.lookAt(0, camCenterY, 0);

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
