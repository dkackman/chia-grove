import * as THREE from "three";
import type { GroveEvent, SproutEvent } from "@grove/shared";
import type { GroveFeed } from "../../net/feed.js";
import type { XZ } from "../shared/util.js";
import { createOrbitControl } from "../shared/orbit.js";
import { createPostFx } from "../shared/postfx.js";
import { chunkPosition } from "./layout.js";
import { createMineSky } from "./sky.js";
import { createWater } from "./water.js";

const MAX_BLOCK_SLOTS = 120;

export function startMine(canvas: HTMLCanvasElement, feed: GroveFeed) {
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.setSize(innerWidth, innerHeight);

  const orbit = createOrbitControl(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 600);

  scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x3a3326, 0.4));
  const sky = createMineSky(scene, reducedMotion);
  const water = createWater(scene);

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
  let onBlockExtra = (_chunk: XZ, _index: number) => {};
  let onReorgExtra = (_forkHeight: number) => {};
  let extraUpdate = (_dt: number, _t: number) => {};

  let blockIndex = 0;
  let currentChunk = chunkPosition(0);

  feed.onEvent((event: GroveEvent) => {
    switch (event.type) {
      case "block": {
        const index = blockIndex;
        currentChunk = chunkPosition(index);
        blockIndex = (index + 1) % MAX_BLOCK_SLOTS;
        onBlockExtra(currentChunk, index);
        break;
      }
      case "sprout":
        onSprout(event, currentChunk, event.height);
        break;
      case "ambient":
        sky.setNetspace(event.netspace);
        onAmbientExtra(event.mempoolSize);
        break;
      case "reorg":
        onReorgExtra(event.forkHeight);
        break;
    }
  });
  feed.onStatus((status) => sky.setSignalLost(status === "stale"));

  const timer = new THREE.Timer();
  function frame(): void {
    requestAnimationFrame(frame);
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.1);
    const t = timer.getElapsed();

    const angle = (reducedMotion ? 0.8 : t * 0.015) + orbit.getOffset();
    const radius = 38 + (reducedMotion ? 0 : Math.sin(t * 0.06) * 3);
    camera.position.set(
      Math.cos(angle) * radius,
      17 + Math.sin(t * 0.04) * 1.2,
      Math.sin(angle) * radius
    );
    camera.lookAt(0, 3, 0);

    sky.update(dt, t);
    water.update(t);
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

  return Object.assign(
    { renderer, camera, scene, sky },
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

export type MineRuntime = ReturnType<typeof startMine>;
