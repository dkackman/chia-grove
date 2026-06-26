# Board Per-Block Spend Aggregation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse XCH and CAT spends within each block into single aggregated rows on the board split-flap display, while leaving NFT and DID events as individual rows.

**Architecture:** Add `AggregatedRow`/`DisplayRow` types and a pure `toDisplayRows()` derivation function to `rows.ts`. `board.ts` recomputes `displayRows` from raw `events[]` on each dirty frame and renders from that instead of directly from events. Raw `events[]` remains the source of truth for reorg handling (unchanged).

**Tech Stack:** TypeScript, Vitest, Three.js (board.ts only)

## Global Constraints

- Node ≥ 24
- `BOARD_COLS = 48` — every row string must be exactly 48 chars wide
- Amount math must use `BigInt` (mojo strings can exceed JS safe integer range)
- No new dependencies
- Run tests with: `npx vitest run web/test/board-rows.test.ts`
- Run typecheck with: `npm run typecheck`

---

### Task 1: Aggregation types and functions in `rows.ts`

**Files:**

- Modify: `web/src/themes/board/glyphs.ts`
- Modify: `web/test/board-glyphs.test.ts`
- Modify: `web/src/themes/board/rows.ts`
- Modify: `web/test/board-rows.test.ts`

**Interfaces:**

- Produces:
  - `export interface AggregatedRow { type: "aggregated"; kind: "xch" | "cat"; height: number; totalMojos: bigint; count: number; assetId?: string; catName?: string; catTicker?: string; }`
  - `export type DisplayRow = AggregatedRow | SproutEvent`
  - `export function toDisplayRows(events: SproutEvent[]): DisplayRow[]`
  - `export function rowTextFor(row: DisplayRow): string`

The aggregated row's count marker uses `×` (U+00D7), which is not in the board's
glyph atlas. It must be added to `GLYPHS` first, or it renders as a blank cell.

---

- [ ] **Step 1: Add a failing test for the `×` glyph**

In `web/test/board-glyphs.test.ts`, find the first test:

```typescript
test("glyph table starts with space and fits the atlas", () => {
  expect(GLYPHS[0]).toBe(" ");
  expect(GLYPHS.length).toBeLessThanOrEqual(ATLAS_COLS * ATLAS_COLS);
  expect(GLYPHS).toContain("A");
  expect(GLYPHS).toContain("9");
  expect(GLYPHS).toContain("★");
});
```

Add a `×` assertion so it reads:

```typescript
test("glyph table starts with space and fits the atlas", () => {
  expect(GLYPHS[0]).toBe(" ");
  expect(GLYPHS.length).toBeLessThanOrEqual(ATLAS_COLS * ATLAS_COLS);
  expect(GLYPHS).toContain("A");
  expect(GLYPHS).toContain("9");
  expect(GLYPHS).toContain("★");
  expect(GLYPHS).toContain("×");
});
```

Also add a new test after it asserting `×` maps to a real (non-blank) glyph cell:

```typescript
test("charToGlyph maps the multiplication sign to a non-blank cell", () => {
  expect(charToGlyph("×")).not.toBe(0);
  expect(GLYPHS[charToGlyph("×")]).toBe("×");
});
```

- [ ] **Step 2: Run the glyph test to verify it fails**

```bash
npx vitest run web/test/board-glyphs.test.ts
```

Expected: the two `×` assertions fail (`GLYPHS` does not contain `×`; `charToGlyph("×")` returns 0).

- [ ] **Step 3: Add `×` to the glyph atlas**

In `web/src/themes/board/glyphs.ts`, find:

```typescript
export const GLYPHS = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-:▸★▮·";
```

Replace with:

```typescript
export const GLYPHS = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-:▸★▮·×";
```

- [ ] **Step 4: Run the glyph test to verify it passes**

```bash
npx vitest run web/test/board-glyphs.test.ts
```

Expected: all glyph tests pass.

- [ ] **Step 5: Add new imports to the rows test file**

Open `web/test/board-rows.test.ts`. The existing top two import lines are:

```typescript
import { expect, test } from "vitest";
import { BOARD_COLS, rowText } from "../src/themes/board/rows.js";
import type { SproutEvent } from "@grove/shared";
```

Replace those two import lines with:

```typescript
import { expect, test } from "vitest";
import { BOARD_COLS, rowText, rowTextFor, toDisplayRows } from "../src/themes/board/rows.js";
import type { AggregatedRow } from "../src/themes/board/rows.js";
import type { SproutEvent } from "@grove/shared";
```

(The existing `sprout()` helper and all existing tests remain unchanged below these imports.)

