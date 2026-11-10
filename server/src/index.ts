import { RpcClient } from "chia-wallet-sdk";
import type { GroveEvent, SproutEvent } from "@grove/shared";
import { blockEvent, classifyBlock } from "./classify/classify.js";
import { CatRegistry } from "./classify/cats.js";
import { CoinsetPoller } from "./ingest/coinset-poller.js";
import { coinsetView } from "./ingest/coinset-view.js";
import { MempoolTracker, coinsetMempoolTxIds } from "./ingest/mempool-tracker.js";
import { Hub } from "./web/hub.js";
import { RingBuffer } from "./web/ring-buffer.js";
import { buildServer } from "./web/server.js";
import { MediaIndex } from "./web/media-index.js";
import { Collection } from "./web/collection.js";
import { ContentFilter } from "./content-filter/index.js";
import { ContentStore } from "./content-filter/store.js";
import { WhitelistRegistry } from "./content-filter/signals/whitelist-registry.js";
import { readVersion } from "./version.js";
import { log } from "./logger.js";

process.on("unhandledRejection", (reason) => {
  log.error({ reason }, "unhandled rejection");
});
process.on("uncaughtException", (error) => {
  // log and exit: a process that limps on after an uncaught exception can
  // look "up" to systemd while serving nothing — let Restart=always recover
  // stderr first, synchronously: with the Axiom transport pino writes from a
  // worker thread, so an immediate exit would lose the log line entirely
  console.error("uncaught exception:", error);
  log.error({ err: error }, "uncaught exception");
  // give the transport a moment to flush to Axiom, but never hang on it
  const exit = () => process.exit(1);
  setTimeout(exit, 2000).unref();
  log.flush(exit);
});

// Number() on a non-numeric env value yields NaN rather than throwing, which
// would otherwise flow silently into setTimeout delays etc. (NaN coerces to 0,
// producing a tight loop hammering the RPC) — fall back to the default instead.
function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

