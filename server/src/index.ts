import { RpcClient } from "chia-wallet-sdk";
import type { GroveEvent } from "@grove/shared";
import { classifyBlock } from "./classify/classify.js";
import { CoinsetPoller } from "./ingest/coinset-poller.js";
import { coinsetView } from "./ingest/coinset-view.js";
import { Hub } from "./web/hub.js";
import { RingBuffer } from "./web/ring-buffer.js";
import { buildServer } from "./web/server.js";

const PORT = Number(process.env.PORT ?? 8080);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 3000);
const BACKFILL_BLOCKS = Number(process.env.BACKFILL_BLOCKS ?? 30);

const hub = new Hub(new RingBuffer<GroveEvent>(500));

const poller = new CoinsetPoller(
  coinsetView(RpcClient.mainnet()),
  {
    onBlock(block) {
      hub.publish(classifyBlock(block));
      console.log(
        `block ${block.height} (${block.spends.length} spends)`
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
      console.warn(`reorg back to ${forkHeight}`);
      hub.publish([{ type: "reorg", forkHeight }]);
    },
  },
  { pollIntervalMs: POLL_INTERVAL_MS, backfillBlocks: BACKFILL_BLOCKS }
);

const app = await buildServer(hub);
await app.listen({ port: PORT, host: "0.0.0.0" });
poller.start();
console.log(`chia-grove server on :${PORT}`);
