import { GroveFeed } from "./net/feed.js";
import { startGrove } from "./scene/grove.js";
import { FloraSystem } from "./scene/flora.js";
import { Fireflies } from "./scene/fireflies.js";
import { attachPicker } from "./ui/picker.js";
import { BlockConsole } from "./ui/console.js";
import { initLegend } from "./ui/legend.js";

const canvas = document.getElementById("grove") as HTMLCanvasElement;
const status = document.getElementById("status") as HTMLDivElement;

initLegend();
const blockConsole = new BlockConsole(
  document.getElementById("console") as HTMLDivElement
);

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
const fireflies = new Fireflies(grove.scene, grove.reducedMotion ? 150 : 400);
grove.setAmbientHandler((mempoolSize, mempoolCost) =>
  fireflies.setMempool(mempoolSize, mempoolCost)
);
grove.setBlockHandler((pos) => fireflies.diveTo(pos, clockRef.t));
grove.setReorgHandler(() => {
  flora.gust(clockRef.t);
  fireflies.scatter();
});
const frameCallbacks: Array<() => void> = [];
grove.setUpdateHandler((dt, t) => {
  clockRef.t = t;
  flora.update(t, dt);
  fireflies.update(t);
  for (const fn of frameCallbacks) fn();
});
attachPicker(canvas, grove.camera, flora, (fn) => frameCallbacks.push(fn));
feed.onEvent((event) => blockConsole.handle(event));
feed.start();
