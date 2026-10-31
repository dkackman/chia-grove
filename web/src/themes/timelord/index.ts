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
    ["sw-key tl-key-travel", "↑ ↓ / PgUp PgDn / wheel / drag ↕ — travel through time"],
    ["sw-key tl-key-live", "Esc / End / double-click — return to live"],
    ["sw-key tl-key-click", "click a crystal — jump to its block"],
  ],
  start: (canvas, feed) => startTimelord(canvas, feed),
};
