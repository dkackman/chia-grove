import type { SproutEvent } from "@grove/shared";

/**
 * Any NFT that carries a usable image can hang. Duplicates are prevented by
 * deduping on launcherId in the piece pool (a repeat event pings the existing
 * frame instead of hanging again), so the mint flag is no longer the filter.
 */
export function shouldHang(event: SproutEvent): boolean {
  return event.kind === "nft" && !!event.imageUrl;
}
