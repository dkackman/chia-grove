import type { SproutEvent } from "@grove/shared";
import type { MediaKind } from "@grove/shared";
export { mediaKind, type MediaKind } from "@grove/shared";

/**
 * The next element type to try when the current one fails to load or decode, or
 * null once the chain is exhausted. `mediaKind` is only a hint (it guesses from
 * the URL extension, defaulting to "image"), so an extensionless IPFS video is
 * first guessed wrong; walking image → video → audio lets the render paths
 * self-correct on the error event instead of showing a black frame.
 */
export function escalateMediaKind(current: MediaKind): MediaKind | null {
  if (current === "image") return "video";
  if (current === "video") return "audio";
  return null;
}

/**
 * Resolve the loadable src for a sprout's art, or null if it has none. Returns
 * null for blocked NFTs so no surface can fetch the bytes. Demo/offline events
 * inline a data: URI; live events are addressed by launcher id through the
 * same-origin proxy (no open URL crosses the wire; launcherId keeps /img cacheable).
 */
export function mediaSrc(event: SproutEvent): string | null {
  if (event.mediaFilter === "blocked") return null;
  if (event.dataUri) return event.dataUri; // data: (demo)
  if (event.mediaKind && event.launcherId) return `/img?nft=${event.launcherId}`;
  return null;
}

/**
 * The single source of truth for how an NFT's media should be presented. Every
 * render surface (detail card, gallery walls, mine paintings) routes through
 * this, so content filtering is uniform by construction — a new surface that
 * calls resolveMedia inherits it automatically.
 *
 * - blocked   → placeholder, never any src (bytes unreachable).
 * - sensitive → blur (DOM blurs the element; WebGL shows a placeholder texture).
 * - otherwise → art if a src resolves, else none.
 */
export type MediaDisposition =
  | { render: "art"; src: string; kind: MediaKind }
  | { render: "blur"; src: string; kind: MediaKind }
  | { render: "placeholder" }
  | { render: "none" };

export function resolveMedia(event: SproutEvent): MediaDisposition {
  if (event.mediaFilter === "blocked") return { render: "placeholder" };
  const src = mediaSrc(event);
  if (!src) return { render: "none" };
  const kind = event.mediaKind ?? "image";
  return { render: event.mediaFilter === "sensitive" ? "blur" : "art", src, kind };
}
