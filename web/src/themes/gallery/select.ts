import type { SproutEvent } from "@grove/shared";

/** Only freshly-minted NFTs that carry a usable image hang on the wall. */
export function shouldHang(event: SproutEvent): boolean {
  return event.kind === "nft" && event.mint === true && !!event.imageUrl;
}
