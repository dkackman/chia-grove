import type { Visualization } from "../types.js";
import { startMine } from "./mine.js";
import { Island } from "./island.js";

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
    const island = new Island(runtime.scene);
    const clock = { t: 0 };

    runtime.setBlockHandler((chunk) => island.startBlock(chunk));
    runtime.setSproutHandler((event, _chunk, _height) => {
      if (event.kind === "xch") island.placeGrass(event, clock.t);
      // CAT/NFT/DID added in later tasks
    });
    runtime.setReorgHandler((forkHeight) => island.clearAbove(forkHeight));

    const frameCallbacks: Array<() => void> = [];
    runtime.setUpdateHandler((_dt, t) => {
      clock.t = t;
      island.update(t);
      for (const fn of frameCallbacks) fn();
    });
    return {
      camera: runtime.camera,
      onFrame: (fn) => frameCallbacks.push(fn),
      isDragging: () => runtime.isDragging(),
      pickables: () => island.pickables(),
      metaFor: (object, instanceId) => island.metaFor(object, instanceId),
      setHovered: () => {},
    };
  },
};
