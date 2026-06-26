import type { CoinSpend } from "chia-wallet-sdk";

export interface ChainState {
  peakHeight: number;
  peakHeaderHash: string;
  mempoolSize: number;
  mempoolCost: bigint;
  mempoolFees: bigint;
  space: bigint;
}

export interface BlockInfo {
  height: number;
  headerHash: string;
  prevHash: string;
  timestamp: bigint | null; // null for non-transaction blocks
  fees: bigint | null;
}

export interface RpcView {
  getState(): Promise<ChainState>;
  getBlockInfo(height: number): Promise<BlockInfo>;
  getSpends(headerHash: string): Promise<CoinSpend[]>;
}

export interface BlockData {
  height: number;
  headerHash: string;
  timestamp: number;
  fees: bigint;
  spends: CoinSpend[];
}

export interface ChainHandlers {
  onBlock(block: BlockData): void | Promise<void>;
  onAmbient(state: ChainState): void;
  onReorg(forkHeight: number): void;
}

export interface ChainSource {
  start(): void;
  stop(): void;
}
