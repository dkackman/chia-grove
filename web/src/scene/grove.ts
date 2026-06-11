import * as THREE from "three";
import type { GroveEvent, SproutEvent } from "@grove/shared";
import type { GroveFeed } from "../net/feed.js";
import { createGround } from "./ground.js";
import { blockPosition, type XZ } from "./layout.js";
import { COLORS } from "./palette.js";
import { createSky } from "./sky.js";

/** Spiral slots wrap so the grove never grows beyond the meadow. */
const MAX_BLOCK_SLOTS = 300;

// NOTE: no explicit return-type annotation — the inferred type must include
// the handler setters added via Object.assign (later tasks rely on them).
export function startGrove(canvas: HTMLCanvasElement, feed: GroveFeed) {
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.setSize(innerWidth, innerHeight);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.background);
  scene.fog = new THREE.FogExp2(COLORS.fog, 0.016);

  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 500);

  scene.add(new THREE.HemisphereLight(0x23402e, 0x050a06, 0.7));

  const sky = createSky(scene);
  const ground = createGround(scene);

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

  const clock = new THREE.Clock();
  function frame(): void {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;

    const angle = reducedMotion ? 0.8 : t * 0.02;
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
    renderer.render(scene, camera);
  }
  frame();

  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
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
      reducedMotion,
    }
  );
}

export type GroveRuntime = ReturnType<typeof startGrove>;
