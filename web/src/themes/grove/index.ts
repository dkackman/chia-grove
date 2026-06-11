import type { Visualization } from "../types.js";
import { startGrove } from "./grove.js";
import { FloraSystem } from "./flora.js";
import { Fireflies } from "./fireflies.js";

export const grove: Visualization = {
  id: "grove",
  label: "grove",
  legend: [
    ["sw-grass", "grass — XCH spend (taller = larger)"],
    ["sw-cat", "mushroom — CAT transfer (color = asset)"],
    ["sw-nft", "bloom — NFT (bursts on mint)"],
    ["sw-did", "wisp — DID activity"],
    ["sw-firefly", "fireflies — mempool"],
    ["sw-moon", "moonlight — netspace"],
    ["sw-ripple", "ripple — new block"],
  ],
  start(canvas, feed) {
    const runtime = startGrove(canvas, feed);
    const flora = new FloraSystem(runtime.scene);
    const clockRef = { t: 0 };
    runtime.setSproutHandler((event, blockPos) => flora.plant(event, blockPos, clockRef.t));
    const fireflies = new Fireflies(runtime.scene, runtime.reducedMotion ? 150 : 400);
    runtime.setAmbientHandler((mempoolSize, mempoolCost) =>
      fireflies.setMempool(mempoolSize, mempoolCost)
    );
    runtime.setBlockHandler((pos) => {
      fireflies.diveTo(pos, clockRef.t);
      if (!runtime.reducedMotion) flora.gust(clockRef.t);
    });
    runtime.setReorgHandler(() => {
      flora.gust(clockRef.t);
      fireflies.scatter();
    });
    const frameCallbacks: Array<() => void> = [];
    runtime.setUpdateHandler((dt, t) => {
      clockRef.t = t;
      flora.update(t, dt);
      fireflies.update(t);
      for (const fn of frameCallbacks) fn();
    });
    return {
      camera: runtime.camera,
      onFrame: (fn) => frameCallbacks.push(fn),
      pickables: () => flora.pickables(),
      metaFor: (object, instanceId) => flora.metaFor(object, instanceId),
      setHovered: (object, instanceId) => flora.setHovered(object, instanceId),
    };
  },
};