- [ ] **Step 6: Append new tests to `web/test/board-rows.test.ts`**

Add the following after all existing tests in the file:

```typescript
// --- toDisplayRows ---

test("empty events produces empty display rows", () => {
  expect(toDisplayRows([])).toEqual([]);
});

test("single xch spend becomes one aggregated row", () => {
  const rows = toDisplayRows([sprout({ kind: "xch", amount: "1000000000000", height: 200 })]);
  expect(rows).toHaveLength(1);
  expect(rows[0].type).toBe("aggregated");
  if (rows[0].type === "aggregated") {
    expect(rows[0].kind).toBe("xch");
    expect(rows[0].totalMojos).toBe(1000000000000n);
    expect(rows[0].count).toBe(1);
    expect(rows[0].height).toBe(200);
  }
});

test("two xch spends in same block merge into one aggregated row with summed mojos", () => {
  const events = [
    sprout({ kind: "xch", amount: "500000000000", height: 300 }),
    sprout({ kind: "xch", amount: "300000000000", height: 300 }),
  ];
  const rows = toDisplayRows(events);
  expect(rows).toHaveLength(1);
  expect(rows[0].type).toBe("aggregated");
  if (rows[0].type === "aggregated") {
    expect(rows[0].totalMojos).toBe(800000000000n);
    expect(rows[0].count).toBe(2);
  }
});

test("two different cat assets in same block produce two aggregated rows", () => {
  const events = [
    sprout({ kind: "cat", assetId: "aaa", catTicker: "SBX", amount: "1000", height: 400 }),
    sprout({ kind: "cat", assetId: "bbb", catTicker: "DBX", amount: "2000", height: 400 }),
  ];
  const rows = toDisplayRows(events);
  expect(rows).toHaveLength(2);
  expect(rows.every((r) => r.type === "aggregated")).toBe(true);
  const tickers = (rows as AggregatedRow[]).map((r) => r.catTicker);
  expect(tickers).toContain("SBX");
  expect(tickers).toContain("DBX");
});

test("same cat asset across two blocks produces two separate aggregated rows", () => {
  const events = [
    sprout({ kind: "cat", assetId: "aaa", catTicker: "SBX", amount: "1000", height: 501 }),
    sprout({ kind: "cat", assetId: "aaa", catTicker: "SBX", amount: "2000", height: 500 }),
  ];
  const rows = toDisplayRows(events);
  expect(rows).toHaveLength(2);
  expect(rows[0].type).toBe("aggregated");
  expect(rows[1].type).toBe("aggregated");
  if (rows[0].type === "aggregated" && rows[1].type === "aggregated") {
    expect(rows[0].height).toBe(501);
    expect(rows[1].height).toBe(500);
  }
});

test("nft and did events are always individual rows", () => {
  const events = [
    sprout({ kind: "nft", mint: true, height: 600 }),
    sprout({ kind: "did", height: 600 }),
  ];
  const rows = toDisplayRows(events);
  expect(rows).toHaveLength(2);
  expect(rows[0].type).toBe("sprout");
  expect(rows[1].type).toBe("sprout");
});

test("mixed block emits rows in order: xch agg, cat agg, nft, did", () => {
  const events = [
    sprout({ kind: "did", height: 700 }),
    sprout({ kind: "nft", mint: true, height: 700 }),
    sprout({ kind: "cat", assetId: "ccc", catTicker: "DBX", amount: "500", height: 700 }),
    sprout({ kind: "xch", amount: "1000000000000", height: 700 }),
  ];
  const rows = toDisplayRows(events);
  expect(rows).toHaveLength(4);
  expect(rows[0].type).toBe("aggregated");
  if (rows[0].type === "aggregated") expect(rows[0].kind).toBe("xch");
  expect(rows[1].type).toBe("aggregated");
  if (rows[1].type === "aggregated") expect(rows[1].kind).toBe("cat");
  expect(rows[2].type).toBe("sprout");
  if (rows[2].type === "sprout") expect(rows[2].kind).toBe("nft");
  expect(rows[3].type).toBe("sprout");
  if (rows[3].type === "sprout") expect(rows[3].kind).toBe("did");
});

// --- rowTextFor ---

test("rowTextFor aggregated xch row is exactly BOARD_COLS wide", () => {
  const rows = toDisplayRows([
    sprout({ kind: "xch", amount: "1500000000000", height: 5121 }),
    sprout({ kind: "xch", amount: "500000000000", height: 5121 }),
  ]);
  expect(rowTextFor(rows[0]).length).toBe(BOARD_COLS);
});

test("rowTextFor aggregated xch shows kind, summed amount, block, and count marker", () => {
  // 1.5 XCH + 0.5 XCH = 2 XCH total, count = 2
  const rows = toDisplayRows([
    sprout({ kind: "xch", amount: "1500000000000", height: 5121 }),
    sprout({ kind: "xch", amount: "500000000000", height: 5121 }),
  ]);
  const t = rowTextFor(rows[0]);
  expect(t).toContain("XCH");
  expect(t).toContain("2×"); // count marker
  expect(t).toContain("5121");
  expect(t).toContain("2"); // "2" XCH total
});

test("rowTextFor aggregated cat row is BOARD_COLS wide and shows ticker and count", () => {
  // 2 spends of SBX
  const rows = toDisplayRows([
    sprout({ kind: "cat", assetId: "aaa", catTicker: "SBX", amount: "1000", height: 800 }),
    sprout({ kind: "cat", assetId: "aaa", catTicker: "SBX", amount: "2000", height: 800 }),
  ]);
  const t = rowTextFor(rows[0]);
  expect(t.length).toBe(BOARD_COLS);
  expect(t).toContain("CAT");
  expect(t).toContain("SBX");
  expect(t).toContain("2×"); // 2 spends
  expect(t).toContain("800");
});

test("rowTextFor individual sprout row delegates to rowText", () => {
  const e = sprout({ kind: "nft", mint: true, height: 900 });
  const rows = toDisplayRows([e]);
  expect(rowTextFor(rows[0])).toBe(rowText(e));
});
```

