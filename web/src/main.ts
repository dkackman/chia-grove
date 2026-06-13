import { GroveFeed } from "./net/feed.js";
import { resolveTheme, THEME_STORAGE_KEY } from "./themes/index.js";
import { attachPicker } from "./ui/picker.js";
import { BlockConsole } from "./ui/console.js";
import { initLegend } from "./ui/legend.js";

const canvas = document.getElementById("grove") as HTMLCanvasElement;
const status = document.getElementById("status") as HTMLDivElement;

const theme = resolveTheme(location.search, localStorage.getItem(THEME_STORAGE_KEY));
initLegend(theme);
const blockConsole = new BlockConsole(document.getElementById("console") as HTMLDivElement);

const feed = new GroveFeed();
feed.onStatus((s) => {
  status.hidden = s === "live";
  status.textContent =
    s === "demo" ? "demo" : s === "stale" ? "signal lost" : s === "connecting" ? "connecting" : "";
});

const handle = theme.start(canvas, feed);
if (!handle.selfManagedInput) attachPicker(canvas, handle);
feed.onEvent((event) => blockConsole.handle(event));
feed.start();
