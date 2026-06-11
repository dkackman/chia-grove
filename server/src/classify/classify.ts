import { Clvm, Constants, type CoinSpend } from "chia-wallet-sdk";
import type { GroveEvent, SproutEvent } from "@grove/shared";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const LAUNCHER_HASH = hex(Constants.singletonLauncherHash());

export interface BlockInput {
  height: number;
  headerHash: string;
  timestamp: number;
  fees: bigint;
  spends: CoinSpend[];
}

export function classifyBlock(block: BlockInput): GroveEvent[] {
  const launcherCoinIds = new Set(
    block.spends
      .filter((s) => hex(s.coin.puzzleHash) === LAUNCHER_HASH)
      .map((s) => hex(s.coin.coinId()))
  );

  const events: GroveEvent[] = [
    {
      type: "block",
      height: block.height,
      headerHash: block.headerHash,
      timestamp: block.timestamp,
      spendCount: block.spends.length,
      fees: block.fees.toString(),
    },
  ];

  for (const spend of block.spends) {
    if (hex(spend.coin.puzzleHash) === LAUNCHER_HASH) continue;
    events.push(classifySpend(spend, block.height, launcherCoinIds));
  }
  return events;
}

function classifySpend(
  spend: CoinSpend,
  height: number,
  launcherCoinIds: Set<string>
): SproutEvent {
  const clvm = new Clvm();
  const base: SproutEvent = {
    type: "sprout",
    kind: "xch",
    height,
    coinId: hex(spend.coin.coinId()),
    amount: spend.coin.amount.toString(),
  };
  const mint = launcherCoinIds.has(hex(spend.coin.parentCoinInfo))
    ? true
    : undefined;

  try {
    const puzzle = clvm.deserializeWithBackrefs(spend.puzzleReveal).puzzle();
    const solution = clvm.deserializeWithBackrefs(spend.solution);

    const nft = puzzle.parseNft(spend.coin, solution);
    if (nft) {
      const meta = nft.nft.info.metadata.parseNftMetadata();
      const imageUrl = meta?.dataUris.find(
        (u) => u.startsWith("https://") || u.startsWith("http://")
      );
      return {
        ...base,
        kind: "nft",
        mint,
        launcherId: hex(nft.nft.info.launcherId),
        ...(imageUrl ? { imageUrl } : {}),
      };
    }

    const cat = puzzle.parseCat(spend.coin, solution);
    if (cat) return { ...base, kind: "cat", assetId: hex(cat.cat.info.assetId) };

    const did = puzzle.parseDid(spend.coin, solution);
    if (did) return { ...base, kind: "did", mint };
  } catch (error) {
    // parse* returns null on miss; a throw is unexpected — log and fall back
    console.warn(`classify: puzzle parse failed for coin ${base.coinId}`, error);
  }
  return base;
}
