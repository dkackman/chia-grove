/** Global keyboard shortcuts for the app shell. */

export type Shortcut = { type: "theme"; index: number } | { type: "legend" };

interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  target: EventTarget | null;
}

/**
 * True when a key event belongs to a form control (the board's search box, the
 * scene selector) or editable content, so scene-level key handlers — these
 * shortcuts, and any theme's arrow-key navigation — should leave it alone.
 */
export function isFormFieldTarget(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null;
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName.toUpperCase();
  return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || el.isContentEditable === true;
}

/**
 * Map a keydown to a shell shortcut: `1`–`9` pick the nth scene (when one
 * exists), `L` toggles the legend. Ignored with Ctrl/Cmd/Alt held (browser and
 * OS shortcuts) or while typing in a form field. Pure.
 */
export function shortcutFor(e: KeyLike, themeCount: number): Shortcut | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (isFormFieldTarget(e.target)) return null;
  if (e.key === "l" || e.key === "L") return { type: "legend" };
  if (/^[1-9]$/.test(e.key)) {
    const index = Number(e.key) - 1;
    return index < themeCount ? { type: "theme", index } : null;
  }
  return null;
}
