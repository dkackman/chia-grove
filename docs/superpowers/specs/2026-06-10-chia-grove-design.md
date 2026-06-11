# Chia Grove — Design

**Date:** 2026-06-10
**Status:** Approved

## Overview

Chia Grove is an ambient, web-based 3D art piece that visualizes live Chia mainnet activity as a nocturnal meadow. Every block sprouts luminous flora; the kind of flora is determined by parsing each spend with the chia-wallet-sdk. It is a living painting first — beautiful with zero interaction — with light hover/click detail as the only interactive layer. It also serves as a real-world consumer example of the `chia-wallet-sdk` napi (Node.js) binding.

**Experience type:** ambient art piece (screensaver-like; suitable as lobby screen, stream overlay, community showpiece).

## Goals

- Visually compelling, unconventional blockchain visualization (no graphs, no hash dumps).
- Driven by real chain data at coin-spend granularity, classified by asset type via the SDK.
- Cheap to host: one small VPS (DigitalOcean droplet, ~$6–12/mo), no database, no full node.
- Showcase the napi binding of chia-wallet-sdk end to end in TypeScript.

## Non-goals

- Not a block explorer or dashboard. (A small legend inset and a scrolling per-block log are in scope; aggregate stats dashboards are not.)
- No user accounts, no wallets, no transaction submission.
- No historical archive — the grove shows recent activity only (~last 30 blocks backfilled, in-memory).

## Key decisions

| Decision                 | Choice                                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Binding / server runtime | `chia-wallet-sdk` napi package, Node.js 20+, TypeScript throughout                                               |
| Data source (v1)         | coinset.org RPC via SDK `RpcClient`, polling; direct peer connections are phase 2                                |
| Data depth               | Asset-aware: per-spend classification into XCH / CAT / NFT / DID                                                 |
| Interaction              | Hover highlight + click detail card (NFT image shown, link to spacescan.io); slow auto-drifting camera otherwise |
| Spatial layout           | Phyllotaxis (golden-angle) spiral filling outward from a center clearing                                         |
| Project location         | Standalone repo (`chia-grove`), consuming the published npm package                                              |

## Architecture

One Node process on the droplet; static frontend served by the same process.

```
┌────────────────────────── Node process ──────────────────────────┐
│  ingest/            classify/              web/                  │
│  ChainSource  ──►   spend parser    ──►    Fastify + WebSocket   │
│  (CoinsetPoller)    (Puzzle.parse*)        ring buffer + fan-out │
└──────────────────────────────────────────────────────────────────┘
        │ HTTPS                                    │ WS + static
   coinset.org RPC                            browsers (Three.js)
```

### Module: ingest (`server/ingest/`)

- `ChainSource` interface: emits `newBlock(record, spends, additionsRemovals)` and `ambient(state)` events. The interface is the seam where a `PeerSource` (DNS-introducer peer autodiscovery, wallet-protocol push) slots in during phase 2 without touching downstream modules.
- `CoinsetPoller` implementation:
  - Polls `RpcClient.getBlockchainState()` every 3 s (block time averages ~19 s).
  - On peak advance, walks from last-seen height to the new peak (handles multi-block jumps), fetching `getBlockSpends(headerHash)` and `getAdditionsAndRemovals(headerHash)` per block.
  - Emits `ambient` (mempool size, mempool cost, netspace, peak height) on every successful poll.

### Module: classify (`server/classify/`)

Pure function from block data to **grove events** (the only logic-dense module; fully unit-tested):

- For each coin spend, build `Puzzle` from the reveal and try `parseNft` → `parseCat` → `parseDid`; fall back to XCH.
- NFT events carry launcher ID and an image URL taken directly from the on-chain metadata program's `dataUris` (first http(s) URI); no server-side fetch is needed, and the field is omitted when absent.
- CAT color is derived deterministically from the asset ID (hash → hue), so each token species forms a consistent colony.

### Grove event schema (server → browser, JSON over WebSocket)

```ts
type GroveEvent =
  | { type: 'block';  height: number; headerHash: string; timestamp: number;
      spendCount: number; fees: bigint-as-string }
  | { type: 'sprout'; kind: 'xch' | 'cat' | 'nft' | 'did'; height: number;
      coinId: string; amount: string;          // mojos, as string
      assetId?: string;                        // CAT
      launcherId?: string; imageUrl?: string } // NFT
  | { type: 'ambient'; peakHeight: number; mempoolSize: number;
      mempoolCost: string; netspace: string }
  | { type: 'reorg'; forkHeight: number };
```

### Module: web (`server/web/`)

