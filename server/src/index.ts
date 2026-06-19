import { RpcClient } from "chia-wallet-sdk";
import type { GroveEvent } from "@grove/shared";
import { classifyBlock } from "./classify/classify.js";
import { CatRegistry } from "./classify/cats.js";
import { CoinsetPoller } from "./ingest/coinset-poller.js";
import { coinsetView } from "./ingest/coinset-view.js";
import { Hub } from "./web/hub.js";
import { RingBuffer } from "./web/ring-buffer.js";
import { buildServer } from "./web/server.js";
import { MediaIndex } from "./web/media-index.js";
import { readVersion } from "./version.js";

process.on("unhandledRejection", (reason) => {
  console.error("unhandled rejection:", reason);
});
process.on("uncaughtException", (error) => {
  // log and exit: a process that limps on after an uncaught exception can
  // look "up" to systemd while serving nothing — let Restart=always recover
  console.error("uncaught exception:", error);
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
const hub = new Hub(new RingBuffer<GroveEvent>(10000));
const media = new MediaIndex(10000); // >= ring buffer so replayable art stays resolvable
const cats = new CatRegistry();
await cats.start();

const poller = new CoinsetPoller(
  coinsetView(RpcClient.mainnet()),
  {
    onBlock(block) {
      hub.publish(classifyBlock(block, cats, media));
      console.log(`block ${block.height} (${block.spends.length} spends)`);
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
      console.warn(`reorg back to ${forkHeight}`);
      hub.publish([{ type: "reorg", forkHeight }]);
    },
  },
  { pollIntervalMs: POLL_INTERVAL_MS, backfillBlocks: BACKFILL_BLOCKS }
);

const app = await buildServer(hub, media);
await app.listen({ port: PORT, host: "0.0.0.0" });
poller.start();
console.log(`chia-grove ${readVersion().appVersion} server on :${PORT}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    console.log(`${signal} received, shutting down`);
    poller.stop();
    cats.stop();
    await app.close();
    process.exit(0);
  });
}
