import type { SproutEvent } from "@grove/shared";
import type { AggregatedRow, DisplayRow } from "./rows.js";

interface Block {
  height: number;
  rows: DisplayRow[]; // xch agg?, cat aggs…, nfts…, dids… — the toDisplayRows order
}

/**
 * The live ledger's scrollback, kept as per-block display rows rather than raw
 * spends: XCH/CAT spends fold into their block's aggregate rows as they arrive,
 * so one busy block can't push the history out of memory — the cap counts
 * blocks, not spends. Fed spends in arrival order, `rows()` equals
 * `toDisplayRows` over the same spends newest-first (tested).
 */
export class BlockLedger {
  private blocks: Block[] = []; // highest height first
  private flat: DisplayRow[] | null = [];

  constructor(readonly maxBlocks = 300) {}

  get blockCount(): number {
    return this.blocks.length;
  }

  /** Folds one spend into its block (creating it), evicting the oldest past the cap. */
  add(e: SproutEvent): void {
    let i = 0;
    while (i < this.blocks.length && this.blocks[i].height > e.height) i++;
    let block = this.blocks[i];
    if (!block || block.height !== e.height) {
      if (i >= this.maxBlocks) return; // older than everything we keep
      block = { height: e.height, rows: [] };
      this.blocks.splice(i, 0, block);
      if (this.blocks.length > this.maxBlocks) this.blocks.pop();
    }
    addToBlock(block, e);
    this.flat = null;
  }

  /** Drops every block at or above `forkHeight`; returns whether anything went. */
  reorg(forkHeight: number): boolean {
    const before = this.blocks.length;
    this.blocks = this.blocks.filter((b) => b.height < forkHeight);
    if (this.blocks.length === before) return false;
    this.flat = null;
    return true;
  }

  /** All display rows, newest block first. Cached until the next change. */
  rows(): DisplayRow[] {
    if (this.flat === null) this.flat = this.blocks.flatMap((b) => b.rows);
    return this.flat;
  }

  /** The individual (NFT/DID) spends still held, for in-place media-filter patches. */
  sprouts(): SproutEvent[] {
    return this.rows().filter((r): r is SproutEvent => r.type === "sprout");
  }
}

const sectionOf = (r: DisplayRow): number =>
  r.type === "aggregated" ? (r.kind === "xch" ? 0 : 1) : r.kind === "nft" ? 2 : 3;

/** Index of the first row in `rows` whose section is ≥ `section`. */
function sectionStart(rows: DisplayRow[], section: number): number {
  let i = 0;
  while (i < rows.length && sectionOf(rows[i]) < section) i++;
  return i;
}

/**
 * Folds the newest spend `e` into its block, matching toDisplayRows over a
 * newest-first list: aggregates take the newest spend as their sample/name,
 * a CAT asset's row sits in order of its most recent spend, and NFT/DID rows
 * are newest first within their section.
 */
function addToBlock(block: Block, e: SproutEvent): void {
  const rows = block.rows;
  if (e.kind === "xch") {
    const agg = rows[0]?.type === "aggregated" && rows[0].kind === "xch" ? rows[0] : null;
    if (agg) {
      agg.totalMojos += BigInt(e.amount);
      agg.count++;
      agg.sample = e;
    } else {
      rows.unshift({
        type: "aggregated",
        kind: "xch",
        height: e.height,
        totalMojos: BigInt(e.amount),
        count: 1,
        sample: e,
      });
    }
    return;
  }
  if (e.kind === "cat") {
    const key = e.assetId ?? "";
    const at = rows.findIndex(
      (r) => r.type === "aggregated" && r.kind === "cat" && (r.assetId ?? "") === key
    );
    let agg: AggregatedRow;
    if (at >= 0) {
      agg = rows.splice(at, 1)[0] as AggregatedRow;
      agg.totalMojos += BigInt(e.amount);
      agg.count++;
    } else {
      agg = {
        type: "aggregated",
        kind: "cat",
        height: e.height,
        totalMojos: BigInt(e.amount),
        count: 1,
      };
    }
    agg.assetId = e.assetId;
    agg.catName = e.catName;
    agg.catTicker = e.catTicker;
    agg.sample = e;
    rows.splice(sectionStart(rows, 1), 0, agg);
    return;
  }
  if (e.kind === "nft") rows.splice(sectionStart(rows, 2), 0, e);
  else if (e.kind === "did") rows.splice(sectionStart(rows, 3), 0, e);
}
