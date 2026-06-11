import type { RpcClient } from "chia-wallet-sdk";
import type { BlockInfo, ChainState, RpcView } from "./types.js";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const unhex = (h: string) => Uint8Array.from(Buffer.from(h, "hex"));

export function coinsetView(rpc: RpcClient): RpcView {
  return {
    async getState(): Promise<ChainState> {
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
    },

    async getBlockInfo(height: number): Promise<BlockInfo> {
      const res = await rpc.getBlockRecordByHeight(height);
      const record = res.blockRecord;
      if (!res.success || !record) {
        throw new Error(`getBlockRecordByHeight(${height}): ${res.error ?? "no record"}`);
      }
      return {
        height: record.height,
        headerHash: hex(record.headerHash),
        prevHash: hex(record.prevHash),
        timestamp: record.timestamp ?? null,
        fees: record.fees ?? null,
      };
    },

    async getSpends(headerHash: string) {
      const res = await rpc.getBlockSpends(unhex(headerHash));
      if (!res.success || !res.blockSpends) {
        throw new Error(`getBlockSpends: ${res.error ?? "no spends"}`);
      }
      return res.blockSpends;
    },
  };
}
