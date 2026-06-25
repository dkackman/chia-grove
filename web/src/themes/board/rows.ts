import type { SproutEvent } from "@grove/shared";
import { mojosToXch, mojosToCAT } from "../../ui/format.js";

export const BOARD_COLS = 48;

const padL = (s: string, n: number) => s.slice(0, n).padStart(n);
const padR = (s: string, n: number) => s.slice(0, n).padEnd(n);

/** Trim a decimal string to at most `maxFrac` fraction digits (no rounding). */
function clampFrac(s: string, maxFrac: number): string {
  const dot = s.indexOf(".");
  return dot < 0 ? s : s.slice(0, dot + 1 + maxFrac).replace(/\.?0+$/, "") || "0";
}

function kindLabel(e: SproutEvent): string {
  return e.kind.toUpperCase(); // XCH / CAT / NFT / DID
}

function asset(e: SproutEvent): string {
  if (e.kind === "cat") return (e.catTicker ?? e.catName ?? "CAT").toUpperCase();
  if (e.kind === "nft") return e.mint ? "MINT" : "TRANSFER";
  if (e.kind === "did") return "PROFILE";
  return "-";
}

function amount(e: SproutEvent): string {
  if (e.kind === "xch") return clampFrac(mojosToXch(e.amount), 4);
  if (e.kind === "cat") return clampFrac(mojosToCAT(e.amount), 3);
  return "-";
}

function status(e: SproutEvent): string {
  return e.mint ? "★ NEW" : "CONFIRMED";
}

/** Display toggles for a ledger line: the block-start `▸` marker and the height. */
export interface RowOptions {
  showHeight?: boolean;
  showMarker?: boolean;
}

/** One fixed-width ledger line for an individual spend. Pure. Fields sum to BOARD_COLS (48). */
export function rowText(event: SproutEvent, { showHeight = true, showMarker = true }: RowOptions = {}): string {
  return (
    padR(kindLabel(event), 3) +
    (showMarker ? " ▸ " : "   ") +
    padR(asset(event), 11) +
    " " +
    padL(amount(event), 11) +
    " " +
    (showHeight ? padL(String(event.height), 8) : " ".repeat(8)) +
    " " +
    padR(status(event), 9)
  );
}

export interface AggregatedRow {
  type: "aggregated";
  kind: "xch" | "cat";
  height: number;
  totalMojos: bigint;
  count: number;
  assetId?: string;
  catName?: string;
  catTicker?: string;
}

export type DisplayRow = AggregatedRow | SproutEvent;

function aggregatedRowText(row: AggregatedRow, { showHeight = true, showMarker = true }: RowOptions): string {
  const kindStr = row.kind.toUpperCase();
  const assetStr =
    row.kind === "cat" ? (row.catTicker ?? row.catName ?? "CAT").toUpperCase() : "-";
  const amountStr =
    row.kind === "xch"
      ? clampFrac(mojosToXch(row.totalMojos.toString()), 4)
      : clampFrac(mojosToCAT(row.totalMojos.toString()), 3);
  const countStr = `${row.count}×`;

  return (
    padR(kindStr, 3) +
    (showMarker ? " ▸ " : "   ") +
    padR(assetStr, 11) +
    " " +
    padL(amountStr, 11) +
    " " +
    (showHeight ? padL(String(row.height), 8) : " ".repeat(8)) +
    " " +
    padR(countStr, 9)
  );
}

/** Render a DisplayRow to a fixed-width 48-char string. */
export function rowTextFor(row: DisplayRow, opts: RowOptions = {}): string {
  return row.type === "aggregated" ? aggregatedRowText(row, opts) : rowText(row, opts);
}

/**
 * Whether a row begins a new block: it has no predecessor, or its height
 * differs from the row above it. Drives the `▸` block-start marker.
 */
export function isBlockStart(prev: DisplayRow | undefined, cur: DisplayRow): boolean {
  return prev === undefined || prev.height !== cur.height;
}

/**
 * Whether a visible ledger row should render its block height. The topmost
 * visible row always does (so a scrolled-back view never loses its label);
 * otherwise the height shows only at a block boundary.
 */
export function shouldShowHeight(
  prev: DisplayRow | undefined,
  cur: DisplayRow,
  isTopVisible: boolean
): boolean {
  return isTopVisible || isBlockStart(prev, cur);
}

/**
 * Derive display rows from raw events (newest-first).
 * For each block: one XCH aggregate row (if any), one row per distinct CAT
 * assetId (in order of first appearance), then individual NFT rows, then DID rows.
 */
export function toDisplayRows(events: SproutEvent[]): DisplayRow[] {
  const blockOrder: number[] = [];
  const byHeight = new Map<number, SproutEvent[]>();

  for (const e of events) {
    if (!byHeight.has(e.height)) {
      blockOrder.push(e.height);
      byHeight.set(e.height, []);
    }
    byHeight.get(e.height)!.push(e);
  }

  const rows: DisplayRow[] = [];

  for (const height of blockOrder) {
    const blockEvents = byHeight.get(height)!;

    // XCH — one aggregate row
    const xchEvents = blockEvents.filter((e) => e.kind === "xch");
    if (xchEvents.length > 0) {
      rows.push({
        type: "aggregated",
        kind: "xch",
        height,
        totalMojos: xchEvents.reduce((s, e) => s + BigInt(e.amount), 0n),
        count: xchEvents.length,
      });
    }

    // CAT — one aggregate row per distinct assetId, in order of first appearance
    const catByAsset = new Map<string, SproutEvent[]>();
    for (const e of blockEvents) {
      if (e.kind !== "cat") continue;
      const key = e.assetId ?? "";
      if (!catByAsset.has(key)) catByAsset.set(key, []);
      catByAsset.get(key)!.push(e);
    }
    for (const catEvents of catByAsset.values()) {
      const first = catEvents[0];
      rows.push({
        type: "aggregated",
        kind: "cat",
        height,
        totalMojos: catEvents.reduce((s, e) => s + BigInt(e.amount), 0n),
        count: catEvents.length,
        assetId: first.assetId,
        catName: first.catName,
        catTicker: first.catTicker,
      });
    }

    // NFT rows first, then DID rows — each in arrival order
    for (const e of blockEvents) if (e.kind === "nft") rows.push(e);
    for (const e of blockEvents) if (e.kind === "did") rows.push(e);
  }

  return rows;
}
