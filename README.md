# Chia Grove

An ambient 3D visualization of live Chia mainnet activity. Every block
sprouts luminous flora in a nocturnal meadow — what grows depends on what
happened on chain, classified per-spend with the
[chia-wallet-sdk](https://github.com/xch-dev/chia-wallet-sdk) napi binding:

| On chain | In the grove |
|---|---|
| XCH spend | Grass blade, height scales with amount |
| CAT transfer | Mushroom, color derived from the asset id |
| NFT activity | Glowing bloom (mints burst); click to see the NFT |
| DID activity | Violet will-o'-wisp |
| Mempool | Firefly swarm density and agitation |
| Netspace | Moonlight brightness |
| New block | Light ripple + aurora pulse |

Click any plant for coin details and a spacescan.io link.

## Architecture

One Node process polls [coinset.org](https://coinset.org) for new blocks,
classifies every spend (`Puzzle.parseNft/parseCat/parseDid`), and pushes
compact events over a WebSocket to the Three.js frontend it also serves.
No database, no full node, runs on the smallest droplet.

Design docs: `docs/superpowers/specs/`, plan: `docs/superpowers/plans/`.

## Development

```sh
npm install
npm run dev:server   # ingest + ws on :8080 (needs network)
npm run dev:web      # vite on :5173, proxies /ws
```

Open http://localhost:5173/?demo=1 for synthetic events (no server needed).

```sh
npm test             # vitest: classifier, poller, hub, layout
npm run build        # production frontend bundle (web/dist)
```

## Deployment (Ubuntu droplet)

1. Install Node 24 LTS and Caddy (see deploy/infra/server-setup.sh); create the `grove` user and `/opt/chia-grove`.
2. Copy `deploy/chia-grove.service` to `/etc/systemd/system/`, enable it.
3. Point `deploy/Caddyfile`'s domain at the droplet, install as `/etc/caddy/Caddyfile`.
4. `deploy/deploy.sh grove@your-droplet`

Environment: `PORT` (8080), `POLL_INTERVAL_MS` (3000), `BACKFILL_BLOCKS` (30).
