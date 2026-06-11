import { GroveFeed } from "./net/feed.js";
import { startGrove } from "./scene/grove.js";

const canvas = document.getElementById("grove") as HTMLCanvasElement;
const status = document.getElementById("status") as HTMLDivElement;

const feed = new GroveFeed();
feed.onStatus((s) => {
  status.hidden = s === "live";
  status.textContent =
    s === "demo" ? "demo" : s === "stale" ? "signal lost" : s === "connecting" ? "connecting" : "";
});

startGrove(canvas, feed);
feed.start();
