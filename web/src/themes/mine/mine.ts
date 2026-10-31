import * as THREE from "three";
import type { GroveEvent, SproutEvent } from "@grove/shared";
import type { GroveFeed } from "../../net/feed.js";
import type { XZ } from "../shared/util.js";
import { createRenderLoop } from "../shared/render-loop.js";
import { createOrbitControl } from "../shared/orbit.js";
import { createPostFx } from "../shared/postfx.js";
import { chunkPosition, spiralRadius, BlockCursor, MAX_BLOCK_SLOTS } from "./layout.js";
import { createMineSky } from "./sky.js";
import { createWater } from "./water.js";
import { createClouds } from "./clouds.js";

/** Blocks older than this are replay/catch-up, not live — no per-block fanfare. */
const REPLAY_AGE_MS = 120_000;

export function startMine(canvas: HTMLCanvasElement, feed: GroveFeed) {
  const loop = createRenderLoop(canvas);
  const { renderer } = loop;
  let reducedMotion = loop.reducedMotion;
  loop.onReducedMotionChange((reduced) => (reducedMotion = reduced));

  const orbit = createOrbitControl(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 600);

  scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x3a3326, 0.4));
  const sky = createMineSky(scene, reducedMotion);
  const water = createWater(scene);
  const clouds = createClouds(scene, scene.fog as THREE.FogExp2, reducedMotion);

  const postfx = createPostFx(renderer, scene, camera, {
    toneMapping: THREE.ACESFilmicToneMapping,
    exposure: 1.05,
    bloomStrength: 0.07,
    bloomRadius: 0.5,
    bloomThreshold: 0.82,
  });

  // wired up by later tasks (island/cats/structures/vfx via index.ts)
  let onSprout = (_event: SproutEvent, _chunk: XZ, _height: number) => {};
  let onAmbientExtra = (_mempoolSize: number) => {};
  let onBlockExtra = (_chunk: XZ, _index: number, _live: boolean) => {};
  let onReorgExtra = (_forkHeight: number, _forkChunk: XZ | null) => {};
  let onContentFlag = (_launcherId: string) => {};
  let extraUpdate = (_dt: number, _t: number) => {};

  // block height → spiral slot; `cursor.filled` (how far the spiral has
  // populated) drives camera framing, and a reorg rewinds it to the fork's slot
  const cursor = new BlockCursor();
  let currentChunk = chunkPosition(0);

  feed.onEvent((event: GroveEvent) => {
    switch (event.type) {
      case "block": {
        const index = cursor.advance(event.height);
        currentChunk = chunkPosition(index);
        // snapshot replay (and catch-up after a reconnect) delivers old blocks
        // in a burst — flag them so per-block fanfare stays quiet
        const live = event.timestamp * 1000 > Date.now() - REPLAY_AGE_MS;
        onBlockExtra(currentChunk, index, live);
        break;
      }
      case "sprout":
        onSprout(event, currentChunk, event.height);
        break;
      case "ambient":
        sky.setNetspace(event.netspace);
        onAmbientExtra(event.mempoolSize);
        break;
      case "reorg": {
        // rewind the build cursor so the replacement chain rebuilds from the
        // fork's chunk (not past bare orphaned ones), and aim the creeper there
        const forkIndex = cursor.rewind(event.forkHeight);
        onReorgExtra(event.forkHeight, forkIndex === null ? null : chunkPosition(forkIndex));
        break;
      }
      case "content-flag":
        onContentFlag(event.launcherId);
        break;
    }
  });
  feed.onStatus((status) => sky.setSignalLost(status === "stale"));

  // Camera distance tracks the island's *current* extent so a sparse island
  // isn't stranded in the center of the view and a full one still fits frame.
  // Factors reproduce the original 120-block framing (radius 38 / height 17 at
  // spiral edge ~36.2); the spiral grows as sqrt(blocks) so the camera trails it.
  // MIN_CAM_DIST floors it so the first few blocks aren't framed from underwater.
  const MIN_CAM_DIST = 14;
  let camDist = MIN_CAM_DIST;
  function update(dt: number, t: number): void {
    // Reduced-motion: frame the full island statically (no per-block dolly, in
    // keeping with the fixed angle below). Otherwise ease toward the current
    // fill so a sparse island isn't stranded in the center of the view.
    const target = reducedMotion
      ? spiralRadius(MAX_BLOCK_SLOTS)
      : Math.max(MIN_CAM_DIST, spiralRadius(cursor.filled));
    camDist += (target - camDist) * (reducedMotion ? 1 : Math.min(1, dt * 0.8));

    const angle = (reducedMotion ? 0.8 : t * 0.015) + orbit.getOffset();
    const radius = camDist * 1.05 + (reducedMotion ? 0 : Math.sin(t * 0.06) * 3);
    camera.position.set(
      Math.cos(angle) * radius,
      camDist * 0.47 + (reducedMotion ? 0 : Math.sin(t * 0.04) * 1.2),
      Math.sin(angle) * radius
    );
    camera.lookAt(0, 3, 0);

    sky.update(dt, t, camera);
    clouds.update(t, camera, sky.cloudColor);
    water.update(t);
    extraUpdate(dt, t);
  }
  loop.start({ camera, postfx, update });

  return Object.assign(
    { renderer, camera, scene, sky, water },
    {
      setSproutHandler: (fn: typeof onSprout) => (onSprout = fn),
      setAmbientHandler: (fn: typeof onAmbientExtra) => (onAmbientExtra = fn),
      setBlockHandler: (fn: typeof onBlockExtra) => (onBlockExtra = fn),
      setReorgHandler: (fn: typeof onReorgExtra) => (onReorgExtra = fn),
      setContentFlagHandler: (fn: typeof onContentFlag) => (onContentFlag = fn),
      setUpdateHandler: (fn: typeof extraUpdate) => (extraUpdate = fn),
      isDragging: () => orbit.isDragging(),
      /** live: the OS setting can flip while the scene runs */
      isReducedMotion: () => reducedMotion,
      /** how far the spiral has populated (≤ MAX_BLOCK_SLOTS) */
      filledBlocks: () => cursor.filled,
    }
  );
}

export type MineRuntime = ReturnType<typeof startMine>;
