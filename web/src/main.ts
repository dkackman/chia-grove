import { GroveFeed } from "./net/feed.js";
import { startGrove } from "./scene/grove.js";
import { FloraSystem } from "./scene/flora.js";

const canvas = document.getElementById("grove") as HTMLCanvasElement;
const status = document.getElementById("status") as HTMLDivElement;

const feed = new GroveFeed();
feed.onStatus((s) => {
  status.hidden = s === "live";
  status.textContent =
    s === "demo" ? "demo" : s === "stale" ? "signal lost" : s === "connecting" ? "connecting" : "";
});

const grove = startGrove(canvas, feed);
const flora = new FloraSystem(grove.scene);
const clockRef = { t: 0 };
grove.setSproutHandler((event, blockPos) => flora.plant(event, blockPos, clockRef.t));
grove.setReorgHandler(() => flora.gust(clockRef.t));
grove.setUpdateHandler((_dt, t) => {
  clockRef.t = t;
  flora.update(t);
});
feed.start();
