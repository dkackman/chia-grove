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

// Number() on a non-numeric env value yields NaN rather than throwing, which
// would otherwise flow silently into setTimeout delays etc. (NaN coerces to 0,
// producing a tight loop hammering the RPC) — fall back to the default instead.
function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

const PORT = envInt("PORT", 8080);
const POLL_INTERVAL_MS = envInt("POLL_INTERVAL_MS", 3000);
// backfill ~150 blocks on boot so a fresh deploy (which clears the in-memory
// buffer) already has some history — NFT mints are sparse (~1 per 18 blocks),
// so a deep backfill is what keeps the gallery from starting empty
const BACKFILL_BLOCKS = envInt("BACKFILL_BLOCKS", 150);

// the ring buffer is sized to absorb airdrop blocks (400+ sprouts each) while
// still covering the full backfill window; older events fall off the back
const hub = new Hub(new RingBuffer<GroveEvent>(10000), readVersion().appVersion);
const media = new MediaIndex(10000); // >= ring buffer so replayable art stays resolvable
const CONTENT_DB_PATH = process.env.CONTENT_DB_PATH ?? "./data/content-filter.sqlite";
let contentStore: ContentStore | undefined;
try {
  contentStore = new ContentStore(CONTENT_DB_PATH);
} catch (err) {
  log.error(
    { path: CONTENT_DB_PATH, err },
    "content-filter store failed to open (degrading to in-memory-only)"
  );
}
const contentFilter = new ContentFilter(media, {
  store: contentStore,
  googleApiKey: process.env.GOOGLE_VISION_API_KEY,
  onFlag: (e) => hub.publish([e]),
}); // MintGarden lookups cached per nftId; SafeSearch async when API key set
const cats = new CatRegistry();
await cats.start();

const rpcView = coinsetView(RpcClient.mainnet());

const poller = new CoinsetPoller(
  rpcView,
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

const app = await buildServer(hub, media, log, { rpc: rpcView, cats, contentFilter });
await app.listen({ port: PORT, host: "0.0.0.0" });
poller.start();
log.info(
  {
    port: PORT,
    appVersion: readVersion().appVersion,
    safesearch: !!process.env.GOOGLE_VISION_API_KEY,
  },
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
