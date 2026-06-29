# Axiom Structured Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured pino logging to the chia-grove server, routing to Axiom in production and stdout in dev/CI.

**Architecture:** A single `logger.ts` module exports one pino instance. When `AXIOM_TOKEN` + `AXIOM_DATASET` are both set it uses the `@axiomhq/pino` transport; otherwise it writes JSON to stdout. Fastify receives the same instance so HTTP request/response records are automatic. All `console.*` calls across the server are replaced with structured `log.*` calls importing the singleton.

**Tech Stack:** `pino` (already a transitive dep via Fastify), `@axiomhq/pino` (new), Node ≥ 24, ESM (`"type": "module"`), tsx (no build step)

## Global Constraints

- ESM imports only — use `.js` extensions on all local imports
- `npm test` must pass after every task (run from repo root)
- `npm run typecheck` must pass after every task
- Do not add `pino-pretty` as a dependency — stdout fallback uses plain pino JSON
- Never commit secrets (`AXIOM_TOKEN` value) to the repo

---

### Task 1: Install `@axiomhq/pino` and create `logger.ts`

**Files:**
- Modify: `server/package.json`
- Create: `server/src/logger.ts`

**Interfaces:**
- Produces: `log` — a `pino.Logger` instance, exported as named export from `server/src/logger.ts`

- [ ] **Step 1: Install the dependencies**

From the repo root (npm workspaces):
```bash
npm install pino @axiomhq/pino --workspace=@grove/server
```

Verify both appear in `server/package.json` dependencies. `pino` must be a direct dep because `logger.ts` imports it directly and uses `pino.Logger` types — relying on it as a transitive dep of Fastify is fragile.

- [ ] **Step 2: Create `server/src/logger.ts`**

```typescript
import pino from "pino";

const level = (process.env.LOG_LEVEL ?? "info") as pino.Level;
const token = process.env.AXIOM_TOKEN;
const dataset = process.env.AXIOM_DATASET;

export const log =
  token && dataset
    ? pino(
        { level },
        pino.transport({
          target: "@axiomhq/pino",
          options: { token, dataset },
        })
      )
    : pino({ level });
```

- [ ] **Step 3: Verify typecheck and tests pass**

```bash
npm run typecheck && npm test
```

Expected: all 339 tests pass, no type errors.

- [ ] **Step 4: Commit**

```bash
git add server/package.json server/src/logger.ts package-lock.json
git commit -m "feat: add pino logger singleton with Axiom transport"
```

---

### Task 2: Add `Hub.size` getter

**Files:**
- Modify: `server/src/web/hub.ts`

**Interfaces:**
- Produces: `hub.size` — `number`, count of currently connected WireSocket clients

- [ ] **Step 1: Add the getter to Hub**

In `server/src/web/hub.ts`, add this getter after the `remove` method (line 41):

```typescript
get size(): number {
  return this.clients.size;
}
```

- [ ] **Step 2: Verify typecheck and tests pass**

```bash
npm run typecheck && npm test
```

Expected: all 339 tests pass.

- [ ] **Step 3: Commit**

```bash
git add server/src/web/hub.ts
git commit -m "feat: expose Hub.size for connection count logging"
```

---

### Task 3: Wire logger to Fastify + WS connect/disconnect events

This task changes `buildServer`'s signature and updates its only call site in `index.ts`. Both files must be committed together to keep the build valid.

**Files:**
- Modify: `server/src/web/server.ts`
- Modify: `server/src/index.ts`

**Interfaces:**
- Consumes: `log` from `../logger.js` (produced by Task 1); `hub.size` (produced by Task 2)
- Produces: updated `buildServer(hub, media, logger)` — third param is `pino.Logger`

- [ ] **Step 1: Update `server/src/web/server.ts`**

Replace the entire file with:

