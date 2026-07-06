import type { RpcClient } from "chia-wallet-sdk";
import type { BlockInfo, ChainState, RpcView } from "./types.js";
import { log } from "../logger.js";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const unhex = (h: string) => Uint8Array.from(Buffer.from(h, "hex"));

// LOG_LEVEL=debug to see the actual outbound coinset.org RPC traffic (method,
// args, latency); left at debug so it stays silent by default in production.
async function timed<T>(
  method: string,
  args: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    log.debug({ method, ...args, ms: Math.round(performance.now() - start) }, "coinset rpc");
    return result;
  } catch (err) {
    log.debug(
      {
        method,
        ...args,
        ms: Math.round(performance.now() - start),
        err: err instanceof Error ? err.message : String(err),
      },
      "coinset rpc failed"
    );
    throw err;
  }
}

function toBlockInfo(record: {
  height: number;
  headerHash: Uint8Array;
  prevHash: Uint8Array;
  timestamp?: bigint | null;
  fees?: bigint | null;
}): BlockInfo {
  return {
    height: record.height,
    headerHash: hex(record.headerHash),
    prevHash: hex(record.prevHash),
    timestamp: record.timestamp ?? null,
    fees: record.fees ?? null,
  };
}

export function coinsetView(rpc: RpcClient): RpcView {
  async function fetchBlockInfo(height: number): Promise<BlockInfo | null> {
    const res = await rpc.getBlockRecordByHeight(height);
    return res.success && res.blockRecord ? toBlockInfo(res.blockRecord) : null;
  }

  return {
    async getState(): Promise<ChainState> {
      return timed("getBlockchainState", {}, async () => {
        const res = await rpc.getBlockchainState();
        const state = res.blockchainState;
        if (!res.success || !state) {
          throw new Error(`getBlockchainState: ${res.error ?? "no state"}`);
        }
        return {
          peakHeight: state.peak.height,
          peakHeaderHash: hex(state.peak.headerHash),
          mempoolSize: state.mempoolSize,
          mempoolCost: state.mempoolCost,
          mempoolFees: state.mempoolFees,
          space: state.space,
        };
      });
    },

    async getBlockInfo(height: number): Promise<BlockInfo> {
      return timed("getBlockRecordByHeight", { height }, async () => {
        const info = await fetchBlockInfo(height);
        if (!info) throw new Error(`getBlockRecordByHeight(${height}): no record`);
        return info;
      });
    },

    async tryGetBlockInfo(height: number): Promise<BlockInfo | null> {
      return timed("getBlockRecordByHeight", { height, speculative: true }, () =>
        fetchBlockInfo(height)
      );
    },

    async getSpends(headerHash: string) {
      return timed("getBlockSpends", { headerHash }, async () => {
        const res = await rpc.getBlockSpends(unhex(headerHash));
        if (!res.success || !res.blockSpends) {
          throw new Error(`getBlockSpends: ${res.error ?? "no spends"}`);
        }
        return res.blockSpends;
      });
    },
  };
}
