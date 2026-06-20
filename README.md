# Chia Grove

An ambient 3D visualization of live Chia mainnet activity. Switch between four themes to see what's happening on chain.

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

Click any object for coin details and a [spacescan.io](https://spacescan.io) link.

## How It Works

One Node process polls [coinset.org](https://coinset.org) for new blocks, classifies every coin spend using [chia-wallet-sdk](https://github.com/xch-dev/chia-wallet-sdk), and pushes compact events over a WebSocket to the Three.js frontend it also serves. CAT metadata (name, ticker, icon) is fetched from [dexie.space](https://dexie.space) and refreshed hourly.

No database, no full node. Runs on the smallest droplet.

New clients receive a snapshot of the last 10,000 events so the scene is already populated on connect.

## Development

```sh
npm install
npm run dev:server   # ingest + WebSocket server on :8080 (needs network)
npm run dev:web      # Vite dev server on :5173, proxies /ws → :8080
```

Open **http://localhost:5173/?demo=1** for synthetic events without a running server.

```sh
npm test             # vitest: classifier, poller, hub, layout, palette
npm run typecheck    # tsc across all workspaces
npm run lint         # ESLint
npm run build        # production frontend bundle → web/dist/
```

Requires Node ≥ 24.

## Deployment

The app runs as a systemd service behind Caddy (automatic SSL).

```sh
deploy/deploy.sh grove@your-droplet
```

This builds the frontend locally, rsyncs everything to `/opt/chia-grove`, installs production deps, and restarts the service.

First-time server setup:

1. Run `deploy/infra/server-setup.sh` to install Node 24 LTS, Caddy, create the `grove` user, and provision `/opt/chia-grove`.
2. Copy `deploy/chia-grove.service` to `/etc/systemd/system/` and `systemctl enable chia-grove`.
3. Install `deploy/Caddyfile` as `/etc/caddy/Caddyfile` with your domain pointing at the droplet.

**Environment variables:**

| Variable           | Default | Description                 |
| ------------------ | ------- | --------------------------- |
| `PORT`             | `8080`  | HTTP/WebSocket listen port  |
| `POLL_INTERVAL_MS` | `3000`  | Blockchain poll cadence     |
| `BACKFILL_BLOCKS`  | `150`   | Blocks to replay on startup |