```typescript
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Logger } from "pino";
import fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import type { Hub, WireSocket } from "./hub.js";
import { registerImageProxy } from "./img-proxy.js";
import type { MediaIndex } from "./media-index.js";
import { readVersion } from "../version.js";
import { PROTOCOL_VERSION } from "@grove/shared";

export async function buildServer(
  hub: Hub,
  media: MediaIndex,
  logger: Logger
): Promise<FastifyInstance> {
  // trust the local Caddy reverse proxy (see deploy/Caddyfile) so request.ip
  // reflects the real client via X-Forwarded-For — the image proxy rate-limits
  // per IP, which would otherwise see only the proxy's loopback address.
  const app = fastify({ logger, trustProxy: "127.0.0.1, ::1" });
  await app.register(websocket, {
    options: {
      // Compress the (batched) JSON wire traffic. Negotiated at the handshake;
      // browsers support it natively, so no client change. no-context-takeover
      // bounds per-connection zlib memory; threshold skips tiny frames
      // (hello/ambient) where framing + a deflate context aren't worth it.
      perMessageDeflate: {
        threshold: 1024,
        serverNoContextTakeover: true,
        clientNoContextTakeover: true,
      },
    },
  });

  const version = readVersion();
  app.get("/healthz", async () => ({
    ok: true,
    appVersion: version.appVersion,
    gitSha: version.gitSha,
    protocolVersion: PROTOCOL_VERSION,
  }));
  registerImageProxy(app, media);

  app.register(async (instance) => {
    instance.get("/ws", { websocket: true }, (socket) => {
      // ws.WebSocket satisfies WireSocket structurally (send/close/terminate/
      // bufferedAmount/readyState); the double cast bridges the nominal types.
      const wire = socket as unknown as WireSocket;
      hub.add(wire);
      logger.info({ clients: hub.size }, "ws: client connected");
      socket.on("close", () => {
        hub.remove(wire);
        logger.info({ clients: hub.size }, "ws: client disconnected");
      });
      socket.on("error", () => {
        hub.remove(wire);
        logger.info({ clients: hub.size }, "ws: client error");
      });
    });
  });

  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../web/dist");
  if (existsSync(dist)) {
    await app.register(fastifyStatic, {
      root: dist,
      // Vite content-hashes JS/CSS (safe to cache), but the HTML entry must not
      // be cached or a reload could re-serve a stale document referencing old
      // bundles — which would defeat the protocol-version reload guard.
      setHeaders(res, filePath) {
        if (filePath.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    });
  }

  return app;
}
```

- [ ] **Step 2: Update `server/src/index.ts`**

Replace the entire file with:

```typescript
import { RpcClient } from "chia-wallet-sdk";
import type { GroveEvent, SproutEvent } from "@grove/shared";
import { classifyBlock } from "./classify/classify.js";
import { CatRegistry } from "./classify/cats.js";
import { CoinsetPoller } from "./ingest/coinset-poller.js";
import { coinsetView } from "./ingest/coinset-view.js";
import { Hub } from "./web/hub.js";
import { RingBuffer } from "./web/ring-buffer.js";
import { buildServer } from "./web/server.js";
import { MediaIndex } from "./web/media-index.js";
import { ContentFilter } from "./content-filter/index.js";
import { ContentStore } from "./content-filter/store.js";
import { readVersion } from "./version.js";
import { log } from "./logger.js";

process.on("unhandledRejection", (reason) => {
  log.error({ reason }, "unhandled rejection");
});
process.on("uncaughtException", (error) => {
  // log and exit: a process that limps on after an uncaught exception can
  // look "up" to systemd while serving nothing — let Restart=always recover
  log.error({ err: error }, "uncaught exception");
  process.exit(1);
});

const PORT = Number(process.env.PORT ?? 8080);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 3000);
// backfill ~150 blocks on boot so a fresh deploy (which clears the in-memory
// buffer) already has some history — NFT mints are sparse (~1 per 18 blocks),
// so a deep backfill is what keeps the gallery from starting empty
const BACKFILL_BLOCKS = Number(process.env.BACKFILL_BLOCKS ?? 150);

// the ring buffer is sized to absorb airdrop blocks (400+ sprouts each) while
// still covering the full backfill window; older events fall off the back
const hub = new Hub(new RingBuffer<GroveEvent>(10000), readVersion().appVersion);
const media = new MediaIndex(10000); // >= ring buffer so replayable art stays resolvable
const CONTENT_DB_PATH = process.env.CONTENT_DB_PATH ?? "./data/content-filter.sqlite";
let contentStore: ContentStore | undefined;
try {
  contentStore = new ContentStore(CONTENT_DB_PATH);
} catch (err) {
  log.error({ path: CONTENT_DB_PATH, err }, "content-filter store failed to open (degrading to in-memory-only)");
}
const contentFilter = new ContentFilter(media, {
  store: contentStore,
  googleApiKey: process.env.GOOGLE_VISION_API_KEY,
  onFlag: (e) => hub.publish([e]),
}); // MintGarden lookups cached per nftId; SafeSearch async when API key set
const cats = new CatRegistry();
await cats.start();

const poller = new CoinsetPoller(
  coinsetView(RpcClient.mainnet()),
  {
    async onBlock(block) {
      const events = classifyBlock(block, cats, media);
      await contentFilter.enrich(events);
      hub.publish(events);
      const sprouts = events.filter((e): e is SproutEvent => e.type === "sprout");
      log.info(
        {
          height: block.height,
          spends: block.spends.length,
          nfts: sprouts.filter((e) => e.kind === "nft").length,
          cats: sprouts.filter((e) => e.kind === "cat").length,
          dids: sprouts.filter((e) => e.kind === "did").length,
        },
        "block"
      );
    },
    onAmbient(state) {
      hub.publish([
        {
          type: "ambient",
          peakHeight: state.peakHeight,
          mempoolSize: state.mempoolSize,
          mempoolCost: state.mempoolCost.toString(),
          mempoolFees: state.mempoolFees.toString(),
          netspace: state.space.toString(),
        },
      ]);
    },
    onReorg(forkHeight) {
      log.warn({ forkHeight }, "reorg");
      hub.publish([{ type: "reorg", forkHeight }]);
    },
  },
  { pollIntervalMs: POLL_INTERVAL_MS, backfillBlocks: BACKFILL_BLOCKS }
);

const app = await buildServer(hub, media, log);
await app.listen({ port: PORT, host: "0.0.0.0" });
poller.start();
log.info(
  { port: PORT, appVersion: readVersion().appVersion, safesearch: !!process.env.GOOGLE_VISION_API_KEY },
  "chia-grove server started"
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    log.info({ signal }, "shutdown signal received");
    poller.stop();
    cats.stop();
    await app.close();
    contentStore?.close();
    process.exit(0);
  });
}
```