- [ ] **Step 7: Run tests to verify they fail**

```bash
npx vitest run web/test/board-rows.test.ts
```

Expected: new tests fail with import errors (`toDisplayRows`, `rowTextFor`, `AggregatedRow` not exported). Existing tests still pass.

- [ ] **Step 8: Implement the new types and functions in `rows.ts`**

Replace the entire content of `web/src/themes/board/rows.ts` with:

```typescript
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
  return e.kind.toUpperCase();
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

/** One fixed-width ledger line for an individual spend. Fields sum to BOARD_COLS (48). */
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

    // NFT and DID — individual rows in arrival order
    for (const e of blockEvents) {
      if (e.kind === "nft" || e.kind === "did") rows.push(e);
    }
  }

  return rows;
}
```

- [ ] **Step 9: Run tests and verify all pass**

```bash
npx vitest run web/test/board-rows.test.ts web/test/board-glyphs.test.ts
```

Expected: all tests pass (both existing and new).

- [ ] **Step 10: Commit**

```bash
git add web/src/themes/board/rows.ts web/test/board-rows.test.ts web/src/themes/board/glyphs.ts web/test/board-glyphs.test.ts
git commit -m "feat: add DisplayRow aggregation types and toDisplayRows to board/rows.ts"
```

---

### Task 2: Wire `displayRows` into `board.ts`

**Files:**

- Modify: `web/src/themes/board/board.ts`

**Interfaces:**

- Consumes from Task 1:
  - `DisplayRow` (type import)
  - `toDisplayRows(events: SproutEvent[]): DisplayRow[]`
  - `rowTextFor(row: DisplayRow): string`
- No new exports — this is wiring only.

No new test file: `board.ts` integrates Three.js and is covered by the manual smoke-test in Step 8.

- [ ] **Step 1: Update imports**

In `web/src/themes/board/board.ts`, find:

```typescript
import { rowText, BOARD_COLS } from "./rows.js";
```

Replace with:

```typescript
import { rowTextFor, toDisplayRows, BOARD_COLS } from "./rows.js";
import type { DisplayRow } from "./rows.js";
```

- [ ] **Step 2: Add `displayRows` state variable**

Inside `startBoard`, find the three lines that declare the main state variables:

```typescript
const events: SproutEvent[] = []; // newest first, capped at HISTORY
let ledgerDirty = false;
let sproutsSinceFrame = 0;
```

Replace with:

```typescript
const events: SproutEvent[] = []; // newest first, capped at HISTORY
let displayRows: DisplayRow[] = [];
let ledgerDirty = false;
let sproutsSinceFrame = 0;
```

- [ ] **Step 3: Remove per-event scroll increment from the `"sprout"` handler**

Find the `"sprout"` case inside `feed.onEvent`:

```typescript
      case "sprout":
        events.unshift(event);
        if (events.length > HISTORY) events.pop();
        // when scrolled back, keep the same spends in view (don't yank to live)
        if (scrollOffset > 0) scrollOffset = Math.min(scrollOffset + 1, maxOffset());
        ledgerDirty = true;
        sproutsSinceFrame++;
        break;
```

