import type { Visualization } from "../types.js";
import { startGallery } from "./gallery.js";

export const gallery: Visualization = {
  id: "gallery",
  label: "gallery",
  legend: [
    ["sw-canvas", "framed piece — NFT mint"],
    ["sw-spotlight", "light warmth — netspace"],
    ["sw-breath", "light pulse — new block"],
    ["sw-reorg", "pieces removed — reorg"],
  ],
  start: (canvas, feed) => startGallery(canvas, feed),
};