- [ ] **Step 3: Verify typecheck and tests pass**

```bash
npm run typecheck && npm test
```

Expected: all 339 tests pass, no type errors.

- [ ] **Step 4: Commit**

```bash
git add server/src/web/server.ts server/src/index.ts
git commit -m "feat: wire pino logger to Fastify and replace console calls in index.ts"
```

---

### Task 4: Hub backpressure logging

**Files:**
- Modify: `server/src/web/hub.ts`

**Interfaces:**
- Consumes: `log` from `../logger.js` (produced by Task 1)

- [ ] **Step 1: Add logger import and backpressure log to `hub.ts`**

Add the import at the top of `server/src/web/hub.ts` (after the existing imports):

```typescript
import { log } from "../logger.js";
```

Then in the `publish` method, replace the backpressure termination block:

```typescript
// before:
if (socket.readyState !== OPEN || socket.bufferedAmount > HARD_LIMIT) {
  socket.terminate();
  this.clients.delete(socket);
  continue;
}

// after:
if (socket.readyState !== OPEN || socket.bufferedAmount > HARD_LIMIT) {
  log.warn({ clients: this.clients.size, buffered: socket.bufferedAmount }, "ws: client terminated (buffer overflow)");
  socket.terminate();
  this.clients.delete(socket);
  continue;
}
```

- [ ] **Step 2: Verify typecheck and tests pass**

```bash
npm run typecheck && npm test
```

Expected: all 339 tests pass.

- [ ] **Step 3: Commit**

```bash
git add server/src/web/hub.ts
git commit -m "feat: log hub backpressure terminations"
```

---

### Task 5: Replace `console.warn` in `CoinsetPoller`

**Files:**
- Modify: `server/src/ingest/coinset-poller.ts`

**Interfaces:**
- Consumes: `log` from `../logger.js` (produced by Task 1)

- [ ] **Step 1: Replace the console call**

Add the import at the top of `server/src/ingest/coinset-poller.ts` (after existing imports):

```typescript
import { log } from "../logger.js";
```

Replace line 56:
```typescript
// before:
console.warn(`poll failed (retry in ${this.delayMs}ms):`, error);

// after:
log.warn(
  { retryMs: this.delayMs, err: error instanceof Error ? error.message : String(error) },
  "poll failed"
);
```

- [ ] **Step 2: Verify typecheck and tests pass**

```bash
npm run typecheck && npm test
```

Expected: all 339 tests pass.

- [ ] **Step 3: Commit**

```bash
git add server/src/ingest/coinset-poller.ts
git commit -m "feat: structured logging in CoinsetPoller"
```

---

### Task 6: Replace `console.warn` in `SafeSearchWorker` and add verdict log

**Files:**
- Modify: `server/src/content-filter/safesearch-worker.ts`

**Interfaces:**
- Consumes: `log` from `../logger.js` (produced by Task 1)

- [ ] **Step 1: Add import and replace all three logging calls**

Add the import at the top of `server/src/content-filter/safesearch-worker.ts` (after existing imports):

```typescript
import { log } from "../logger.js";
```

Replace the `store.get` failure warn (around line 74):
```typescript
// before:
console.warn(`[safesearch] store.get failed for ${launcherId} (skipping):`, err);

// after:
log.warn(
  { launcherId, err: err instanceof Error ? err.message : String(err) },
  "safesearch: store.get failed (skipping)"
);
```

