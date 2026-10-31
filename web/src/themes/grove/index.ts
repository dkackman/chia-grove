import type { Visualization } from "../types.js";
import { Motes } from "../shared/motes.js";
import { startGrove } from "./grove.js";
import { FloraSystem } from "./flora.js";
import { Fireflies } from "./fireflies.js";

export const grove: Visualization = {
  id: "grove",
  label: "grove",
  legend: [
    ["sw-grass", "grass — XCH spend (taller = larger)"],
    ["sw-cat", "mushroom — CAT transfer (color = asset)"],
    ["sw-nft", "bloom — NFT (ringed, brighter = mint)"],
    ["sw-did", "wisp — DID activity"],
    ["sw-firefly", "fireflies — mempool"],
    ["sw-moon", "moonlight — netspace"],
    ["sw-ripple", "ripple — new block"],
    ["sw-moon", "lantern — newest block (dims while waiting)"],
    ["sw-reorg", "ember ripple — reorg (removed blocks wither)"],
  ],
  start(canvas, feed) {
    const runtime = startGrove(canvas, feed);
    const flora = new FloraSystem(runtime.scene, runtime.reducedMotion);
    const clockRef = { t: 0 };
    runtime.setSproutHandler((event, blockPos) => flora.plant(event, blockPos, clockRef.t));
    const fireflies = new Fireflies(runtime.scene, runtime.reducedMotion ? 150 : 400);
    fireflies.setReducedMotion(runtime.reducedMotion);
    runtime.onReducedMotionChange((reduced) => {
      flora.setReducedMotion(reduced);
      fireflies.setReducedMotion(reduced);
    });
    // faint luminescent spores drifting on the night breeze — atmosphere only
    const motes = new Motes(runtime.scene, {
      count: runtime.reducedMotion ? 35 : 100,
      color: 0xbfeccb,
      size: 0.14,
      opacity: 0.2,
      radius: 48,
      minY: 0.6,
      maxY: 12,
      windX: 1,
      windZ: 0.6,
      windSpeed: 0.5,
      gust: 0.45,
      rise: 0.22,
      motion: runtime.reducedMotion ? 0.12 : 1,
    });
    runtime.setAmbientHandler((mempoolSize, mempoolCost) =>
      fireflies.setMempool(mempoolSize, mempoolCost)
    );
    runtime.setBlockHandler((pos, event, live) => {
      // replayed history: no dives or gusts (the swarm size still follows)
      if (!live) return;
      fireflies.onBlock(pos, clockRef.t, event.mempoolIncluded, event.mempoolRemaining);
      if (!runtime.reducedMotion) flora.gust(clockRef.t);
    });
    runtime.setReorgHandler((forkHeight) => {
      flora.clearAbove(forkHeight);
      if (!runtime.reducedMotion) flora.gust(clockRef.t);
      fireflies.scatter(clockRef.t);
    });
    const frameCallbacks: Array<() => void> = [];
    runtime.setUpdateHandler((dt, t) => {
      clockRef.t = t;
      flora.update(t, dt);
      fireflies.update(t, dt);
      motes.update(t, dt);
      for (const fn of frameCallbacks) fn();
    });
    return {
      camera: runtime.camera,
      onFrame: (fn) => frameCallbacks.push(fn),
      isDragging: () => runtime.isDragging(),
      pickables: () => flora.pickables(),
      metaFor: (object, instanceId) => flora.metaFor(object, instanceId),
      setHovered: (object, instanceId) => flora.setHovered(object, instanceId),
    };
  },
};
