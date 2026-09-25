import type { Visualization } from "../types.js";
import { startTimelord } from "./timelord.js";

export const timelord: Visualization = {
  id: "timelord",
  label: "timelord",
  legend: [
    ["sw-thread", "thread — the 3 braided VDF chains"],
    ["sw-crystal", "crystal — block (size = spends, teal→amber = fees)"],
    ["sw-coin", "coin — XCH spend (silver→green→gold = amount)"],
    ["sw-gem", "gem — CAT transfer (color = asset)"],
    ["sw-holo", "holo card — NFT (gold foil = mint)"],
    ["sw-halo", "halo — DID activity"],
    ["sw-vortex", "vortex — mempool"],
    ["sw-dial", "dial — time since last block"],
    ["sw-stars", "stars — netspace"],
  ],
  start: (canvas, feed) => startTimelord(canvas, feed),
};
