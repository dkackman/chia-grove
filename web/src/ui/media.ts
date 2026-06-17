import type { SproutEvent } from "@grove/shared";
export { mediaKind, type MediaKind } from "@grove/shared";

/**
 * Resolve the loadable src for a sprout's art, or null if it has none.
 * Demo/offline events inline a data: URI; live events are addressed by NFT
 * launcher id through the same-origin image proxy (no open URL ever crosses the
 * wire). Keying on launcherId — stable across every spend of the NFT — keeps the
 * /img?nft= URL cacheable, unlike the per-spend coinId.
 */
export function mediaSrc(event: SproutEvent): string | null {
  if (event.imageUrl) return event.imageUrl; // data: (demo)
  if (event.mediaKind && event.launcherId) return `/img?nft=${event.launcherId}`;
  return null;
}
