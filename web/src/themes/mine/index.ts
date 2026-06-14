import type { Visualization } from "../types.js";
import { startMine } from "./mine.js";

export const mine: Visualization = {
  id: "mine",
  label: "mineworld",
  legend: [
    ["sw-land", "land — XCH spend (the island)"],
    ["sw-block", "block — CAT (material + color = asset)"],
    ["sw-painting", "painting — NFT (clickable)"],
    ["sw-villager", "villager — DID"],
    ["sw-beacon", "beacon — mint"],
    ["sw-torch", "torches — mempool"],
    ["sw-suncycle", "sun / moon — netspace + time"],
    ["sw-creeper", "creeper — reorg"],
  ],
  start(canvas, feed) {
    const runtime = startMine(canvas, feed);
    const frameCallbacks: Array<() => void> = [];
    runtime.setUpdateHandler((_dt, _t) => {
      for (const fn of frameCallbacks) fn();
    });
    return {
      camera: runtime.camera,
      onFrame: (fn) => frameCallbacks.push(fn),
      isDragging: () => runtime.isDragging(),
      pickables: () => [],
      metaFor: () => null,
      setHovered: () => {},
    };
  },
};
