import { GroveFeed } from "./net/feed.js";
import { resolveTheme, switchTheme, THEMES, THEME_STORAGE_KEY } from "./themes/index.js";
import { attachPicker } from "./ui/picker.js";
import { BlockConsole } from "./ui/console.js";
import { initLegend } from "./ui/legend.js";
import { shortcutFor } from "./ui/shortcuts.js";

const canvas = document.getElementById("grove") as HTMLCanvasElement;
const status = document.getElementById("status") as HTMLDivElement;

const theme = resolveTheme(location.search, localStorage.getItem(THEME_STORAGE_KEY));
const legend = initLegend(theme);

// 1–6 switch scene, L toggles the legend (ignored while typing or with modifiers)
addEventListener("keydown", (e) => {
  if (e.defaultPrevented || e.repeat) return;
  const shortcut = shortcutFor(e, THEMES.length);
  if (!shortcut) return;
  if (shortcut.type === "legend") legend.toggle();
  else if (THEMES[shortcut.index].id !== theme.id) switchTheme(THEMES[shortcut.index].id);
  e.preventDefault();
});
const blockConsole = new BlockConsole(document.getElementById("console") as HTMLDivElement);

status.setAttribute("role", "status");
status.setAttribute("aria-live", "polite");
// The label is what's announced; the per-second countdown sits in an
// aria-hidden span so screen readers aren't read a number every second.
const statusLabel = document.createElement("span");
const statusRetry = document.createElement("span");
statusRetry.setAttribute("aria-hidden", "true");
status.append(statusLabel, statusRetry);
let retryTicker: number | undefined;

const feed = new GroveFeed();
feed.onStatus((s, info) => {
  status.hidden = s === "live";
  const label =
    s === "demo" ? "demo" : s === "stale" ? "signal lost" : s === "connecting" ? "connecting" : "";
  if (statusLabel.textContent !== label) statusLabel.textContent = label;
  clearInterval(retryTicker);
  statusRetry.textContent = "";
  if (s !== "stale") return;
  const tick = () => {
    const secs = info.retryAt === undefined ? 0 : Math.ceil((info.retryAt - Date.now()) / 1000);
    statusRetry.textContent = secs > 0 ? ` · retry in ${secs}s` : " · reconnecting…";
  };
  tick();
  if (info.retryAt !== undefined) retryTicker = window.setInterval(tick, 1000);
});

const handle = theme.start(canvas, feed);
if (!handle.selfManagedInput) attachPicker(canvas, handle);
feed.onEvent((event) => blockConsole.handle(event));
feed.start();
