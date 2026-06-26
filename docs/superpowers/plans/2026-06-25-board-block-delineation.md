# Board Block Delineation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make block boundaries obvious on the board by showing the block height only on each block's first row (and the topmost visible row), blanking it on continuation rows.

**Architecture:** Add an optional `showHeight` flag (default `true`) to the row formatters in `rows.ts` so the 8-char height span renders blank when false, plus a pure `shouldShowHeight()` predicate. `board.ts`'s `renderLedger` computes the flag per visible row from the previous display row's height and whether the row is topmost.

**Tech Stack:** TypeScript, Vitest, Three.js (board.ts only)

## Global Constraints

- Node ≥ 24
- Every row string must remain exactly `BOARD_COLS` (48) chars wide
- No new dependencies
- `showHeight` defaults to `true` so existing call sites and tests are unaffected
- Run tests with: `npx vitest run web/test/board-rows.test.ts`
- Run typecheck with: `npm run typecheck`

---

### Task 1: `showHeight` flag and `shouldShowHeight` helper in `rows.ts`

**Files:**

- Modify: `web/src/themes/board/rows.ts`
- Modify: `web/test/board-rows.test.ts`

**Interfaces:**

- Produces:
  - `export function rowText(event: SproutEvent, showHeight?: boolean): string` (param added, defaults `true`)
  - `export function rowTextFor(row: DisplayRow, showHeight?: boolean): string` (param added, defaults `true`)
  - `export function shouldShowHeight(prev: DisplayRow | undefined, cur: DisplayRow, isTopVisible: boolean): boolean`

- [ ] **Step 1: Write failing tests**

Append to `web/test/board-rows.test.ts` (the `sprout()` helper, `toDisplayRows`, `rowTextFor`, `BOARD_COLS`, and `AggregatedRow` are already imported/defined in this file). Add `shouldShowHeight` to the existing import from `../src/themes/board/rows.js`:

Find the current import line:

```typescript
import { BOARD_COLS, rowText, rowTextFor, toDisplayRows } from "../src/themes/board/rows.js";
```

Replace with:

```typescript
import {
  BOARD_COLS,
  rowText,
  rowTextFor,
  shouldShowHeight,
  toDisplayRows,
} from "../src/themes/board/rows.js";
```

Then append these tests at the end of the file:

```typescript
// --- showHeight flag ---

test("rowText with showHeight=false blanks the height span but stays 48 wide", () => {
  const e = sprout({ kind: "xch", amount: "1500000000000", height: 5121 });
  const shown = rowText(e, true);
  const hidden = rowText(e, false);
  expect(hidden.length).toBe(BOARD_COLS);
  expect(hidden).not.toContain("5121"); // height digits gone
  expect(hidden).toContain("XCH"); // other fields intact
  expect(hidden).toContain("CONFIRMED");
  // only the 8-char height span differs between shown and hidden
  expect(shown.length).toBe(hidden.length);
});

test("rowText defaults to showing the height", () => {
  const e = sprout({ kind: "xch", amount: "1500000000000", height: 5121 });
  expect(rowText(e)).toBe(rowText(e, true));
  expect(rowText(e)).toContain("5121");
});

test("rowTextFor with showHeight=false blanks the height on an aggregated row", () => {
  const rows = toDisplayRows([
    sprout({ kind: "cat", assetId: "aaa", catTicker: "SBX", amount: "1000", height: 8421 }),
    sprout({ kind: "cat", assetId: "aaa", catTicker: "SBX", amount: "2000", height: 8421 }),
  ]);
  const hidden = rowTextFor(rows[0], false);
  expect(hidden.length).toBe(BOARD_COLS);
  expect(hidden).not.toContain("8421");
  expect(hidden).toContain("SBX");
  expect(hidden).toContain("2×");
});

// --- shouldShowHeight ---

test("shouldShowHeight is true for the topmost visible row regardless of neighbor", () => {
  const rows = toDisplayRows([
    sprout({ kind: "xch", amount: "1000", height: 100 }),
    sprout({ kind: "xch", amount: "2000", height: 100 }),
  ]);
  // rows[1] has the same height as rows[0], but as the top visible row it still shows
  expect(shouldShowHeight(rows[0], rows[1], true)).toBe(true);
});

test("shouldShowHeight is true when prev is undefined", () => {
  const rows = toDisplayRows([sprout({ kind: "xch", amount: "1000", height: 100 })]);
  expect(shouldShowHeight(undefined, rows[0], false)).toBe(true);
});

test("shouldShowHeight is false for a continuation row (same height as prev)", () => {
  const rows = toDisplayRows([
    sprout({ kind: "cat", assetId: "aaa", catTicker: "SBX", amount: "1000", height: 100 }),
    sprout({ kind: "cat", assetId: "bbb", catTicker: "DBX", amount: "2000", height: 100 }),
  ]);
  // two distinct CATs in the same block → two rows, same height
  expect(shouldShowHeight(rows[0], rows[1], false)).toBe(false);
});

test("shouldShowHeight is true at a block boundary (height changes)", () => {
  const rows = toDisplayRows([
    sprout({ kind: "xch", amount: "1000", height: 101 }),
    sprout({ kind: "xch", amount: "2000", height: 100 }),
  ]);
  expect(shouldShowHeight(rows[0], rows[1], false)).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run web/test/board-rows.test.ts
```

