import type { Visualization } from "./types.js";

/**
 * A registered theme: just enough to list it (scene picker, 1–6 shortcuts) and
 * resolve it, with the scene itself behind `load()`. Only one theme runs per
 * page load (switching reloads), so each is its own dynamic-import chunk —
 * a visitor downloads the scene they're looking at, not all six.
 */
export interface ThemeEntry {
  id: string;
  label: string;
  load(): Promise<Visualization>;
}

export const THEMES: readonly ThemeEntry[] = [
  { id: "grove", label: "grove", load: () => import("./grove/index.js").then((m) => m.grove) },
  { id: "farm", label: "farm", load: () => import("./farm/index.js").then((m) => m.farm) },
  {
    id: "gallery",
    label: "gallery",
    load: () => import("./gallery/index.js").then((m) => m.gallery),
  },
  { id: "mine", label: "mineworld", load: () => import("./mine/index.js").then((m) => m.mine) },
  {
    id: "board",
    label: "The Big Board",
    load: () => import("./board/index.js").then((m) => m.board),
  },
  {
    id: "timelord",
    label: "timelord",
    load: () => import("./timelord/index.js").then((m) => m.timelord),
  },
];
export const THEME_STORAGE_KEY = "grove.theme";

/** Pure (no DOM access) so it's unit-testable: URL param wins, then stored, then grove. */
export function resolveTheme(search: string, stored: string | null): ThemeEntry {
  const requested = new URLSearchParams(search).get("theme") ?? stored;
  return THEMES.find((theme) => theme.id === requested) ?? THEMES[0];
}

/** Persist + reload; the snapshot replay repopulates the new scene. */
export function switchTheme(id: string): void {
  localStorage.setItem(THEME_STORAGE_KEY, id);
  const url = new URL(location.href);
  url.searchParams.set("theme", id);
  location.assign(url.toString());
}
