# MintGarden NFT Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "view on mintgarden ↗" link to the NFT popup card for every NFT event, linking to `https://mintgarden.io/nfts/<nftId>` where `nftId` is the bech32m-encoded launcher ID.

**Architecture:** The server encodes `nftId` using `chia-wallet-sdk`'s `Address` class during classification and includes it in `SproutEvent`. The web detail card renders a second link when the field is present. No new npm dependencies are needed.

**Tech Stack:** TypeScript, `chia-wallet-sdk` (`Address`), vitest (tests), Three.js project (no framework).

---

## File Map

| File                              | Change                                                        |
| --------------------------------- | ------------------------------------------------------------- |
| `shared/src/index.ts`             | Add `nftId?: string` to `SproutEvent`                         |
| `server/src/classify/classify.ts` | Import `Address`; encode `launcherId` → `nftId` in NFT branch |
| `server/test/classify.test.ts`    | Assert `nftId` present and valid on NFT sprouts               |
| `web/src/net/demo.ts`             | Set `nftId` on synthetic NFT events from a stable pool        |
| `web/src/ui/detail-card.ts`       | Render MintGarden link when `event.nftId` is set              |

---

### Task 1: Add `nftId` to shared types and classify server

**Files:**

- Modify: `shared/src/index.ts`
- Modify: `server/src/classify/classify.ts`
- Modify: `server/test/classify.test.ts`

- [ ] **Step 1: Write the failing test**

Open `server/test/classify.test.ts`. Find the existing test `"nft mint flow yields nft sprout with mint flag and did sprout; launcher spends excluded"`. After the existing assertions at the bottom (around line 185–193), add assertions for `nftId`:

```ts
for (const s of nftSprouts) {
  expect(s.nftId).toMatch(/^nft1[ac-hj-np-z02-9]{58}$/); // bech32m, 62 chars total
}
```

The regex matches bech32 character set (alphanumeric minus `b`, `i`, `o`, `1` after the prefix).

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run server/test/classify.test.ts
```

Expected: FAIL — `nftId` is `undefined`, so `.toMatch()` throws.

- [ ] **Step 3: Add `nftId` to `SproutEvent` in shared types**

Open `shared/src/index.ts`. In `SproutEvent`, add the field after `launcherId`:

```ts
launcherId?: string; // NFT only, hex
nftId?: string;      // NFT only, bech32m launcher ID e.g. "nft1..."
imageUrl?: string;   // NFT only, first http(s) data URI
```

- [ ] **Step 4: Encode `nftId` in the classify server**

Open `server/src/classify/classify.ts`. Update the import line at the top:

```ts
import { Address, Clvm, Constants, type CoinSpend } from "chia-wallet-sdk";
```

In the NFT branch of `classifySpend` (the block that returns after `const nft = puzzle.parseNft(...)`), add `nftId` to the returned object:

```ts
return {
  ...base,
  kind: "nft",
  mint,
  launcherId: hex(nft.nft.info.launcherId),
  nftId: new Address(nft.nft.info.launcherId, "nft").encode(),
  ...(imageUrl ? { imageUrl } : {}),
};
```

`nft.nft.info.launcherId` is already a `Uint8Array` — no conversion needed before passing to `Address`.

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run server/test/classify.test.ts
```

Expected: all tests PASS, including the new `nftId` assertions.

- [ ] **Step 6: Run the full test suite to check for regressions**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add shared/src/index.ts server/src/classify/classify.ts server/test/classify.test.ts
git commit -m "feat: encode nftId (bech32m launcher ID) in SproutEvent"
```

---

### Task 2: Add `nftId` to demo mode synthetic events

**Files:**

- Modify: `web/src/net/demo.ts`

Demo mode synthesizes events entirely in the browser and doesn't go through the server's classify pipeline, so `nftId` must be set manually using a pool of pre-computed valid bech32m strings.

- [ ] **Step 1: Add the DEMO_NFT_IDS pool and wire it into the sprout function**

Open `web/src/net/demo.ts`. Add the pool constant after the existing `DEMO_CATS` array, then update the NFT branch of `sprout()`:

```ts
// After DEMO_CATS:
const DEMO_NFT_IDS = [
  "nft14w46h2at4w46h2at4w46h2at4w46h2at4w46h2at4w46h2at4w4skd8c6g",
  "nft1ehxumnwdehxumnwdehxumnwdehxumnwdehxumnwdehxumnwdehxscu9kvc",
  "nft1zgfpyysjzgfpyysjzgfpyysjzgfpyysjzgfpyysjzgfpyysjzgfq682z48",
  "nft1xs6rgdp5xs6rgdp5xs6rgdp5xs6rgdp5xs6rgdp5xs6rgdp5xs6qwu3rh2",
  "nft12et9v4jk2et9v4jk2et9v4jk2et9v4jk2et9v4jk2et9v4jk2etquh65s4",
  "nft10pu8s7rc0pu8s7rc0pu8s7rc0pu8s7rc0pu8s7rc0pu8s7rc0puqpqmyv9",
];

// Update the nft branch in sprout():
if (kind === "nft") {
  event.launcherId = randomHex(32);
  event.nftId = DEMO_NFT_IDS[Math.floor(Math.random() * DEMO_NFT_IDS.length)];
  if (Math.random() < 0.25) event.mint = true;
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/net/demo.ts
git commit -m "feat: add nftId to demo mode synthetic NFT events"
```

---

### Task 3: Add MintGarden link to the detail card

**Files:**

- Modify: `web/src/ui/detail-card.ts`

- [ ] **Step 1: Add the MintGarden link**

Open `web/src/ui/detail-card.ts`. After the block that appends `linkDiv` to `card` (currently around line 67), add:

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

The completed `showCard` function bottom should look like:

```ts
const linkDiv = el("div");
const a = document.createElement("a");
a.href = `https://www.spacescan.io/coin/0x${event.coinId}`;
a.target = "_blank";
a.rel = "noopener";
a.textContent = "view on spacescan ↗";
linkDiv.appendChild(a);
card.appendChild(linkDiv);

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

card.classList.add("visible");
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Verify manually in demo mode**

```bash
npm run dev:web
```

Open `http://localhost:5173/?demo=1` in a browser. Click on an NFT plant in the scene. The card should show two links: "view on spacescan ↗" and "view on mintgarden ↗". The mintgarden link should point to `https://mintgarden.io/nfts/nft1...`. Non-NFT cards (XCH, CAT, DID) should show only the spacescan link.

Note: in demo mode, `nftId` is generated from a simulated event. Check that the link is well-formed (starts with `nft1` and is 62 characters long).

- [ ] **Step 4: Commit**

```bash
git add web/src/ui/detail-card.ts
git commit -m "feat: add MintGarden link to NFT detail card"
```