In the `run` method, after `this.opts.store.putSafeSearch(launcherId, result)` and `this.failedUntil.delete(launcherId)`, add the verdict log:
```typescript
// add after failedUntil.delete:
log.info(
  { launcherId, imageUri, verdict: result.sensitive ? "sensitive" : "ok" },
  "safesearch: verdict"
);
```

Replace the Vision API failure warn (around line 108):
```typescript
// before:
console.warn(`[safesearch] failed for ${launcherId} (${imageUri}):`, err);

// after:
log.warn(
  { launcherId, imageUri, err: err instanceof Error ? err.message : String(err) },
  "safesearch: vision api failed"
);
```

- [ ] **Step 2: Verify typecheck and tests pass**

```bash
npm run typecheck && npm test
```

Expected: all 339 tests pass.

- [ ] **Step 3: Commit**

```bash
git add server/src/content-filter/safesearch-worker.ts
git commit -m "feat: structured logging in SafeSearchWorker"
```

---

### Task 7: Replace `console.warn` in `classifyBlock`

**Files:**
- Modify: `server/src/classify/classify.ts`

**Interfaces:**
- Consumes: `log` from `../logger.js` (produced by Task 1)

- [ ] **Step 1: Add import and replace the console call**

Add the import at the top of `server/src/classify/classify.ts` (after existing imports):

```typescript
import { log } from "../logger.js";
```

Replace line 114:
```typescript
// before:
console.warn(`classify: puzzle parse failed for coin ${base.coinId}`, error);

// after:
log.warn(
  { coinId: base.coinId, err: error instanceof Error ? error.message : String(error) },
  "classify: puzzle parse failed"
);
```

- [ ] **Step 2: Verify typecheck and tests pass**

```bash
npm run typecheck && npm test
```

Expected: all 339 tests pass.

- [ ] **Step 3: Commit**

```bash
git add server/src/classify/classify.ts
git commit -m "feat: structured logging in classifyBlock"
```

---

### Task 8: Update `.env.example` and document prod setup

**Files:**
- Modify: `server/.env.example`
- Modify: `deploy/chia-grove.service`

- [ ] **Step 1: Add `LOG_LEVEL` to `.env.example`**

The Axiom vars are already present in `server/.env.example`. Add `LOG_LEVEL` after them:

```
# Log level for pino (trace, debug, info, warn, error). Defaults to info.
# LOG_LEVEL=info
```

- [ ] **Step 2: Document the prod override in the service file**

Add a comment block to `deploy/chia-grove.service` after the existing `Environment=` lines explaining how to set Axiom secrets without committing them:

```ini
# Axiom logging: set AXIOM_TOKEN and AXIOM_DATASET via a systemd drop-in so
# secrets never appear in this file. On the droplet:
#   sudo systemctl edit chia-grove
# Then add:
#   [Service]
#   Environment=AXIOM_TOKEN=your-token-here
#   Environment=AXIOM_DATASET=chia-grove
#   Environment=LOG_LEVEL=info
```

- [ ] **Step 3: Verify typecheck and tests pass**

```bash
npm run typecheck && npm test
```

Expected: all 339 tests pass.

- [ ] **Step 4: Commit**

```bash
git add server/.env.example deploy/chia-grove.service
git commit -m "docs: document Axiom logging env vars and prod setup"
```

---

## Post-implementation: Axiom setup walkthrough

After all tasks are complete, configure Axiom on the droplet:

1. In [Axiom dashboard](https://app.axiom.co): **Datasets** → **New Dataset** → name it `chia-grove`
2. **Settings** → **API Tokens** → **New API Token** → give it ingest permission on `chia-grove` dataset → copy the token
3. On the droplet, create a systemd drop-in:
   ```bash
   sudo systemctl edit chia-grove
   ```
   Add:
   ```ini
   [Service]
   Environment=AXIOM_TOKEN=<your-token>
   Environment=AXIOM_DATASET=chia-grove
   ```
4. Reload and restart:
   ```bash
   sudo systemctl daemon-reload && sudo systemctl restart chia-grove
   ```
5. Verify in Axiom: **Datasets** → `chia-grove` → **Events** — records should appear within ~3 seconds (one poll cycle).
6. Useful first queries in Axiom APL:
   ```
   ['chia-grove'] | where msg == "block" | project _time, height, spends, nfts, cats, dids
   ['chia-grove'] | where level == "warn" or level == "error"
   ['chia-grove'] | where msg == "safesearch: verdict" | project _time, launcherId, verdict
   ['chia-grove'] | where msg startswith "ws:" | project _time, msg, clients
   ```
