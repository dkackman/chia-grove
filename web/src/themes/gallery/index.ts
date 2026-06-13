import type { Visualization } from "../types.js";
import { startGallery } from "./gallery.js";

// touch devices browse by swipe; pointer devices by arrow keys
const coarsePointer =
  typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

export const gallery: Visualization = {
  id: "gallery",
  label: "gallery",
  legend: [
    ["sw-canvas", "framed piece — NFT mint"],
    ["sw-spotlight", "light warmth — netspace"],
    ["sw-breath", "light pulse — new block"],
    ["sw-reorg", "pieces removed — reorg"],
    ["sw-key", coarsePointer ? "swipe ← → — browse pieces" : "← → keys — browse pieces"],
  ],
  start: (canvas, feed) => startGallery(canvas, feed),
};
