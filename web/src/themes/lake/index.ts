import type { Visualization } from "../types.js";
import { startLake } from "./lake.js";

export const lake: Visualization = {
  id: "lake",
  label: "lake",
  legend: [
    ["sw-fish", "fish — XCH spend (size = amount)"],
    ["sw-school", "school — CAT (color = asset)"],
    ["sw-jelly", "jellyfish — NFT (clickable)"],
    ["sw-turtle", "turtle — DID"],
    ["sw-ripple", "ripple — new block"],
    ["sw-bubble", "bubbles — mempool"],
    ["sw-shaft", "light shafts — netspace"],
    ["sw-reorg", "strike — reorg"],
  ],
  start(canvas, feed) {
    const runtime = startLake(canvas, feed);
    const frameCallbacks: Array<() => void> = [];
    runtime.setUpdateHandler(() => {
      for (const fn of frameCallbacks) fn();
    });
    return {
      camera: runtime.camera,
      onFrame: (fn) => frameCallbacks.push(fn),
      isDragging: () => runtime.isDragging(),
    };
  },
};
