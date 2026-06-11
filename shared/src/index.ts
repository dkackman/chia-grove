export type SproutKind = "xch" | "cat" | "nft" | "did";

export interface BlockEvent {
  type: "block";
  height: number;
  headerHash: string; // hex, no 0x
  timestamp: number; // unix seconds
  spendCount: number;
  fees: string; // mojos
}

export interface SproutEvent {
  type: "sprout";
  kind: SproutKind;
  height: number;
  coinId: string; // hex, no 0x
  amount: string; // mojos
  mint?: boolean; // spent coin's parent was a singleton launcher
  assetId?: string; // CAT only, hex
  launcherId?: string; // NFT only, hex
  imageUrl?: string; // NFT only, first http(s) data URI
}

export interface AmbientEvent {
  type: "ambient";
  peakHeight: number;
  mempoolSize: number;
  mempoolCost: string;
  mempoolFees: string;
  netspace: string; // bytes
}

export interface ReorgEvent {
  type: "reorg";
  forkHeight: number;
}

export type GroveEvent = BlockEvent | SproutEvent | AmbientEvent | ReorgEvent;

export interface Snapshot {
  type: "snapshot";
  events: GroveEvent[];
}

export type WireMessage = GroveEvent | Snapshot;
