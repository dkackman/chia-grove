export interface CardLink {
  label: string;
  href: string;
}

/**
 * Spacescan explorer link for a spend card. An aggregated row (several spends
 * folded into one block-wide total — see CardMeta) points at the block
 * instead of a single coin, since the total doesn't describe any one coin's id.
 */
export function spacescanLink(event: { coinId: string; height: number }, aggregateCount = 1): CardLink {
  return aggregateCount > 1
    ? { label: "view block on spacescan ↗", href: `https://www.spacescan.io/block/${event.height}` }
    : { label: "view on spacescan ↗", href: `https://www.spacescan.io/coin/0x${event.coinId}` };
}

/** MintGarden NFT page link, or undefined for a non-NFT event / one with no nftId. */
export function mintgardenLink(nftId: string | undefined): CardLink | undefined {
  return nftId ? { label: "view on mintgarden ↗", href: `https://mintgarden.io/nfts/${nftId}` } : undefined;
}
