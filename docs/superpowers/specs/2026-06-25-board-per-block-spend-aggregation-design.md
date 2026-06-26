# Board: Per-Block Spend Aggregation Design

**Date:** 2026-06-25
**Scope:** Board theme (`web/src/themes/board/`) only

## Problem

The board's split-flap ledger shows one row per `SproutEvent`. A busy block can contain hundreds of XCH spends and dozens of CAT transfers, flooding the display with nearly-identical rows and making the board hard to read.

## Goal

Collapse all XCH spends within a block into a single aggregated row, and all spends of each distinct CAT asset within a block into a single aggregated row, while leaving NFT and DID events as individual rows. The aggregated row shows total amount and spend count.

## Approach

Derive display rows from the raw event list. Keep `events: SproutEvent[]` as the single source of truth (reorg handling unchanged); compute a `displayRows: DisplayRow[]` from it whenever the ledger is dirty.

Reorgs are rare on the Chia blockchain, so there is no need for incremental aggregation — a full re-derivation on each dirty frame is sufficient and simpler.

## Data Model

New types added to `rows.ts`:

```typescript
interface AggregatedRow {
  type: "aggregated";
  kind: "xch" | "cat";
  height: number;
  totalMojos: bigint;
  count: number;
  // CAT only:
  assetId?: string;
  catName?: string;
  catTicker?: string;
}

type DisplayRow = AggregatedRow | SproutEvent;
```

`SproutEvent.type === 'sprout'` discriminates cleanly against `'aggregated'`.

## Aggregation Logic

New pure function `toDisplayRows(events: SproutEvent[]): DisplayRow[]` in `rows.ts`.

Walk `events` (newest-first). Group by `height`. For each block emit rows in this order:

1. **One `AggregatedRow`** for all XCH spends in the block (sum mojos, total count). Omitted if the block has no XCH spends.
2. **One `AggregatedRow` per distinct CAT `assetId`** — in order of first appearance. Ticker/name/icon are carried from the first event for that asset. Omitted if the block has no CAT spends.
3. **Individual `SproutEvent` rows** for NFTs — in arrival order.
4. **Individual `SproutEvent` rows** for DIDs — in arrival order.

Amount summation uses `BigInt` arithmetic on the mojo strings to avoid floating-point error.

## Row Formatting

New `aggregatedRowText(row: AggregatedRow): string` in `rows.ts`. Same 48-char fixed-width layout as `rowText`. The STATUS column (last 9 chars, currently `"CONFIRMED"` or `"★ NEW"`) is replaced by `${count}×` right-padded to 9:

```
XCH ▸ -        142.3400   1823456 5×
CAT ▸ SBX        42.500   1823456 3×
NFT ▸ MINT           -    1823456 ★ NEW
DID ▸ PROFILE        -    1823456 CONFIRMED
```

New dispatcher `rowTextFor(row: DisplayRow): string` calls `aggregatedRowText` or `rowText` based on `row.type`.

The `×` glyph is not currently in the board's glyph atlas (`glyphs.ts`), so it must be added to the `GLYPHS` string. The atlas has 64 cells and currently uses 44, so there is room. Without this, `charToGlyph("×")` folds to the blank cell and the marker would render as a space.

## Board Changes (`board.ts`)

- Add `let displayRows: DisplayRow[] = []`.
- In the frame loop, when `ledgerDirty` is set: record `const prevLen = displayRows.length`, recompute `displayRows = toDisplayRows(events)`, then adjust `scrollOffset += displayRows.length - prevLen` (keeps the same block visible when scrolled back).
- `maxOffset()` uses `displayRows.length` instead of `events.length`.
- `renderLedger` indexes `displayRows[r + scrollOffset]` and calls `rowTextFor()`.
- `metaFor`: returns the `SproutEvent` if `row.type === 'sprout'`, else `null`. Clicking an aggregated row does nothing (no detail card for a multi-spend summary).
- `setHovered` and row highlighting are unchanged — they operate on row indices.

## Files Changed

| File                             | Change                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| `web/src/themes/board/glyphs.ts` | Add `×` to the `GLYPHS` atlas string                                                        |
| `web/src/themes/board/rows.ts`   | Add `AggregatedRow`, `DisplayRow`, `toDisplayRows()`, `aggregatedRowText()`, `rowTextFor()` |
| `web/src/themes/board/board.ts`  | Add `displayRows`, update `renderLedger`, `maxOffset`, `metaFor`, scroll adjustment         |

No other files change.

## Testing

- Unit tests in `web/test/` (or `server/test/`) for `toDisplayRows`:
  - Mixed block (XCH + CAT + NFT + DID) produces correct row count and order
  - Two XCH spends in same block → one aggregated row with summed amount
  - Two different CAT assets in same block → two aggregated rows
  - Same CAT asset across two different blocks → two separate aggregated rows
  - NFT and DID are always individual rows
  - Empty input returns empty array
- `aggregatedRowText` produces a 48-char string
- Manual smoke-test on the board with `?demo=1` to verify the display