Expected: new tests fail — `shouldShowHeight` is not exported, and `rowText`/`rowTextFor` ignore the second argument (so the `showHeight=false` tests fail because the height is still present).

- [ ] **Step 3: Add the `showHeight` parameter to `rowText`**

In `web/src/themes/board/rows.ts`, find:

```typescript
/** One fixed-width ledger line for an individual spend. Pure. Fields sum to BOARD_COLS (48). */
export function rowText(event: SproutEvent): string {
  return (
    padR(kindLabel(event), 3) +
    " ▸ " +
    padR(asset(event), 11) +
    " " +
    padL(amount(event), 11) +
    " " +
    padL(String(event.height), 8) +
    " " +
    padR(status(event), 9)
  );
}
```

Replace with:

```typescript
/** One fixed-width ledger line for an individual spend. Pure. Fields sum to BOARD_COLS (48). */
export function rowText(event: SproutEvent, showHeight = true): string {
  return (
    padR(kindLabel(event), 3) +
    " ▸ " +
    padR(asset(event), 11) +
    " " +
    padL(amount(event), 11) +
    " " +
    (showHeight ? padL(String(event.height), 8) : " ".repeat(8)) +
    " " +
    padR(status(event), 9)
  );
}
```

- [ ] **Step 4: Add the `showHeight` parameter to `aggregatedRowText` and `rowTextFor`**

In the same file, find:

```typescript
function aggregatedRowText(row: AggregatedRow): string {
  const kindStr = row.kind.toUpperCase();
  const assetStr = row.kind === "cat" ? (row.catTicker ?? row.catName ?? "CAT").toUpperCase() : "-";
  const amountStr =
    row.kind === "xch"
      ? clampFrac(mojosToXch(row.totalMojos.toString()), 4)
      : clampFrac(mojosToCAT(row.totalMojos.toString()), 3);
  const countStr = `${row.count}×`;

  return (
    padR(kindStr, 3) +
    " ▸ " +
    padR(assetStr, 11) +
    " " +
    padL(amountStr, 11) +
    " " +
    padL(String(row.height), 8) +
    " " +
    padR(countStr, 9)
  );
}

/** Render a DisplayRow to a fixed-width 48-char string. */
export function rowTextFor(row: DisplayRow): string {
  return row.type === "aggregated" ? aggregatedRowText(row) : rowText(row);
}
```

Replace with:

