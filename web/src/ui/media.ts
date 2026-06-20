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
 * Resolve the loadable src for a sprout's art, or null if it has none.
 * Demo/offline events inline a data: URI; live events are addressed by NFT
 * launcher id through the same-origin image proxy (no open URL ever crosses the
 * wire). Keying on launcherId — stable across every spend of the NFT — keeps the
 * /img?nft= URL cacheable, unlike the per-spend coinId.
 */
export function mediaSrc(event: SproutEvent): string | null {
  if (event.dataUri) return event.dataUri; // data: (demo)
  if (event.mediaKind && event.launcherId) return `/img?nft=${event.launcherId}`;
  return null;
}
