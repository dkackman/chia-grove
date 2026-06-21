import type { Visualization } from "../types.js";
import { startBoard } from "./board.js";

export const board: Visualization = {
  id: "board",
  label: "The Big Board",
  legend: [
    ["sw-flap", "row — a coin spend, newest on top"],
    ["sw-mint", "★ NEW — NFT mint"],
    ["sw-gauge", "header bar — mempool fill"],
    ["sw-tile", "side panel — latest NFT art"],
    ["sw-key", "double-click — toggle clatter"],
  ],
  start: (canvas, feed) => startBoard(canvas, feed),
};
