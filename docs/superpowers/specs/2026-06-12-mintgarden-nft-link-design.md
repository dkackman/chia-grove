---
name: mintgarden-nft-link
description: Add MintGarden link to NFT popup cards using server-side bech32m encoding of launcher ID
metadata:
  type: project
---

# MintGarden NFT Link

## Goal

Show a "view on mintgarden ↗" link on the popup detail card for every NFT event that has a launcher ID, linking to `https://mintgarden.io/nfts/<nftId>` where `nftId` is the bech32m-encoded launcher ID (e.g. `nft1...`).

## NFT ID derivation

A Chia NFT ID (`nft1...`) is the bech32m encoding of the 32-byte launcher coin ID with the human-readable prefix `"nft"`. The `chia-wallet-sdk` already exposes this via `new Address(launcherIdBytes, "nft").encode()`, so no new dependencies are needed anywhere.

## Changes

### 1. `shared/src/index.ts`

Add one optional field to `SproutEvent`:

```ts
nftId?: string; // bech32m launcher ID, e.g. "nft1..." — NFT only
```

### 2. `server/src/classify/classify.ts`

In `classifySpend`, inside the NFT branch, encode the launcher ID and include it in the returned event:

```ts
import { Address, Clvm, Constants, type CoinSpend } from "chia-wallet-sdk";

// inside the nft branch:
return {
  ...base,
  kind: "nft",
  mint,
  launcherId: hex(nft.nft.info.launcherId),
  nftId: new Address(nft.nft.info.launcherId, "nft").encode(),
  ...(imageUrl ? { imageUrl } : {}),
};
```

`nft.nft.info.launcherId` is already a `Uint8Array` — no conversion needed.

### 3. `web/src/ui/detail-card.ts`

When `event.nftId` is present, append a separate `<div>` containing the MintGarden anchor directly to `card`, after the existing spacescan `linkDiv`. Each card row is its own `<div>` child of `card` — this keeps the MintGarden link on its own line consistent with the existing layout.

```ts
if (event.nftId) {
  const mgDiv = el("div");
  const mg = document.createElement("a");
  mg.href = `https://mintgarden.io/nfts/${event.nftId}`;
  mg.target = "_blank";
  mg.rel = "noopener";
  mg.textContent = "view on mintgarden ↗";
  mgDiv.appendChild(mg);
  card.appendChild(mgDiv);
}
```

## Scope

- All NFT events with a `launcherId` get the link (minted and transferred).
- No new npm dependencies.
- No changes to the WebSocket protocol version or snapshot replay logic — `nftId` is additive and optional.
