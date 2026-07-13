import { Address, Clvm, Constants, type CoinSpend } from "chia-wallet-sdk";
import type { BlockEvent, GroveEvent, SproutEvent } from "@grove/shared";
import { mediaKind, type MediaKind } from "@grove/shared";
import type { CatRegistry } from "./cats.js";
import type { MediaIndex } from "../web/media-index.js";
import { log } from "../logger.js";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const LAUNCHER_HASH = hex(Constants.singletonLauncherHash());

export interface BlockInput {
  height: number;
  headerHash: string;
  timestamp: number;
  fees: bigint;
  spends: CoinSpend[];
}

/** The block-level summary event, with no per-spend classification. Used both
 *  as the first event of a normal classifyBlock() result and as the fallback
 *  when classification/enrichment fails partway through (see server/src/index.ts). */
export function blockEvent(block: BlockInput): BlockEvent {
  return {
    type: "block",
    height: block.height,
    headerHash: block.headerHash,
    timestamp: block.timestamp,
    spendCount: block.spends.length,
    fees: block.fees.toString(),
  };
}

export function classifyBlock(
  block: BlockInput,
  cats?: CatRegistry,
  media?: MediaIndex
): GroveEvent[] {
  const launcherCoinIds = new Set(
    block.spends
      .filter((s) => hex(s.coin.puzzleHash) === LAUNCHER_HASH)
      .map((s) => hex(s.coin.coinId()))
  );

  const events: GroveEvent[] = [blockEvent(block)];

  // One Clvm allocator for the whole block instead of one per spend. parse*
  // operates on the specific Program returned by deserializeWithBackrefs, so
  // results don't depend on other spends' nodes sharing the arena; the arena
  // is freed when this function returns. (verified by the heterogeneous-block
  // test in classify.test.ts)
  const clvm = new Clvm();
  for (const spend of block.spends) {
    if (hex(spend.coin.puzzleHash) === LAUNCHER_HASH) continue;
    events.push(classifySpend(clvm, spend, block.height, launcherCoinIds, cats, media));
  }
  return events;
}

function classifySpend(
  clvm: Clvm,
  spend: CoinSpend,
  height: number,
  launcherCoinIds: Set<string>,
  cats?: CatRegistry,
  media?: MediaIndex
): SproutEvent {
  const base: SproutEvent = {
    type: "sprout",
    kind: "xch",
    height,
    coinId: hex(spend.coin.coinId()),
    amount: spend.coin.amount.toString(),
  };
  const mint = launcherCoinIds.has(hex(spend.coin.parentCoinInfo)) ? true : undefined;

  try {
    const puzzle = clvm.deserializeWithBackrefs(spend.puzzleReveal).puzzle();
    const solution = clvm.deserializeWithBackrefs(spend.solution);

    const nft = puzzle.parseNft(spend.coin, solution);
    if (nft) {
      const meta = nft.nft.info.metadata.parseNftMetadata();
      const imageUrl = meta?.dataUris.find(
        (u) => u.startsWith("https://") || u.startsWith("http://")
      );
      const launcherId = hex(nft.nft.info.launcherId);
      let kind: MediaKind | undefined;
      if (imageUrl) {
        kind = mediaKind(imageUrl);
        // key by launcherId (stable across every spend of this NFT) so the
        // /img?nft= URL is cacheable; the URL itself stays server-side
        media?.set(launcherId, { url: imageUrl, kind });
      }
      return {
        ...base,
        kind: "nft",
        mint,
        launcherId,
        nftId: new Address(nft.nft.info.launcherId, "nft").encode(),
        ...(kind ? { mediaKind: kind } : {}),
      };
    }

    const cat = puzzle.parseCat(spend.coin, solution);
    if (cat) {
      const assetId = hex(cat.cat.info.assetId);
      const info = cats?.lookup(assetId);
      return {
        ...base,
        kind: "cat",
        assetId,
        ...(info ? { catName: info.name, catTicker: info.ticker, catIconUrl: info.iconUrl } : {}),
      };
    }

    const did = puzzle.parseDid(spend.coin, solution);
    if (did) return { ...base, kind: "did", mint };
  } catch (error) {
    // parse* returns null on miss; a throw is unexpected — log and fall back
    log.warn(
      { coinId: base.coinId, err: error instanceof Error ? error.message : String(error) },
      "classify: puzzle parse failed"
    );
  }
  return base;
}