```typescript
function aggregatedRowText(row: AggregatedRow, showHeight: boolean): string {
  const kindStr = row.kind.toUpperCase();
  const assetStr = row.kind === "cat" ? (row.catTicker ?? row.catName ?? "CAT").toUpperCase() : "-";
  const amountStr =
    row.kind === "xch"
      ? clampFrac(mojosToXch(row.totalMojos.toString()), 4)
      : clampFrac(mojosToCAT(row.totalMojos.toString()), 3);
  const countStr = `${row.count}×`;

  return (
    padR(kindStr, 3) +
    " ▸ " +
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
export function rowTextFor(row: DisplayRow, showHeight = true): string {
  return row.type === "aggregated" ? aggregatedRowText(row, showHeight) : rowText(row, showHeight);
}

/**
 * Whether a visible ledger row should render its block height. The topmost
 * visible row always does (so a scrolled-back view never loses its label);
 * otherwise the height shows only at a block boundary (height differs from
 * the row above it).
 */
export function shouldShowHeight(
  prev: DisplayRow | undefined,
  cur: DisplayRow,
  isTopVisible: boolean
): boolean {
  return isTopVisible || prev === undefined || prev.height !== cur.height;
}
```

- [ ] **Step 5: Run tests and verify all pass**

```bash
npx vitest run web/test/board-rows.test.ts
```

Expected: all tests pass (existing and new).

- [ ] **Step 6: Commit**

```bash
git add web/src/themes/board/rows.ts web/test/board-rows.test.ts
git commit -m "feat: add showHeight flag and shouldShowHeight helper to board/rows.ts"
```

---

### Task 2: Thread `shouldShowHeight` into `board.ts`

**Files:**

- Modify: `web/src/themes/board/board.ts`

**Interfaces:**

- Consumes from Task 1:
  - `rowTextFor(row: DisplayRow, showHeight?: boolean): string`
  - `shouldShowHeight(prev: DisplayRow | undefined, cur: DisplayRow, isTopVisible: boolean): boolean`
- No new exports — wiring only.

No new test file: `board.ts` integrates Three.js and is covered by the manual smoke-test in Step 4.

- [ ] **Step 1: Update the import**

In `web/src/themes/board/board.ts`, find:

```typescript
import { rowTextFor, toDisplayRows, BOARD_COLS } from "./rows.js";
```

Replace with:

```typescript
import { rowTextFor, shouldShowHeight, toDisplayRows, BOARD_COLS } from "./rows.js";
```

- [ ] **Step 2: Compute and thread `showHeight` in `renderLedger`**

Find:

```typescript
function renderLedger(instant: boolean): void {
  for (let r = 0; r < LEDGER_ROWS; r++) {
    const row = displayRows[r + scrollOffset];
    if (row) {
      ledger.setRow(r, rowTextFor(row), instant);
    } else {
      ledger.clearRow(r);
    }
  }
}
```

Replace with:

```typescript
function renderLedger(instant: boolean): void {
  for (let r = 0; r < LEDGER_ROWS; r++) {
    const i = r + scrollOffset;
    const row = displayRows[i];
    if (row) {
      const showHeight = shouldShowHeight(displayRows[i - 1], row, r === 0);
      ledger.setRow(r, rowTextFor(row, showHeight), instant);
    } else {
      ledger.clearRow(r);
    }
  }
}
```

- [ ] **Step 3: Run full test suite and typecheck**

```bash
npm test && npm run typecheck
```

Expected: all tests pass, no type errors.

- [ ] **Step 4: Smoke-test in the browser**

```bash
npm run dev:web
```

Open `http://localhost:5173/?theme=board&demo=1`.

Verify:

- The block height appears only on the first row of each block; continuation rows show a blank height column.
- The topmost visible row always shows its height, even after scrolling back through history.
- Block boundaries are easy to spot (lit height flaps mark each new block).
- Heights riffle blank↔digits naturally as new blocks push rows down.

- [ ] **Step 5: Commit**

```bash
git add web/src/themes/board/board.ts
git commit -m "feat: show block height only at block boundaries on the board"
```
