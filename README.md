# Chia Grove

An ambient 3D visualization of live Chia mainnet activity. Switch between six themes to see what's happening on chain — pick one from the legend, or link straight to it with `?theme=<id>` (`grove`, `farm`, `gallery`, `mine`, `board`, `timelord`).

Live at **[chia-grove.com](https://chia-grove.com)**

## Themes

### Grove (default)

Bioluminescent night meadow — what grows depends on what happened on chain.

| On chain     | In the grove                                                  |
| ------------ | ------------------------------------------------------------- |
| XCH spend    | Grass blade, height scales with amount                        |
| CAT transfer | Mushroom, color and size derived from the asset id and amount |
| NFT activity | Glowing bloom (mints burst open); click to see the NFT        |
| DID activity | Violet will-o'-wisp                                           |
| Mempool      | Firefly swarm density and agitation                           |
| Netspace     | Moonlight brightness                                          |
| New block    | Ground ripple + aurora pulse                                  |

### Farm

Daytime crop field. Each block plows the next row; crops sprout behind the tractor.

| On chain     | In the farm                |
| ------------ | -------------------------- |
| XCH spend    | Wheat stalk                |
| CAT transfer | Gourd, color from asset id |
| NFT activity | Sunflower (click for NFT)  |
| DID activity | Scarecrow                  |
| Mempool      | Chicken density            |
| Netspace     | Sun brightness             |
| New block    | Tractor plows the next row |
| Reorg        | Crows descend              |

### Gallery

Interior art gallery. NFT mints appear as framed canvases; arrow keys / swipe to browse.

| On chain  | In the gallery            |
| --------- | ------------------------- |
| NFT mint  | Framed canvas on the wall |
| Netspace  | Spotlight warmth          |
| New block | Light pulse               |
| Reorg     | Pieces removed            |

### Mineworld

Minecraft-inspired voxel island on a phyllotaxis spiral.

| On chain     | In the mine                                         |
| ------------ | --------------------------------------------------- |
| XCH spend    | Grass/dirt island land                              |
| CAT transfer | Voxel block (material + color hashed from asset id) |
| NFT activity | Framed painting (click → MintGarden)                |
| DID activity | Villager figure                                     |
| Mint         | Beacon beam                                         |
| Mempool      | Rim torches                                         |
| Netspace     | Day-night cycle brightness (150 s period)           |
| Reorg        | Creeper burst                                       |

### The Big Board

A Solari split-flap departure board: the chain as a live spend ledger. Scroll to browse back through history.

| On chain   | On the board                        |
| ---------- | ----------------------------------- |
| Coin spend | New row flips in at the top         |
| NFT mint   | ★ NEW marker on the row             |
| Mempool    | Header gauge fill                   |
| New block  | Header block height                 |
| Reorg      | Rows riffle back to the fork height |

### Timelord

The chain as verifiable time: a rising helix of blocks threaded on three braided strands (Chia's VDF chains). Scroll, drag or use the arrow keys to travel back; Esc returns to live.

| On chain     | In the helix                                       |
| ------------ | -------------------------------------------------- |
| New block    | Crystal (size = spend count, teal→amber = fees)    |
| XCH spend    | Orbiting coin (silver→green→gold by amount)        |
| CAT transfer | Orbiting gem, color from asset id                  |
| NFT activity | Holo card tethered to its block (gold foil = mint) |
| DID activity | Halo                                               |
| Mempool      | Vortex funnelling into the next slot               |
| Netspace     | Star density                                       |

Click any object for coin details and a [spacescan.io](https://spacescan.io) link.

## How It Works

One Node process polls [coinset.org](https://coinset.org) for new blocks, classifies every coin spend using [chia-wallet-sdk](https://github.com/xch-dev/chia-wallet-sdk), and pushes compact events over a WebSocket to the Three.js frontend it also serves. CAT metadata (name, ticker, icon) is fetched from [dexie.space](https://dexie.space) and refreshed hourly.

NFT art is never linked directly: the server proxies it through `/img`, and a content filter screens it first — cheap inline signals (flags, denylists, a curated allow-list), then optional Google Vision SafeSearch and a local NSFW model. Verdicts are kept in a small SQLite file. See [docs/content-filtering.md](docs/content-filtering.md).

No full node. Runs on the smallest droplet.

New clients receive a snapshot of the last 10,000 events so the scene is already populated on connect.

## Development

```sh
npm install
npm run dev:server   # ingest + WebSocket server on :8080 (needs network)
npm run dev:web      # Vite dev server on :5173, proxies /ws → :8080
```

Open **http://localhost:5173/?demo=1** for synthetic events without a running server.

```sh
npm test             # vitest unit tests (server/test, web/test)
npm run test:e2e     # Playwright browser tests (web/e2e)
npm run typecheck    # tsc across all workspaces
npm run lint         # ESLint
npm run format       # Prettier
npm run build        # production frontend bundle → web/dist/
```

Requires Node ≥ 24.

## Deployment

The app runs as a systemd service behind Caddy (automatic SSL).

```sh
deploy/deploy.sh grove@your-droplet
```

This stamps `version.json`, builds the frontend locally, rsyncs everything to `/opt/chia-grove`, runs `npm ci --omit=dev` (skipped when `package-lock.json` hasn't changed since the last deploy), and restarts the service. Pushing a `v<major>.<minor>.<patch>` tag runs the same script from GitHub Actions — see [deploy/README.md](deploy/README.md) for CI and release setup.

First-time server setup:

1. Run `deploy/infra/server-setup.sh` to install Node 24 LTS and Caddy, create the `grove` user, and provision `/opt/chia-grove` and `/var/lib/chia-grove` (the content-filter database).
2. Copy `deploy/chia-grove.service` to `/etc/systemd/system/` and `systemctl enable chia-grove`.
3. Install `deploy/Caddyfile` as `/etc/caddy/Caddyfile` with your domain pointing at the droplet.
4. Put secrets (`GOOGLE_VISION_API_KEY`, `AXIOM_TOKEN`) in a drop-in via `sudo systemctl edit chia-grove`, never in the unit file.
5. The NSFW model is excluded from deploys; copy it once: `scp server/models/opennsfw2.onnx grove@your-droplet:/opt/chia-grove/server/models/`.

**Environment variables:**

| Variable                        | Default                        | Description                                                       |
| ------------------------------- | ------------------------------ | ----------------------------------------------------------------- |
| `PORT`                          | `8080`                         | HTTP/WebSocket listen port                                        |
| `POLL_INTERVAL_MS`              | `10000`                        | Blockchain poll cadence                                           |
| `BACKFILL_BLOCKS`               | `150`                          | Blocks to replay on startup                                       |
| `CONTENT_DB_PATH`               | `./data/content-filter.sqlite` | Content-filter verdict store                                      |
| `GOOGLE_VISION_API_KEY`         | (unset)                        | Enables SafeSearch; unset = cheap signals only                    |
| `SAFESEARCH_SWEEP_INTERVAL_MS`  | `600000`                       | Re-check cadence for unchecked NFTs; `0` disables                 |
| `LOCAL_NSFW_MODEL_PATH`         | (unset)                        | Enables the local NSFW classifier, e.g. `./models/opennsfw2.onnx` |
| `LOCAL_NSFW_ENFORCE_CLEAN`      | (unset)                        | `true` lets confident-clean local scores skip SafeSearch          |
| `WHITELIST_GIST_URL`            | (unset)                        | Raw gist URL for the NFT allow-list, fetched at startup           |
| `LOG_LEVEL`                     | `info`                         | Pino log level (`debug` logs every coinset call)                  |
| `AXIOM_TOKEN` / `AXIOM_DATASET` | (unset)                        | Ship logs to Axiom when both are set                              |
