import type { SproutEvent } from "@grove/shared";
import type { CardMeta } from "../types.js";
import { isRenderable } from "./glyphs.js";
import { mojosToXch, mojosToCAT } from "../../ui/format.js";

export const BOARD_COLS = 48;
export const HEIGHT_COLS = 8;

const padL = (s: string, n: number) => s.slice(0, n).padStart(n);
const padR = (s: string, n: number) => s.slice(0, n).padEnd(n);

// Stand-in for a glyph the flap atlas can't show: a filled box (the classic
// "missing glyph"/tofu mark). Deliberately not "?", which is now a real flap and
// would be indistinguishable from a literal question mark in a name.
const MISSING_GLYPH = "▮";

/**
 * The board-renderable label for a CAT: ticker (or name), uppercased, with each
 * glyph the flap atlas can't show replaced by a ▮ so the column count and
 * surrounding separators are preserved. Iterates by code point so a surrogate-
 * pair emoji becomes one box, not two — e.g. "TIBET-💎-XCH" → "TIBET-▮-XCH". Pure.
 */
function catLabel(ticker: string | undefined, name: string | undefined): string {
  let out = "";
  for (const ch of (ticker ?? name ?? "CAT").toUpperCase()) {
    out += isRenderable(ch) ? ch : MISSING_GLYPH;
  }
  return out || "CAT";
}

/** Trim a decimal string to at most `maxFrac` fraction digits (no rounding). */
function clampFrac(s: string, maxFrac: number): string {
  const dot = s.indexOf(".");
  return dot < 0 ? s : s.slice(0, dot + 1 + maxFrac).replace(/\.?0+$/, "") || "0";
}

function kindLabel(e: SproutEvent): string {
  return e.kind.toUpperCase(); // XCH / CAT / NFT / DID
}

function asset(e: SproutEvent): string {
  if (e.kind === "cat") return catLabel(e.catTicker, e.catName);
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

/** Display toggles for a ledger line. The block height leads each row but is
 *  blanked on continuation rows (shown only at block starts + the top row). */
export interface RowOptions {
  showHeight?: boolean;
}

/** One fixed-width ledger line for an individual spend. Pure. Fields sum to BOARD_COLS (48). */
export function rowText(event: SproutEvent, { showHeight = true }: RowOptions = {}): string {
  return (
    (showHeight ? padR(String(event.height), HEIGHT_COLS) : " ".repeat(HEIGHT_COLS)) +
    " " +
    padR(kindLabel(event), 3) +
    " " +
    padR(asset(event), 12) +
    " " +
    padL(amount(event), 11) +
    " " +
    padR(status(event), 10)
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
  sample?: SproutEvent; // a representative underlying spend, for the detail card
}

export type DisplayRow = AggregatedRow | SproutEvent;

function aggregatedRowText(row: AggregatedRow, { showHeight = true }: RowOptions): string {
  const kindStr = row.kind.toUpperCase();
  const assetStr = row.kind === "cat" ? catLabel(row.catTicker, row.catName) : "-";
  const amountStr =
    row.kind === "xch"
      ? clampFrac(mojosToXch(row.totalMojos.toString()), 4)
      : clampFrac(mojosToCAT(row.totalMojos.toString()), 3);
  // right-align the number in a 3-wide sub-column so counts line up and the word
  // starts at a fixed column; padStart never truncates, so the digit count is safe
  const countStr = `${String(row.count).padStart(3)} ${row.count === 1 ? "SPEND" : "SPENDS"}`;

  return (
    (showHeight ? padR(String(row.height), HEIGHT_COLS) : " ".repeat(HEIGHT_COLS)) +
    " " +
    padR(kindStr, 3) +
    " " +
    padR(assetStr, 12) +
    " " +
    padL(amountStr, 11) +
    " " +
    padR(countStr, 10)
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
        sample: xchEvents[0],
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
        sample: first,
      });
    }

    // NFT rows first, then DID rows — each in arrival order
    for (const e of blockEvents) if (e.kind === "nft") rows.push(e);
    for (const e of blockEvents) if (e.kind === "did") rows.push(e);
  }

  return rows;
}

/**
 * The detail-card payload for a clicked row, or null when there's nothing to
 * show. Individual rows (NFT/DID) return their own event. An aggregated XCH/CAT
 * row carries the shared identity from a representative spend (CAT name/asset),
 * the block-wide aggregated total as its `amount`, and an `aggregate.count` so
 * the card can present it as a block total rather than a single coin.
 */
export function cardMetaFor(row: DisplayRow): CardMeta | null {
  if (row.type === "sprout") return row;
  if (row.sample) {
    return { ...row.sample, amount: row.totalMojos.toString(), aggregate: { count: row.count } };
  }
  return null;
}

/**
 * A hover-dedup key for a single ledger cell. Every content cell of one display
 * row shares a key so sweeping the pointer across a row's ~40 cells doesn't
 * retrigger the detail card (which would reload its NFT thumbnail from scratch);
 * the height gutter gets its own key so moving between the block-nav gutter and
 * the spend content of the same row still toggles the card. Pure.
 */
export function cellHoverKey(instanceId: number, displayRow: number): string {
  const gutter = instanceId % BOARD_COLS < HEIGHT_COLS;
  return `${displayRow}:${gutter ? "h" : "c"}`;
}

/**
 * Patches `mediaFilter` on every NFT event matching `launcherId`, in place.
 * Mutates the array's elements (not the array itself) so callers holding a
 * reference to the same underlying objects (e.g. a `displayRows` filtered
 * view sharing SproutEvent instances with the live `events` buffer) see the
 * update without re-deriving anything. Pure aside from that mutation — no
 * external state, same result for the same inputs. Returns whether anything
 * was patched.
 */
export function patchMediaFilter(
  events: SproutEvent[],
  launcherId: string,
  mediaFilter: SproutEvent["mediaFilter"]
): boolean {
  let patched = false;
  for (const e of events) {
    if (e.kind === "nft" && e.launcherId === launcherId) {
      e.mediaFilter = mediaFilter;
      patched = true;
    }
  }
  return patched;
}
