import type { Visualization } from "./types.js";
import { grove } from "./grove/index.js";
import { farm } from "./farm/index.js";
import { gallery } from "./gallery/index.js";

export const THEMES: readonly Visualization[] = [grove, farm, gallery];
export const THEME_STORAGE_KEY = "grove.theme";

/** Pure (no DOM access) so it's unit-testable: URL param wins, then stored, then grove. */
export function resolveTheme(search: string, stored: string | null): Visualization {
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
