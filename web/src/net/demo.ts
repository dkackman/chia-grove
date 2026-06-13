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
const DEMO_LAUNCHERS = Array.from({ length: 20 }, (_, i) => "ee" + i.toString(16).padStart(62, "0"));

function randomKind(): SproutKind {
  const roll = Math.random();
  if (roll < 0.85) return "xch";
  if (roll < 0.94) return "cat";
  if (roll < 0.98) return "nft";
  return "did";
}

function sprout(height: number): SproutEvent {
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
    event.imageUrl = demoNftImage(event.launcherId); // same launcher → same art
    if (Math.random() < 0.25) event.mint = true;
  }
  return event;
}

function blockWithSprouts(height: number): GroveEvent[] {
  const count = 2 + Math.floor(Math.random() * 14);
  return [
    {
      type: "block",
      height,
      headerHash: randomHex(32),
      timestamp: Math.floor(Date.now() / 1000),
      spendCount: count,
      fees: String(Math.floor(Math.random() * 1e9)),
    },
    ...Array.from({ length: count }, () => sprout(height)),
  ];
}

export function startDemo(dispatch: (event: GroveEvent) => void): void {
  let height = 7_000_000;
  let mempool = 60;

  // synthetic snapshot: 30 past blocks, replayed quickly
  const backlog: GroveEvent[] = [];
  for (let i = 0; i < 30; i++) backlog.push(...blockWithSprouts(height++));
  backlog.forEach((event, i) => setTimeout(() => dispatch(event), i * 12));

  setInterval(() => {
    for (const event of blockWithSprouts(height++)) dispatch(event);
  }, 8000);

  setInterval(() => {
    mempool = Math.max(5, Math.min(400, mempool + (Math.random() - 0.5) * 40));
    dispatch({
      type: "ambient",
      peakHeight: height,
      mempoolSize: Math.floor(mempool),
      mempoolCost: String(Math.floor(mempool * 5e9)),
      mempoolFees: String(Math.floor(mempool * 1e7)),
      netspace: String(33n * 2n ** 60n),
    });
  }, 2000);
}