- Fastify serves the built frontend (static) and a `/ws` WebSocket endpoint.
- In-memory ring buffer of the last ~500 grove events (~30 blocks). New connections receive the buffer as a snapshot (frontend replays it accelerated so the grove visibly grows in), then live events.
- Per-connection backpressure: when a client's send queue backs up, `ambient` events are dropped first; `block`/`sprout` are never dropped (client is disconnected instead if hopelessly behind).
- No database, no per-client state beyond the socket.

### Frontend (`web/`)

Vanilla Three.js + Vite + TypeScript. No UI framework. Shares the `GroveEvent` type with the server via a common `shared/` package/path.

## Scene design

Nocturnal meadow, green-on-dark palette, ground fog, starfield + moon.

**Asset → flora mapping:**

| Chain activity | Flora               | Detail                                                               |
| -------------- | ------------------- | -------------------------------------------------------------------- |
| XCH spend      | Grasses & reeds     | Height scales with log(amount): dust = blade, whale = towering stalk |
| CAT transfer   | Mushroom cluster    | Cap hue deterministic from asset ID                                  |
| NFT activity   | Glowing bloom       | Mint gets a burst animation; click shows the actual NFT image        |
| DID activity   | Violet will-o'-wisp | Rises from the ground and hovers                                     |

**Ambient signals:**

- **Fireflies** — swarm density = mempool size; agitation = mempool cost. They orbit the field and dive into new growth when a block lands.
- **Sky & moon** — moonlight brightness tracks netspace; a soft aurora pulse rolls across the sky on each new peak.
- **Block heartbeat** — each block sends a slow ripple of light through the ground fog, radiating from the newest planting.

**Spatial layout — phyllotaxis spiral:** block _n_ plants its flora group at the golden-angle spiral position around a center clearing (sunflower-seed packing). The grove is dense and organic at any age. Oldest plantings beyond the cap fade and "compost" at the rim. Camera: slow orbital drift around the center; gentle breathing zoom.

**Interaction:** raycast hover gently brightens a plant and shows a small card (asset type, amount, coin ID, block height; NFT image when available) with a link to spacescan.io; moving the pointer away hides it. Clicking pins the card open so the link is reachable; click-away unpins. A collapsible legend inset (top-left, state remembered) explains the symbols; a scrolling block console (bottom-right, ~6 fading lines) logs each block's height, spend count, and asset mix in sync with the animations. No camera control in v1.

**Reorg visual:** affected plantings wilt and regrow — a visible gust through the grove.

## Resilience

- Every RPC call has a timeout; failures use exponential backoff (1 s → 60 s cap).
- The scene never freezes on stale data: fireflies and camera keep moving; after ~2 min without a successful poll the moon dims subtly ("signal lost") and recovers on reconnect.
- Reorg handling: poller keeps the last ~32 header hashes; on parent mismatch it rewinds to the fork point, emits `reorg`, and re-walks.
- WebSocket clients auto-reconnect with jittered backoff; on reconnect they re-receive the snapshot.

## Performance budget

- One `InstancedMesh` per flora kind; fireflies are a single GPU particle system.
- Target 60 fps on integrated graphics. Hard cap ~3,000 plants (oldest culled).
- Pixel-ratio clamped on high-DPI; `prefers-reduced-motion` honored (static camera, reduced particles).
- Hidden tabs pause rendering automatically (browsers do not fire requestAnimationFrame for hidden tabs); animations are keyed to absolute time, so the scene catches up instantly on return.

## Testing

- **classify**: unit tests against fixtures of real mainnet block spends (captured once via a fixture script). Assert: NFT mint detected, CAT hue stable per asset ID, amounts and kinds correct.
- **ingest**: `CoinsetPoller` tested against a mock RPC client for the reorg, multi-block jump, and backoff paths.
- **frontend**: `?demo=1` mode synthesizes fake grove events — serves as the visual dev harness and a network-free demo mode.

## Deployment

- Single DigitalOcean droplet (or equivalent), Node 20+, systemd unit, Caddy reverse proxy for TLS.
- `npm run build` produces the frontend bundle; one rsync-style deploy script.
- No secrets required in v1 (coinset.org is public).

## Phase 2 (explicitly out of scope for v1)

- `PeerSource`: DNS-introducer autodiscovery (`dns-introducer.chia.net`), shuffle candidates, race `Peer.connect` with short timeouts (most candidates are unreachable), maintain N healthy peers, reconnect on drop. Wallet-protocol `NewPeakWallet` push replaces the 3 s state poll for instant block reaction; coinset remains the source for block contents.
- Optional ambient stats overlay (netspace, peak height) as a toggle.
