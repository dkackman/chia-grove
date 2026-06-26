# Board: Block Delineation via Height Anchoring Design

**Date:** 2026-06-25
**Scope:** Board theme (`web/src/themes/board/`) only

## Problem

After per-block spend aggregation, the board's ledger shows several rows per block, each repeating the same block height in the height column. Adjacent block heights look nearly identical (e.g. `89177708` vs `89177705`), so the boundary between one block and the next is hard to spot at a glance.

## Goal

Make block boundaries visually obvious without breaking the Solari split-flap idiom — i.e. using only the existing flap grid and atlas glyphs, no drawn rules, no color changes, no extra columns or rows.

## Approach

Show the block height only on each block's **first row**; blank the height column on continuation rows. The reappearance of lit height flaps marks every new block. The height column is otherwise the same number repeated, so blanking it on continuation rows removes redundancy and turns the boundary into a clear visual signal.

The block boundary is derived from the data with no new state: within `displayRows` (newest-first), consecutive rows share a height if and only if they belong to the same block, so a height _change_ between adjacent rows marks a boundary.

## Components

### `rows.ts` — `showHeight` flag on formatters

The height field occupies a fixed 8-char span in the 48-char row. Add an optional `showHeight` parameter (default `true`) to the row formatters; when `false`, the 8-char height span is rendered as 8 spaces, preserving the 48-char width.

- `rowText(event: SproutEvent, showHeight = true): string`
- `rowTextFor(row: DisplayRow, showHeight = true): string` — passes the flag through to `rowText` or `aggregatedRowText`
- `aggregatedRowText(row: AggregatedRow, showHeight: boolean): string` (internal)

Defaulting to `true` keeps every existing call site and existing test unchanged.

### `rows.ts` — `shouldShowHeight` helper

A pure, unit-testable predicate so the decision lives in `rows.ts`, not buried in `board.ts`:

```typescript
export function shouldShowHeight(
  prev: DisplayRow | undefined,
  cur: DisplayRow,
  isTopVisible: boolean
): boolean {
  return isTopVisible || prev === undefined || prev.height !== cur.height;
}
```

- `isTopVisible` — the topmost visible ledger row always shows its height (scrollback mitigation, see below).
- `prev === undefined` — the very first display row shows its height.
- `prev.height !== cur.height` — a height change marks a new block.

### `board.ts` — `renderLedger` threads the flag

For each visible ledger row `r` (0-based) at global index `i = r + scrollOffset`:

```typescript
const row = displayRows[i];
if (row) {
  const showHeight = shouldShowHeight(displayRows[i - 1], row, r === 0);
  ledger.setRow(r, rowTextFor(row, showHeight), instant);
} else {
  ledger.clearRow(r);
}
```

## Scrollback Mitigation

When scrolled back through history, the topmost visible row may be a block's continuation row. The `r === 0` term in `shouldShowHeight` forces the topmost visible row to always render its height, so the user never sees a screenful of blank-height rows with no block label in view.

## Behavior Notes

- Applies uniformly to XCH / CAT / NFT / DID rows — any continuation row blanks its height column.
- When a new block arrives and rows shift, the height flaps riffle between blank and digits via the existing flap animation — no special handling needed.
- No change to `metaFor`, click handling, scroll math, or the aggregation logic from the prior spec.

## Files Changed

| File                            | Change                                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| `web/src/themes/board/rows.ts`  | Add `showHeight` param to `rowText`/`rowTextFor`/`aggregatedRowText`; add `shouldShowHeight()` |
| `web/src/themes/board/board.ts` | Thread `shouldShowHeight()` result into `renderLedger`                                         |

No other files change.

## Testing

- `rowText(event, false)` and `rowTextFor(row, false)` — height span is blank, row is still 48 chars wide, all other fields intact; `showHeight` defaulting to `true` is unchanged from current output.
- `shouldShowHeight`:
  - top-visible row → `true` regardless of neighbors
  - `prev === undefined` → `true`
  - same height as `prev` → `false`
  - different height from `prev` → `true`
- `renderLedger` wiring covered by the browser smoke-test at `http://localhost:5173/?theme=board&demo=1`: heights appear only at block boundaries (and the top row); scrolling back keeps the topmost row's height visible.
