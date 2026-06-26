export type SproutKind = "xch" | "cat" | "nft" | "did";

export type MediaKind = "image" | "video" | "audio";

// Bumped only when the WebSocket wire format changes (independent of app
// semver). The server announces it in the frozen `Hello` handshake; the client
// reloads when its baked-in value differs. See docs/superpowers/specs.
export const PROTOCOL_VERSION = 3;

const VIDEO_EXT = new Set([".mp4", ".webm", ".ogv", ".mov"]);
const AUDIO_EXT = new Set([".mp3", ".wav", ".ogg", ".oga", ".flac", ".aac"]);

/** Classify a media URL by file extension (query/fragment ignored). */
export function mediaKind(url: string): MediaKind {
  const ext = url.match(/\.[a-z0-9]+(?=[?#]|$)/i)?.[0]?.toLowerCase() ?? "";
  if (VIDEO_EXT.has(ext)) return "video";
  if (AUDIO_EXT.has(ext)) return "audio";
  return "image";
}

export interface BlockEvent {
  type: "block";
  height: number;
  headerHash: string; // hex, no 0x
  timestamp: number; // unix seconds
  spendCount: number; // all coin spends in the block, including singleton launchers
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
  catName?: string; // CAT only, from Dexie registry
  catTicker?: string; // CAT only, from Dexie registry
  catIconUrl?: string; // CAT only, from Dexie registry
  launcherId?: string; // NFT only, hex
  nftId?: string; // NFT only, bech32m launcher ID e.g. "nft1..."
  dataUri?: string; // NFT only, inline data: URI for demo/offline art; live art is fetched via /img?nft=launcherId
  mediaKind?: MediaKind; // NFT only, set when proxiable art exists (URL held server-side, keyed by launcherId)
  mediaFilter?: "blocked" | "sensitive"; // NFT only; absent = ok. Set server-side from MintGarden — blocked hides art (bytes made unreachable), sensitive blurs it.
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

// Frozen handshake — sent first on every connection. Its shape MUST NOT change
// so that an old client can always parse it and detect a protocol mismatch.
export interface Hello {
  type: "hello";
  protocolVersion: number;
  appVersion: string;
}

export type GroveEvent = BlockEvent | SproutEvent | AmbientEvent | ReorgEvent;

export interface Snapshot {
  type: "snapshot";
  events: GroveEvent[];
}

// One framed message carrying a publish call's events (a block plus its
// sprouts, or a standalone ambient/reorg). Sent in place of per-event messages
// to cut WebSocket framing overhead; the client drains it across frames.
export interface Batch {
  type: "batch";
  events: GroveEvent[];
}

export type WireMessage = Snapshot | Hello | Batch;