/** Comma-separated env list; unset or blank → undefined (the caller's default). */
function envList(name: string): string[] | undefined {
  const items = (process.env[name] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

const PORT = envInt("PORT", 8080);
// Chia mainnet blocks land every ~18.75s on average; polling much faster than
// that just burns getBlockchainState calls that come back with nothing new.
const POLL_INTERVAL_MS = envInt("POLL_INTERVAL_MS", 10_000);
// backfill ~150 blocks on boot so a fresh deploy (which clears the in-memory
// buffer) already has some history — NFT mints are sparse (~1 per 18 blocks),
// so a deep backfill is what keeps the gallery from starting empty
const BACKFILL_BLOCKS = envInt("BACKFILL_BLOCKS", 150);
// Only blocks this recent get a mempool-inclusion estimate; backfilled history
// predates our mempool snapshots and would otherwise soak up their counts.
const LIVE_BLOCK_SECONDS = 120;

// the ring buffer is sized to absorb airdrop blocks (400+ sprouts each) while
// still covering the full backfill window; older events fall off the back
const buffer = new RingBuffer<GroveEvent>(10000);
const hub = new Hub(buffer, readVersion().appVersion);
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
// The gallery's permanent collection. Stricter than the live feed (which fails
// open): a piece is listed only while its persisted verdict is positively
// clean — never anything marked sensitive or blocked, and, when Vision
// SafeSearch is on, only art it has actually checked (or the allow-list
// vouched for). No verdict store, or a store error, means nothing is shown.
const SAFESEARCH_ON = !!process.env.GOOGLE_VISION_API_KEY;
const COLLECTION_DB_PATH = process.env.COLLECTION_DB_PATH ?? "./data/collection.sqlite";
let collection: Collection | undefined;
try {
  collection = new Collection(COLLECTION_DB_PATH, media, {
    isClean: (launcherId) => {
      const verdict = contentStore?.get(launcherId);
      if (!verdict || verdict.disposition !== "ok") return false;
      return !SAFESEARCH_ON || verdict.safesearchChecked;
    },
  });
} catch (err) {
  log.error(
    { path: COLLECTION_DB_PATH, err },
    "collection store failed to open (gallery collection disabled)"
  );
}
// a fresh install starts from art SafeSearch has already cleared, rather than
// an empty wall until enough new NFT spends arrive
try {
  if (collection && contentStore && collection.size === 0) {
    const seeded = collection.seed(contentStore.recentClean(60));
    if (seeded > 0) log.info({ seeded }, "collection seeded from verified-clean NFTs");
  }
} catch (err) {
  log.warn({ err }, "collection seed failed");
}
/** Collection upkeep must never disturb ingest. */
function withCollection(what: string, fn: (c: Collection) => void): void {
  if (!collection) return;
  try {
    fn(collection);
  } catch (err) {
    log.warn({ err }, `collection ${what} failed`);
  }
}
const whitelistRegistry = new WhitelistRegistry({ gistUrl: process.env.WHITELIST_GIST_URL });
await whitelistRegistry.start();
const contentFilter = new ContentFilter(media, {
  store: contentStore,
  googleApiKey: process.env.GOOGLE_VISION_API_KEY,
  whitelist: whitelistRegistry.get(),
  onFlag: (e) => {
    // flagged after the fact: out of the permanent collection for good
    withCollection("remove", (c) => c.remove(e.launcherId));
    hub.publish([e]);
  },
  safesearchSweepIntervalMs: envInt("SAFESEARCH_SWEEP_INTERVAL_MS", 600_000),
  // Runs standalone without a Vision key, or in shadow mode alongside Vision
  // if one is set (see safesearch-worker.ts). Unset by default; opting in
  // means pointing this at the bundled model, e.g. (path relative to this
  // process's cwd, i.e. server/): LOCAL_NSFW_MODEL_PATH=./models/opennsfw2.onnx
  localNsfwModelPath: process.env.LOCAL_NSFW_MODEL_PATH,
  // Once you trust the local classifier's clean/nsfw agreement with Vision
  // (via the shadow/standalone logs above), set this to actually skip Vision
  // on a confident-clean local score instead of just logging the comparison.
  localNsfwEnforceClean: process.env.LOCAL_NSFW_ENFORCE_CLEAN === "true",
  // Comma-separated hostnames Google's fetcher can't reach; unset keeps the
  // built-in list (ipfs.mintgarden.io).
  visionUnreachableHosts: envList("VISION_UNREACHABLE_HOSTS"),
}); // MintGarden lookups cached per nftId; SafeSearch async when API key set
const cats = new CatRegistry();
// a load that lands after blocks were already classified (initial failure, a
// newly listed CAT) patches the names into the snapshot buffer, so new clients
// see them instead of a bare "CAT" until those events age out
cats.onLoad(() => {
  const patched = cats.fillNames(buffer);
  if (patched > 0) log.info({ patched }, "cat names backfilled into buffered events");
});
await cats.start();

const rpcView = coinsetView(RpcClient.mainnet());
const mempool = new MempoolTracker({
  fetchTxIds: coinsetMempoolTxIds(),
  intervalMs: POLL_INTERVAL_MS,
});

const poller = new CoinsetPoller(
  rpcView,
  {
    async onBlock(block) {
      // classifyBlock/enrich are only ever fed already-fetched RPC data (no
      // network calls of their own — enrich() already swallows its lookup
      // failures into a permissive verdict), so a throw here means a genuine
      // bug, not transient trouble. The poller only advances past a block
      // once onBlock resolves, so leaving this unguarded would let one bad
      // block wedge ingestion at that height forever under the retry/backoff
      // loop. Degrade to a bare block event instead, matching the fallback
      // /block/:height already uses (block-lookup.ts) for the same pipeline.
      let events: GroveEvent[];
      try {
        events = classifyBlock(block, cats, media);
        await contentFilter.enrich(events);
      } catch (err) {
        log.error(
          { err, height: block.height },
          "block classify/enrich failed; publishing bare block event"
        );
        events = [blockEvent(block)];
      }
      if (Date.now() / 1000 - block.timestamp < LIVE_BLOCK_SECONDS) {
        const inclusion = await mempool.onBlock(); // never throws
        const head = events[0];
        if (inclusion && head?.type === "block") {
          head.mempoolIncluded = inclusion.included;
          head.mempoolRemaining = inclusion.remaining;
        }
      }
      hub.publish(events);
      const sprouts = events.filter((e): e is SproutEvent => e.type === "sprout");
      withCollection("offer", (c) => {
        for (const sprout of sprouts) c.offer(sprout);
      });
      log.info(
        {
          height: block.height,
          spends: block.spends.length,
          nfts: sprouts.filter((e) => e.kind === "nft").length,
          cats: sprouts.filter((e) => e.kind === "cat").length,
          dids: sprouts.filter((e) => e.kind === "did").length,
          mempoolIncluded: events[0]?.type === "block" ? events[0].mempoolIncluded : undefined,
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
      withCollection("reorg", (c) => c.removeFrom(forkHeight));
      hub.publish([{ type: "reorg", forkHeight }]);
    },
  },
  { pollIntervalMs: POLL_INTERVAL_MS, backfillBlocks: BACKFILL_BLOCKS }
);

const app = await buildServer(hub, media, log, { rpc: rpcView, cats, contentFilter }, collection);
await app.listen({ port: PORT, host: "0.0.0.0" });
poller.start();
mempool.start();
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
    mempool.stop();
    cats.stop();
    await app.close();
    contentStore?.close();
    collection?.close();
    process.exit(0);
  });
}
