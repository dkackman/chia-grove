import type { SproutEvent } from "@grove/shared";

/**
 * Any NFT that carries a usable image can hang. Duplicates are prevented by
 * deduping on launcherId in the piece pool (a repeat event pings the existing
 * frame instead of hanging again), so the mint flag is no longer the filter.
 */
export function shouldHang(event: SproutEvent): boolean {
  return event.kind === "nft" && !!event.mediaKind;
}

/**
 * The wall label a hung piece wears: a fresh mint is a "new acquisition"; any
 * other spend of an NFT (a transfer or sale) gets the gallery's red "sold" dot.
 */
export function hangTag(event: SproutEvent): "acquisition" | "sold" {
  return event.mint ? "acquisition" : "sold";
}
