import type { GroveEvent, SproutEvent, SproutKind } from "@grove/shared";
import { demoNftImage } from "./demo-art.js";

const randomHex = (bytes: number): string =>
  Array.from({ length: bytes * 2 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join(
    ""
  );

// a few stable fake CAT asset ids so colonies form by color
const DEMO_ASSET_IDS = Array.from({ length: 6 }, () => randomHex(32));

const DEMO_CATS: Array<{ name: string; ticker: string } | undefined> = [
  { name: "Spacebucks", ticker: "SBX" },
  { name: "Marmot", ticker: "MRMT" },
  { name: "Stably USD", ticker: "USDS" },
  { name: "Chia Holiday 2021", ticker: "CH21" },
  undefined, // unknown CAT — no registry entry
  undefined,
];

const DEMO_NFT_IDS = [
  "nft14w46h2at4w46h2at4w46h2at4w46h2at4w46h2at4w46h2at4w4skd8c6g",
  "nft1ehxumnwdehxumnwdehxumnwdehxumnwdehxumnwdehxumnwdehxscu9kvc",
  "nft1zgfpyysjzgfpyysjzgfpyysjzgfpyysjzgfpyysjzgfpyysjzgfq682z48",
  "nft1xs6rgdp5xs6rgdp5xs6rgdp5xs6rgdp5xs6rgdp5xs6rgdp5xs6qwu3rh2",
  "nft12et9v4jk2et9v4jk2et9v4jk2et9v4jk2et9v4jk2et9v4jk2etquh65s4",
  "nft10pu8s7rc0pu8s7rc0pu8s7rc0pu8s7rc0pu8s7rc0pu8s7rc0puqpqmyv9",
];

// a pool of stable demo NFTs (each a fixed launcher id) so the gallery can dedup
// by launcher and replay repeat activity as pings instead of every event being a
// brand-new piece — and so the wall shows a fuller mix than the 6 nft ids alone
const DEMO_LAUNCHERS = Array.from(
  { length: 20 },
  (_, i) => "ee" + i.toString(16).padStart(62, "0")
);

function randomKind(): SproutKind {
  const roll = Math.random();
  if (roll < 0.85) return "xch";
  if (roll < 0.94) return "cat";
  if (roll < 0.98) return "nft";
  return "did";
}

function sprout(height: number, sink?: DemoSink): SproutEvent {
  const kind = randomKind();
  const event: SproutEvent = {
    type: "sprout",
    kind,
    height,
    coinId: randomHex(32),
    // log-uniform mojo amounts from 1000 to ~100 XCH
    amount: String(Math.floor(10 ** (3 + Math.random() * 11))),
  };
  if (kind === "cat") {
    const idx = Math.floor(Math.random() * DEMO_ASSET_IDS.length);
    event.assetId = DEMO_ASSET_IDS[idx];
    const cat = DEMO_CATS[idx];
    if (cat) {
      event.catName = cat.name;
      event.catTicker = cat.ticker;
    }
  }
  if (kind === "nft") {
    const i = Math.floor(Math.random() * DEMO_LAUNCHERS.length);
    event.launcherId = DEMO_LAUNCHERS[i];
    event.nftId = DEMO_NFT_IDS[i % DEMO_NFT_IDS.length];
    event.dataUri = demoNftImage(event.launcherId); // same launcher → same art
    event.mediaKind = "image";
    if (Math.random() < 0.25) event.mint = true;
    // exercise the content filter offline: ~12% sensitive (blur), ~6% blocked (hidden)
    const filterRoll = Math.random();
    if (filterRoll < 0.06) event.mediaFilter = "blocked";
    else if (filterRoll < 0.18) event.mediaFilter = "sensitive";
    // exercise the async content-flag patch path offline
    if (event.kind === "nft" && event.launcherId && filterRoll >= 0.18 && filterRoll < 0.21) {
      const launcher = event.launcherId;
      setTimeout(
        () =>
          sink?.batch([
            {
              type: "content-flag",
              launcherId: launcher,
              mediaFilter: "sensitive",
            },
          ]),
        4000
      );
    }
  }
  return event;
}

/**
 * Where the demo delivers its events: the same two paths a real socket's
 * messages take in `GroveFeed` (a `snapshot` goes through `SeenBlocks` dedupe,
 * then both through the `DrainQueue`), so `?demo=1` exercises the real pacing
 * and dedupe rather than dispatching straight to the theme.
 */
export interface DemoSink {
  snapshot(events: GroveEvent[]): void;
  batch(events: GroveEvent[]): void;
}

// Mean Chia block interval; the backlog is spaced at this so its blocks look
// like real history: all but the newest couple are past themes' 120 s replay
// cutoff, so the backlog appears without per-block celebrations, as a real
// connect's snapshot does.
const BLOCK_INTERVAL_S = 52;
const BACKLOG_BLOCKS = 30;
const LIVE_BLOCK_MS = 8000;
// One live block in this many replaces the previous block (a 1-deep reorg), so
// every theme's reorg path gets exercised offline too.
const REORG_EVERY = 12;

export function blockWithSprouts(
  height: number,
  sink?: DemoSink,
  mempool?: { included: number; remaining: number },
  timestamp = Math.floor(Date.now() / 1000)
): GroveEvent[] {
  const count = 2 + Math.floor(Math.random() * 14);
  return [
    {
      type: "block",
      height,
      headerHash: randomHex(32),
      timestamp,
      spendCount: count,
      fees: String(Math.floor(Math.random() * 1e9)),
      mempoolIncluded: mempool?.included,
      mempoolRemaining: mempool?.remaining,
    },
    ...Array.from({ length: count }, () => sprout(height, sink)),
  ];
}

/** The synthetic connect snapshot: `BACKLOG_BLOCKS` past blocks ending just before `tip`. */
export function demoBacklog(tip: number, nowS: number, sink?: DemoSink): GroveEvent[] {
  const events: GroveEvent[] = [];
  for (let i = 0; i < BACKLOG_BLOCKS; i++) {
    const age = (BACKLOG_BLOCKS - i) * BLOCK_INTERVAL_S;
    events.push(...blockWithSprouts(tip - BACKLOG_BLOCKS + i, sink, undefined, nowS - age));
  }
  return events;
}

export function startDemo(sink: DemoSink): void {
  let height = 7_000_000;
  let mempool = 60;
  let liveBlocks = 0;

  sink.snapshot(demoBacklog(height, Math.floor(Date.now() / 1000), sink));

  setInterval(() => {
    // a live block takes a random share of the mempool (the backlog above doesn't)
    const included = Math.floor(mempool * (0.2 + Math.random() * 0.6));
    mempool -= included;
    const inclusion = { included, remaining: Math.floor(mempool) };
    liveBlocks += 1;
    if (liveBlocks % REORG_EVERY === 0) {
      // the previous block is orphaned: its replacement arrives at the same height
      height -= 1;
      sink.batch([{ type: "reorg", forkHeight: height }]);
    }
    sink.batch(blockWithSprouts(height++, sink, inclusion));
  }, LIVE_BLOCK_MS);

  setInterval(() => {
    mempool = Math.max(5, Math.min(400, mempool + (Math.random() - 0.5) * 40));
    sink.batch([
      {
        type: "ambient",
        peakHeight: height,
        mempoolSize: Math.floor(mempool),
        mempoolCost: String(Math.floor(mempool * 5e9)),
        mempoolFees: String(Math.floor(mempool * 1e7)),
        netspace: String(33n * 2n ** 60n),
      },
    ]);
  }, 2000);
}
