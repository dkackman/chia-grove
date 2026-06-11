import { GroveFeed } from "./net/feed.js";

const status = document.getElementById("status") as HTMLDivElement;

const feed = new GroveFeed();
feed.onStatus((s) => {
  status.hidden = s === "live";
  status.textContent =
    s === "demo" ? "demo" : s === "stale" ? "signal lost" : s === "connecting" ? "connecting" : "";
});
feed.onEvent((event) => console.log(event));
feed.start();