Replace with:

```typescript
      case "sprout":
        events.unshift(event);
        if (events.length > HISTORY) events.pop();
        ledgerDirty = true;
        sproutsSinceFrame++;
        break;
```

(Scroll adjustment now happens in the frame loop after `displayRows` is recomputed using the actual display-row delta, not a fixed +1.)

- [ ] **Step 4: Update `maxOffset` to use `displayRows.length`**

Find:

```typescript
const maxOffset = () => Math.max(0, events.length - LEDGER_ROWS);
```

Replace with:

```typescript
const maxOffset = () => Math.max(0, displayRows.length - LEDGER_ROWS);
```

- [ ] **Step 5: Update `renderLedger` to use `displayRows` and `rowTextFor`**

Find:

```typescript
function renderLedger(instant: boolean): void {
  for (let r = 0; r < LEDGER_ROWS; r++) {
    const e = events[r + scrollOffset];
    if (e) {
      ledger.setRow(r, rowText(e), instant);
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
    const row = displayRows[r + scrollOffset];
    if (row) {
      ledger.setRow(r, rowTextFor(row), instant);
    } else {
      ledger.clearRow(r);
    }
  }
}
```

- [ ] **Step 6: Recompute `displayRows` in the frame loop and adjust scroll offset**

Find this block inside the `frame()` function:

```typescript
if (scrollOffset > maxOffset()) scrollOffset = maxOffset(); // a reorg may have shrunk history
const scrolled = scrollOffset !== lastRenderedOffset;
if (ledgerDirty || scrolled) {
  const wasIdle = ledger.idle();
  // scrubbing through history snaps instantly; live arrivals riffle
  renderLedger(scrolled || reducedMotion || sproutsSinceFrame > FAST_FORWARD);
  lastRenderedOffset = scrollOffset;
  ledgerDirty = false;
  if (!scrolled && (!wasIdle || !ledger.idle())) clatter.flap(Math.min(1, sproutsSinceFrame / 6));
  header.setLive(scrollOffset === 0);
}
```

Replace with:

```typescript
if (scrollOffset > maxOffset()) scrollOffset = maxOffset(); // a reorg may have shrunk history
const scrolled = scrollOffset !== lastRenderedOffset;
if (ledgerDirty || scrolled) {
  const wasIdle = ledger.idle();
  if (ledgerDirty) {
    const prevLen = displayRows.length;
    displayRows = toDisplayRows(events);
    // keep the same block in view when scrolled back
    if (scrollOffset > 0) {
      scrollOffset = Math.min(scrollOffset + displayRows.length - prevLen, maxOffset());
    }
    ledgerDirty = false;
  }
  // scrubbing through history snaps instantly; live arrivals riffle
  renderLedger(scrolled || reducedMotion || sproutsSinceFrame > FAST_FORWARD);
  lastRenderedOffset = scrollOffset;
  if (!scrolled && (!wasIdle || !ledger.idle())) clatter.flap(Math.min(1, sproutsSinceFrame / 6));
  header.setLive(scrollOffset === 0);
}
```

- [ ] **Step 7: Update `metaFor` to return `null` for aggregated rows**

Find:

```typescript
    metaFor: (object, instanceId) =>
      object === ledger.mesh && instanceId !== undefined
        ? events[scrollOffset + ledger.rowOf(instanceId)] ?? null
        : null,
```

Replace with:

```typescript
    metaFor: (object, instanceId) => {
      if (object !== ledger.mesh || instanceId === undefined) return null;
      const row = displayRows[scrollOffset + ledger.rowOf(instanceId)];
      return row?.type === "sprout" ? row : null;
    },
```

- [ ] **Step 8: Run full test suite and typecheck**

```bash
npm test && npm run typecheck
```

Expected: all tests pass, no type errors.

- [ ] **Step 9: Smoke-test in the browser**

```bash
npm run dev:web
```

Open `http://localhost:5173/?theme=board&demo=1`.

Verify:

- XCH rows are collapsed to one per block showing total XCH amount and `N×` count
- Each distinct CAT ticker gets one row per block showing `N×` count
- NFT and DID rows appear individually (unchanged)
- Scrolling back through history keeps the same block visible
- Clicking an aggregated row does nothing (no detail card appears)
- Clicking an NFT or DID row still opens the detail card

- [ ] **Step 10: Commit**

```bash
git add web/src/themes/board/board.ts
git commit -m "feat: aggregate XCH and CAT spends per block on the board display"
```
