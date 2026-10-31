import * as THREE from "three";
import type { BlockEvent, GroveEvent, SproutEvent } from "@grove/shared";
import type { GroveFeed } from "../../net/feed.js";
import { type XZ } from "../shared/util.js";
import { createRenderLoop } from "../shared/render-loop.js";
import { createGround } from "./ground.js";
import { blockPosition } from "./layout.js";
import { BlockSlots, isReplayed } from "./blocks.js";
import { Lantern } from "./lantern.js";
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
// the handler setters (index.ts relies on them).
export function startGrove(canvas: HTMLCanvasElement, feed: GroveFeed) {
  const loop = createRenderLoop(canvas);
  const { renderer } = loop;
  let reducedMotion = loop.reducedMotion;
  const motionListeners: Array<(reduced: boolean) => void> = [];
  loop.onReducedMotionChange((reduced) => {
    reducedMotion = reduced;
    sky.setReducedMotion(reduced);
    ground.setReducedMotion(reduced);
    lantern.setReducedMotion(reduced);
    for (const fn of motionListeners) fn(reduced);
  });

  const orbit = createOrbitControl(canvas);

  const scene = new THREE.Scene();
  scene.background = nightSkyGradient();
  scene.fog = new THREE.FogExp2(COLORS.fog, 0.016);

  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 500);

  scene.add(new THREE.HemisphereLight(0x23402e, 0x050a06, 0.7));

  const sky = createSky(scene, reducedMotion);
  const ground = createGround(scene, reducedMotion);
  const lantern = new Lantern(scene);
  lantern.setReducedMotion(reducedMotion);

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
  /** `live` is false for replayed history (snapshot): skip the fanfare. */
  let onBlockExtra = (_pos: XZ, _event: BlockEvent, _live: boolean) => {};
  let onReorgExtra = (_forkHeight: number) => {};
  let extraUpdate = (_dt: number, _t: number) => {};

  const slots = new BlockSlots(MAX_BLOCK_SLOTS);
  let currentBlockPos = blockPosition(0);

  feed.onEvent((event: GroveEvent) => {
    switch (event.type) {
      case "block": {
        currentBlockPos = blockPosition(slots.place(event.height, event.timestamp));
        const live = !isReplayed(event.timestamp, Date.now() / 1000);
        lantern.moveTo(currentBlockPos, event.timestamp);
        if (live) {
          ground.ripple(currentBlockPos.x, currentBlockPos.z);
          sky.pulse();
        }
        onBlockExtra(currentBlockPos, event, live);
        break;
      }
      case "sprout":
        onSprout(event, currentBlockPos);
        break;
      case "ambient":
        sky.setNetspace(event.netspace);
        onAmbientExtra(event.mempoolSize, event.mempoolCost);
        break;
      case "reorg": {
        // ember ripple from the newest surviving block (the fork point)
        slots.rewind(event.forkHeight);
        const slot = slots.current();
        if (slot >= 0) {
          currentBlockPos = blockPosition(slot);
          lantern.moveTo(currentBlockPos, slots.currentTimestamp());
        } else {
          currentBlockPos = blockPosition(0);
          lantern.hide();
        }
        ground.ripple(currentBlockPos.x, currentBlockPos.z, 1);
        onReorgExtra(event.forkHeight);
        break;
      }
    }
  });

  feed.onStatus((status) => sky.setSignalLost(status === "stale"));

  function update(dt: number, t: number): void {
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
    lantern.update(t, Date.now() / 1000);
    extraUpdate(dt, t);
  }
  loop.start({ camera, postfx, update });

  // hooks consumed by index.ts (kept on the handle object via closure setters).
  // A plain literal, not Object.assign, so the reducedMotion getter stays live.
  return {
    renderer,
    camera,
    scene,
    setSproutHandler: (fn: typeof onSprout) => (onSprout = fn),
    setAmbientHandler: (fn: typeof onAmbientExtra) => (onAmbientExtra = fn),
    setBlockHandler: (fn: typeof onBlockExtra) => (onBlockExtra = fn),
    setReorgHandler: (fn: typeof onReorgExtra) => (onReorgExtra = fn),
    setUpdateHandler: (fn: typeof extraUpdate) => (extraUpdate = fn),
    isDragging: () => orbit.isDragging(),
    /** live: follows the OS setting */
    get reducedMotion() {
      return reducedMotion;
    },
    onReducedMotionChange: (fn: (reduced: boolean) => void) => void motionListeners.push(fn),
  };
}

export type GroveRuntime = ReturnType<typeof startGrove>;
