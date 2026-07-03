# Board Block Detail View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user click a block height on the Big Board to see every individual spend in that block, step to adjacent blocks, jump to any historical block by height (via a find-block input, on both live and detail views), and share a link directly to a block's detail view — with real content filtering (including SafeSearch) applied to any historical NFT.

**Architecture:** A new `GET /block/:height` Fastify route reuses the existing ingest pipeline (`coinsetView` → `classifyBlock` → `ContentFilter.enrich`) to fetch and classify an arbitrary block on demand. On the client, the board theme gains a `live | detail` mode: detail mode fetches that JSON, renders the block's raw (unaggregated) `SproutEvent[]` into the same split-flap `FlapGrid` ledger used for live spends, and reflects the viewed height in the URL (`?block=`) via `history.pushState`. A small DOM overlay provides find-block, prev/next, and return-to-live controls. Column-aware hit testing in the shared picker lets a click on a row's height (as opposed to the rest of the row) trigger detail mode instead of the existing spend-detail card.

**Tech Stack:** TypeScript, Vitest, Fastify, Three.js (board.ts, picker.ts only)

**Spec:** `docs/superpowers/specs/2026-07-02-board-block-detail-view-design.md`

## Global Constraints

- Node ≥ 24
- `BOARD_COLS = 48` — every board ledger row string must be exactly 48 chars wide
- `HEIGHT_COLS = 8` — width of the height field within a row; single source of truth in `rows.ts`, reused by both row formatting and column-aware click detection
- Amount math uses `BigInt` for mojo strings (existing convention; unaffected by this feature)
- No new dependencies
- `PROTOCOL_VERSION` (`shared/src/index.ts`) is **not** bumped — `/block/:height` is a plain REST endpoint, not part of the WebSocket wire protocol
- This codebase's testing convention: DOM-heavy classes (`BlockConsole`, `initLegend`, and now `BoardNav`) are **not** unit-tested directly — pure logic is extracted into standalone functions and tested (see `formatBlockLine`, `resolveTheme`, `mempoolGauge`). Follow this pattern; don't introduce jsdom.
- Run server tests: `npx vitest run server/test/`
- Run web tests: `npx vitest run web/test/`
- Run everything: `npm test`
- Typecheck: `npm run typecheck`

---

### Task 1: `HEIGHT_COLS` constant in `rows.ts`

**Files:**

- Modify: `web/src/themes/board/rows.ts`
- Modify: `web/test/board-rows.test.ts`

**Interfaces:**

- Produces: `export const HEIGHT_COLS = 8;` — the width of the leading height field in a board row, consumed by Task 8 (`board.ts`) for column-aware click detection.

- [ ] **Step 1: Write a failing test**

Append to `web/test/board-rows.test.ts` (add `HEIGHT_COLS` to the existing import from `../src/themes/board/rows.js`):

```typescript
import {
  BOARD_COLS,
  HEIGHT_COLS,
  cardMetaFor,
  isBlockStart,
  rowText,
  rowTextFor,
  shouldShowHeight,
  toDisplayRows,
} from "../src/themes/board/rows.js";
```

Append this test at the end of the file:

```typescript
test("HEIGHT_COLS matches the width of the height field", () => {
  const e = sprout({ kind: "xch", amount: "1000", height: 5121 });
  const hidden = rowText(e, { showHeight: false });
  expect(hidden.slice(0, HEIGHT_COLS)).toBe(" ".repeat(HEIGHT_COLS));
  expect(hidden[HEIGHT_COLS]).toBe(" "); // the space separator right after the height field
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run web/test/board-rows.test.ts
```

Expected: FAIL — `HEIGHT_COLS` is not exported.

- [ ] **Step 3: Export the constant and use it in place of the literal `8`**

In `web/src/themes/board/rows.ts`, find:

```typescript
export const BOARD_COLS = 48;
```

Replace with:

```typescript
export const BOARD_COLS = 48;
export const HEIGHT_COLS = 8;
```

Find (in `rowText`):

```typescript
    (showHeight ? padR(String(event.height), 8) : " ".repeat(8)) +
```

Replace with:

```typescript
    (showHeight ? padR(String(event.height), HEIGHT_COLS) : " ".repeat(HEIGHT_COLS)) +
```

Find (in `aggregatedRowText`):

```typescript
    (showHeight ? padR(String(row.height), 8) : " ".repeat(8)) +
```

Replace with:

```typescript
    (showHeight ? padR(String(row.height), HEIGHT_COLS) : " ".repeat(HEIGHT_COLS)) +
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run web/test/board-rows.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/themes/board/rows.ts web/test/board-rows.test.ts
git commit -m "refactor: export HEIGHT_COLS from board/rows.ts"
```

---

### Task 2: Server — `GET /block/:height`

**Files:**

- Create: `server/src/web/block-lookup.ts`
- Create: `server/test/block-lookup.test.ts`
- Modify: `server/src/web/server.ts`
- Modify: `server/src/index.ts`

**Interfaces:**

- Produces:
  - `export interface BlockLookupDeps { rpc: RpcView; cats: CatRegistry; contentFilter: { enrich(events: GroveEvent[]): Promise<void> }; }`
  - `export function registerBlockLookup(app: FastifyInstance, deps: BlockLookupDeps, media: MediaIndex): void`
  - `buildServer(hub, media, logger, blockLookup?: BlockLookupDeps)` — new optional 4th parameter (existing 3-arg call sites keep working unchanged).
- Consumes: `RpcView` (`server/src/ingest/types.js`), `classifyBlock` (`server/src/classify/classify.js`), `CatRegistry` (`server/src/classify/cats.js`), `MediaIndex` (`server/src/web/media-index.js`), `GroveEvent`/`BlockEvent` (`@grove/shared`).

- [ ] **Step 1: Write the failing tests**

Create `server/test/block-lookup.test.ts`:

```typescript
import { expect, test, vi } from "vitest";
import fastify from "fastify";
import { Clvm, Simulator } from "chia-wallet-sdk";
import type { CoinSpend } from "chia-wallet-sdk";
import { registerBlockLookup } from "../src/web/block-lookup.js";
import type { BlockLookupDeps } from "../src/web/block-lookup.js";
import { MediaIndex } from "../src/web/media-index.js";
import { CatRegistry } from "../src/classify/cats.js";
import type { BlockInfo, RpcView } from "../src/ingest/types.js";
import type { GroveEvent } from "@grove/shared";

interface FakeBlock {
  headerHash: string;
  timestamp: bigint | null;
  spends: CoinSpend[];
}

class FakeRpc implements RpcView {
  blocks = new Map<number, FakeBlock>();

  set(
    height: number,
    opts: { headerHash?: string; timestamp: bigint | null; spends?: CoinSpend[] }
  ) {
    this.blocks.set(height, {
      headerHash: opts.headerHash ?? `h${height}`,
      timestamp: opts.timestamp,
      spends: opts.spends ?? [],
    });
  }

  async getState(): Promise<never> {
    throw new Error("not used by this route");
  }

  async getBlockInfo(height: number): Promise<BlockInfo> {
    const b = this.blocks.get(height);
    if (!b) throw new Error(`no block at ${height}`);
    return { height, headerHash: b.headerHash, prevHash: "", timestamp: b.timestamp, fees: 25n };
  }

  async getSpends(headerHash: string): Promise<CoinSpend[]> {
    for (const b of this.blocks.values()) if (b.headerHash === headerHash) return b.spends;
    return [];
  }
}

function deps(rpc: RpcView, enrich = vi.fn(async () => {})): BlockLookupDeps {
  return { rpc, cats: new CatRegistry(), contentFilter: { enrich } };
}

test("GET /block/:height with a non-numeric height → 400", async () => {
  const app = fastify();
  registerBlockLookup(app, deps(new FakeRpc()), new MediaIndex(10));
  const res = await app.inject({ method: "GET", url: "/block/abc" });
  expect(res.statusCode).toBe(400);
  await app.close();
});

test("GET /block/:height with a negative height → 400", async () => {
  const app = fastify();
  registerBlockLookup(app, deps(new FakeRpc()), new MediaIndex(10));
  const res = await app.inject({ method: "GET", url: "/block/-5" });
  expect(res.statusCode).toBe(400);
  await app.close();
});

test("a non-transaction block (null timestamp) returns a zero-spend block event", async () => {
  const rpc = new FakeRpc();
  rpc.set(100, { timestamp: null });
  const app = fastify();
  registerBlockLookup(app, deps(rpc), new MediaIndex(10));
  const res = await app.inject({ method: "GET", url: "/block/100" });
  expect(res.statusCode).toBe(200);
  const body = res.json() as { events: GroveEvent[] };
  expect(body.events).toEqual([
    { type: "block", height: 100, headerHash: "", timestamp: 0, spendCount: 0, fees: "0" },
  ]);
  await app.close();
});

test("an RPC failure (height beyond the chain tip) returns a zero-spend block event, not an error", async () => {
  const rpc = new FakeRpc(); // nothing registered at 999
  const app = fastify();
  registerBlockLookup(app, deps(rpc), new MediaIndex(10));
  const res = await app.inject({ method: "GET", url: "/block/999" });
  expect(res.statusCode).toBe(200);
  const body = res.json() as { events: GroveEvent[] };
  expect(body.events[0]).toMatchObject({ type: "block", height: 999, spendCount: 0 });
  await app.close();
});

test("a transaction block with a real spend classifies it and calls contentFilter.enrich", async () => {
  const sim = new Simulator();
  const clvm = new Clvm();
  const alice = sim.bls(1000n);
  clvm.spendStandardCoin(
    alice.coin,
    alice.pk,
    clvm.delegatedSpend([clvm.createCoin(alice.puzzleHash, 1000n)])
  );
  const rpc = new FakeRpc();
  rpc.set(200, { timestamp: 1_700_000_000n, spends: clvm.coinSpends() });
  const enrich = vi.fn(async () => {});
  const app = fastify();
  registerBlockLookup(app, deps(rpc, enrich), new MediaIndex(10));
  const res = await app.inject({ method: "GET", url: "/block/200" });
  expect(res.statusCode).toBe(200);
  const body = res.json() as { events: GroveEvent[] };
  expect(body.events[0]).toMatchObject({ type: "block", height: 200, spendCount: 1 });
  expect(body.events[1]).toMatchObject({ type: "sprout", kind: "xch", height: 200 });
  expect(enrich).toHaveBeenCalledTimes(1);
  await app.close();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run server/test/block-lookup.test.ts
```

Expected: FAIL with a module-not-found error (`../src/web/block-lookup.js` doesn't exist yet).

- [ ] **Step 3: Implement `block-lookup.ts`**

Create `server/src/web/block-lookup.ts`:

```typescript
import type { FastifyInstance } from "fastify";
import type { BlockEvent, GroveEvent } from "@grove/shared";
import type { RpcView } from "../ingest/types.js";
import type { CatRegistry } from "../classify/cats.js";
import type { MediaIndex } from "./media-index.js";
import { classifyBlock } from "../classify/classify.js";

export interface BlockLookupDeps {
  rpc: RpcView;
  cats: CatRegistry;
  /** Only `enrich` is used — a real `ContentFilter` satisfies this structurally. */
  contentFilter: { enrich(events: GroveEvent[]): Promise<void> };
}

function emptyBlockEvent(height: number): BlockEvent {
  return { type: "block", height, headerHash: "", timestamp: 0, spendCount: 0, fees: "0" };
}

/**
 * GET /block/:height — fetches and classifies an arbitrary historical block on
 * demand, for the board theme's block-detail view. Reuses the exact classify +
 * content-filter pipeline live ingest uses (server/src/index.ts), so a
 * historical NFT gets the same cheap-signal + SafeSearch treatment as a live
 * one — including a real (paid) Vision check and persisted verdict if it
 * hasn't been checked before.
 *
 * Non-transaction blocks and out-of-range/unknown heights both collapse to a
 * zero-spend response rather than an error — the client renders both the same
 * way it renders any block with no grove-relevant activity.
 */
export function registerBlockLookup(
  app: FastifyInstance,
  deps: BlockLookupDeps,
  media: MediaIndex
): void {
  app.get<{ Params: { height: string } }>("/block/:height", async (request, reply) => {
    const raw = request.params.height;
    if (!/^\d+$/.test(raw)) {
      reply.code(400);
      return { error: "invalid height" };
    }
    const height = Number(raw);
    if (!Number.isSafeInteger(height)) {
      reply.code(400);
      return { error: "invalid height" };
    }

    let info;
    try {
      info = await deps.rpc.getBlockInfo(height);
    } catch {
      return { events: [emptyBlockEvent(height)] };
    }
    if (info.timestamp === null) {
      return { events: [emptyBlockEvent(height)] };
    }

    const spends = await deps.rpc.getSpends(info.headerHash);
    const events = classifyBlock(
      {
        height,
        headerHash: info.headerHash,
        timestamp: Number(info.timestamp),
        fees: info.fees ?? 0n,
        spends,
      },
      deps.cats,
      media
    );
    await deps.contentFilter.enrich(events);
    return { events };
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run server/test/block-lookup.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Wire the route into `buildServer`**

In `server/src/web/server.ts`, find:

```typescript
import type { Hub, WireSocket } from "./hub.js";
import { registerImageProxy } from "./img-proxy.js";
import type { MediaIndex } from "./media-index.js";
```

Replace with:

```typescript
import type { Hub, WireSocket } from "./hub.js";
import { registerImageProxy } from "./img-proxy.js";
import { registerBlockLookup, type BlockLookupDeps } from "./block-lookup.js";
import type { MediaIndex } from "./media-index.js";
```

Find:

```typescript
export async function buildServer(
  hub: Hub,
  media: MediaIndex,
  logger: Logger
): Promise<FastifyInstance> {
```

Replace with:

```typescript
export async function buildServer(
  hub: Hub,
  media: MediaIndex,
  logger: Logger,
  blockLookup?: BlockLookupDeps
): Promise<FastifyInstance> {
```

Find:

```typescript
registerImageProxy(app, media);
```

Replace with:

```typescript
registerImageProxy(app, media);
if (blockLookup) registerBlockLookup(app, blockLookup, media);
```

- [ ] **Step 6: Wire real dependencies in `index.ts`**

In `server/src/index.ts`, find:

```typescript
const poller = new CoinsetPoller(
  coinsetView(RpcClient.mainnet()),
  {
```

Replace with:

```typescript
const rpcView = coinsetView(RpcClient.mainnet());

const poller = new CoinsetPoller(
  rpcView,
  {
```

Find:

```typescript
const app = await buildServer(hub, media, log);
```

Replace with:

```typescript
const app = await buildServer(hub, media, log, { rpc: rpcView, cats, contentFilter });
```

- [ ] **Step 7: Run the full server test suite and typecheck**

```bash
npx vitest run server/test/
npm run typecheck
```

Expected: all server tests pass (including the pre-existing `server.test.ts` and `img-proxy.test.ts`, whose 3-arg `buildServer` calls are unaffected), no type errors.

- [ ] **Step 8: Commit**

```bash
git add server/src/web/block-lookup.ts server/test/block-lookup.test.ts server/src/web/server.ts server/src/index.ts
git commit -m "feat: add GET /block/:height for on-demand historical block lookup"
```

---

### Task 3: Web — URL state (`?block=`)

**Files:**

- Create: `web/src/themes/board/url-state.ts`
- Create: `web/test/board-url-state.test.ts`

**Interfaces:**

- Produces:
  - `export function readBlockParam(search: string): number | null` — pure, consumed by Task 8.
  - `export function writeBlockParam(height: number | null): void` — impure (DOM `location`/`history`); not unit-tested, per this codebase's convention (mirrors `switchTheme` in `themes/index.ts`).

- [ ] **Step 1: Write the failing tests**

Create `web/test/board-url-state.test.ts`:

```typescript
import { expect, test } from "vitest";
import { readBlockParam } from "../src/themes/board/url-state.js";

test("reads a valid block height from the query string", () => {
  expect(readBlockParam("?theme=board&block=1234567")).toBe(1234567);
});

test("returns null when block is absent", () => {
  expect(readBlockParam("?theme=board")).toBeNull();
  expect(readBlockParam("")).toBeNull();
});

test("returns null for a non-integer or negative value", () => {
  expect(readBlockParam("?block=abc")).toBeNull();
  expect(readBlockParam("?block=-5")).toBeNull();
  expect(readBlockParam("?block=1.5")).toBeNull();
});

test("block=0 is a valid height", () => {
  expect(readBlockParam("?block=0")).toBe(0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run web/test/board-url-state.test.ts
```

Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement `url-state.ts`**

Create `web/src/themes/board/url-state.ts`:

```typescript
/** Reads the `block` height from a URL search string, or null if absent/invalid. Pure. */
export function readBlockParam(search: string): number | null {
  const raw = new URLSearchParams(search).get("block");
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** Reflects (or clears) the detail-mode block height in the URL, preserving other params. */
export function writeBlockParam(height: number | null): void {
  const url = new URL(location.href);
  if (height === null) url.searchParams.delete("block");
  else url.searchParams.set("block", String(height));
  history.pushState(null, "", url.toString());
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run web/test/board-url-state.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/themes/board/url-state.ts web/test/board-url-state.test.ts
git commit -m "feat: add board block URL state helpers"
```

---

### Task 4: Web — `BlockDetail` fetch/state controller

**Files:**

- Create: `web/src/themes/board/detail.ts`
- Create: `web/test/board-detail.test.ts`

**Interfaces:**

- Produces:
  - `export type DetailStatus = "loading" | "loaded" | "empty" | "error"`
  - `export interface DetailState { status: DetailStatus; height: number; rows: SproutEvent[]; spendCount: number; fees: string; }`
  - `export type BlockFetcher = (height: number) => Promise<{ events: GroveEvent[] }>`
  - `export class BlockDetail { constructor(fetchBlock: BlockFetcher, onChange: (state: DetailState) => void); get currentHeight(): number; load(height: number): Promise<void>; }`
- Consumed by Task 5 (`header.ts` imports `DetailStatus`) and Task 8 (`board.ts` wires `BlockDetail` into the scene).

- [ ] **Step 1: Write the failing tests**

Create `web/test/board-detail.test.ts`:

```typescript
import { expect, test, vi } from "vitest";
import { BlockDetail } from "../src/themes/board/detail.js";
import type { DetailState } from "../src/themes/board/detail.js";
import type { GroveEvent } from "@grove/shared";

function sprout(height: number): GroveEvent {
  return { type: "sprout", kind: "xch", height, coinId: "00".repeat(32), amount: "1000" };
}

test("load() reports loading, then loaded with rows and block stats", async () => {
  const states: DetailState[] = [];
  const detail = new BlockDetail(
    async (height) => ({
      events: [
        { type: "block", height, headerHash: "aa", timestamp: 1, spendCount: 2, fees: "50" },
        sprout(height),
        sprout(height),
      ],
    }),
    (s) => states.push(s)
  );
  await detail.load(500);
  expect(states.map((s) => s.status)).toEqual(["loading", "loaded"]);
  expect(states[1].rows).toHaveLength(2);
  expect(states[1].spendCount).toBe(2);
  expect(states[1].fees).toBe("50");
  expect(states[1].height).toBe(500);
});

test("a block with no sprout events reports empty, not loaded", async () => {
  const states: DetailState[] = [];
  const detail = new BlockDetail(
    async (height) => ({
      events: [{ type: "block", height, headerHash: "aa", timestamp: 1, spendCount: 0, fees: "0" }],
    }),
    (s) => states.push(s)
  );
  await detail.load(500);
  expect(states.at(-1)!.status).toBe("empty");
  expect(states.at(-1)!.rows).toEqual([]);
});

test("a fetch failure reports error", async () => {
  const states: DetailState[] = [];
  const detail = new BlockDetail(
    async () => {
      throw new Error("network down");
    },
    (s) => states.push(s)
  );
  await detail.load(500);
  expect(states.map((s) => s.status)).toEqual(["loading", "error"]);
});

test("currentHeight reflects the most recently requested height", async () => {
  const detail = new BlockDetail(
    async (height) => ({
      events: [{ type: "block", height, headerHash: "", timestamp: 1, spendCount: 0, fees: "0" }],
    }),
    () => {}
  );
  await detail.load(700);
  expect(detail.currentHeight).toBe(700);
});

test("a stale response is dropped when a newer load supersedes it before it resolves", async () => {
  const states: DetailState[] = [];
  let resolveFirst!: (v: { events: GroveEvent[] }) => void;
  const fetchBlock = vi
    .fn()
    .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
    .mockImplementationOnce(async (height: number) => ({
      events: [
        { type: "block", height, headerHash: "", timestamp: 1, spendCount: 1, fees: "0" },
        sprout(height),
      ],
    }));
  const detail = new BlockDetail(fetchBlock, (s) => states.push(s));

  const first = detail.load(100); // stays pending until resolveFirst() is called
  await detail.load(200); // resolves immediately, supersedes 100
  resolveFirst!({
    events: [
      { type: "block", height: 100, headerHash: "", timestamp: 1, spendCount: 0, fees: "0" },
    ],
  });
  await first;

  // 100's late resolution must not overwrite the now-current view of block 200
  expect(states.map((s) => `${s.status}:${s.height}`)).toEqual([
    "loading:100",
    "loading:200",
    "loaded:200",
  ]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run web/test/board-detail.test.ts
```

Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement `detail.ts`**

Create `web/src/themes/board/detail.ts`:

```typescript
import type { BlockEvent, GroveEvent, SproutEvent } from "@grove/shared";

export type DetailStatus = "loading" | "loaded" | "empty" | "error";

export interface DetailState {
  status: DetailStatus;
  height: number;
  rows: SproutEvent[];
  spendCount: number;
  fees: string;
}

export type BlockFetcher = (height: number) => Promise<{ events: GroveEvent[] }>;

/**
 * Fetches and tracks a single historical block's spends for the board's
 * detail view. Guards against out-of-order responses: if `load` is called
 * again before an in-flight fetch resolves, the stale response is dropped.
 */
export class BlockDetail {
  private height = -1;
  private requestId = 0;

  constructor(
    private readonly fetchBlock: BlockFetcher,
    private readonly onChange: (state: DetailState) => void
  ) {}

  get currentHeight(): number {
    return this.height;
  }

  async load(height: number): Promise<void> {
    this.height = height;
    const id = ++this.requestId;
    this.onChange({ status: "loading", height, rows: [], spendCount: 0, fees: "0" });

    let payload: { events: GroveEvent[] };
    try {
      payload = await this.fetchBlock(height);
    } catch {
      if (id !== this.requestId) return; // superseded by a newer nav
      this.onChange({ status: "error", height, rows: [], spendCount: 0, fees: "0" });
      return;
    }
    if (id !== this.requestId) return; // superseded by a newer nav

    const block = payload.events.find((e): e is BlockEvent => e.type === "block");
    const rows = payload.events.filter((e): e is SproutEvent => e.type === "sprout");
    this.onChange({
      status: rows.length === 0 ? "empty" : "loaded",
      height,
      rows,
      spendCount: block?.spendCount ?? 0,
      fees: block?.fees ?? "0",
    });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run web/test/board-detail.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/themes/board/detail.ts web/test/board-detail.test.ts
git commit -m "feat: add BlockDetail fetch/state controller for the board detail view"
```

---

### Task 5: Web — `Header` block-detail variant

**Files:**

- Modify: `web/src/themes/board/header.ts`
- Modify: `web/test/board-header.test.ts`

**Interfaces:**

- Consumes: `DetailStatus` (Task 4, `./detail.js`).
- Produces:
  - `export function detailBlockLabel(height: number, status: DetailStatus, spendCount: number, fees: string): string`
  - `export type HeaderMode = "live" | "history" | "detail"`
  - `export function statusRowText(mode: HeaderMode, clockText: string): string`
  - `Header.setDetail(height: number, status: DetailStatus, spendCount: number, fees: string): void` — new method, consumed by Task 8.

- [ ] **Step 1: Write the failing tests**

Append to `web/test/board-header.test.ts` (add the new imports alongside the existing one):

```typescript
import { detailBlockLabel, mempoolGauge, statusRowText } from "../src/themes/board/header.js";
```

Append these tests at the end of the file:

```typescript
test("detailBlockLabel shows spend count and fees when loaded", () => {
  expect(detailBlockLabel(1234567, "loaded", 5, "1000")).toBe(
    "BLOCK 1234567   5 SPENDS   1000 MOJO FEES"
  );
});

test("detailBlockLabel shows a status message for non-loaded states", () => {
  expect(detailBlockLabel(100, "empty", 0, "0")).toBe("BLOCK 100   NO SPENDS THIS BLOCK");
  expect(detailBlockLabel(100, "loading", 0, "0")).toBe("BLOCK 100   LOADING…");
  expect(detailBlockLabel(100, "error", 0, "0")).toBe("BLOCK 100   COULD NOT LOAD");
});

test("statusRowText shows LIVE, HISTORY, or DETAIL depending on mode", () => {
  expect(statusRowText("live", "01:02:03")).toBe("01:02:03   LIVE");
  expect(statusRowText("history", "01:02:03")).toBe("01:02:03   ★ HISTORY · SCROLL UP FOR LIVE");
  expect(statusRowText("detail", "01:02:03")).toBe("01:02:03   ★ BLOCK DETAIL");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run web/test/board-header.test.ts
```

Expected: FAIL — `detailBlockLabel`/`statusRowText` are not exported.

- [ ] **Step 3: Implement the changes in `header.ts`**

Replace the entire content of `web/src/themes/board/header.ts` with:

```typescript
import * as THREE from "three";
import { FlapGrid } from "./flapgrid.js";
import { BOARD_COLS } from "./rows.js";
import type { DetailStatus } from "./detail.js";

const padR = (s: string, n: number) => s.slice(0, n).padEnd(n);

/** A `▮`/`·` fill bar `width` chars wide. Pure. */
export function mempoolGauge(size: number, width: number, full = 5000): string {
  const raw = Math.round(Math.min(1, size / full) * width);
  const filled = Number.isFinite(raw) ? Math.max(0, Math.min(width, raw)) : 0;
  return "▮".repeat(filled) + "·".repeat(width - filled);
}

/** Pretty-print a netspace byte count (string) as e.g. "38.2 EIB". */
function netspaceText(bytes: string): string {
  const units = ["B", "KIB", "MIB", "GIB", "TIB", "PIB", "EIB"];
  let v = Number(bytes);
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(1)} ${units[u]}`;
}

const clock = (d: Date) =>
  [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");

/** Row-0 text for the header's block-detail variant. Pure. */
export function detailBlockLabel(
  height: number,
  status: DetailStatus,
  spendCount: number,
  fees: string
): string {
  switch (status) {
    case "loaded":
      return `BLOCK ${height}   ${spendCount} SPENDS   ${fees} MOJO FEES`;
    case "empty":
      return `BLOCK ${height}   NO SPENDS THIS BLOCK`;
    case "loading":
      return `BLOCK ${height}   LOADING…`;
    case "error":
      return `BLOCK ${height}   COULD NOT LOAD`;
  }
}

export type HeaderMode = "live" | "history" | "detail";

/** Row-2 (clock + status) text. Pure. */
export function statusRowText(mode: HeaderMode, clockText: string): string {
  const status =
    mode === "detail"
      ? "★ BLOCK DETAIL"
      : mode === "history"
        ? "★ HISTORY · SCROLL UP FOR LIVE"
        : "LIVE";
  return `${clockText}   ${status}`;
}

export class Header {
  private readonly grid: FlapGrid;
  private clockText = "00:00:00";
  private mode: HeaderMode = "live";

  constructor(scene: THREE.Scene, atlas: THREE.CanvasTexture, opts: { originY?: number } = {}) {
    // 3 rows sitting above the ledger; the ledger sets its own originY below this.
    this.grid = new FlapGrid(scene, atlas, 3, BOARD_COLS, { originY: opts.originY ?? 7 });
    this.grid.setRow(0, padR("THE BIG BOARD", BOARD_COLS), true);
  }

  setBlock(height: number, spendCount: number, fees: string): void {
    this.grid.setRow(
      0,
      padR(`BLOCK ${height}   ${spendCount} SPENDS   ${fees} MOJO FEES`, BOARD_COLS)
    );
  }

  setAmbient(mempoolSize: number, netspace: string): void {
    this.grid.setRow(
      1,
      padR(
        `MEMPOOL [${mempoolGauge(mempoolSize, 12)}]   NETSPACE ${netspaceText(netspace)}`,
        BOARD_COLS
      )
    );
  }

  /** Switches the header into block-detail mode and shows that block's own stats. */
  setDetail(height: number, status: DetailStatus, spendCount: number, fees: string): void {
    this.grid.setRow(0, padR(detailBlockLabel(height, status, spendCount, fees), BOARD_COLS));
    this.mode = "detail";
    this.renderStatusRow();
  }

  tick(date: Date): void {
    this.clockText = clock(date);
    this.renderStatusRow();
  }

  /** LIVE when following the newest spends; a HISTORY marker when scrolled back. */
  setLive(live: boolean): void {
    const mode: HeaderMode = live ? "live" : "history";
    if (this.mode === mode) return;
    this.mode = mode;
    this.renderStatusRow();
  }

  private renderStatusRow(): void {
    this.grid.setRow(2, padR(statusRowText(this.mode, this.clockText), BOARD_COLS));
  }

  update(dt: number): void {
    this.grid.update(dt);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run web/test/board-header.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/themes/board/header.ts web/test/board-header.test.ts
git commit -m "feat: add block-detail header variant to board Header"
```

---

### Task 6: Web — `BoardNav` DOM overlay (find-block / prev / next / return-to-live)

**Files:**

- Create: `web/src/themes/board/block-nav.ts`
- Create: `web/test/board-nav.test.ts`
- Modify: `web/index.html`
- Modify: `web/src/style.css`

**Interfaces:**

- Produces:
  - `export function parseHeightInput(raw: string): number | null` — pure, tested directly.
  - `export interface BoardNavCallbacks { onFind(height: number): void; onPrev(): void; onNext(): void; onReturnToLive(): void; }`
  - `export class BoardNav { constructor(root: HTMLElement, callbacks: BoardNavCallbacks); setMode(mode: "live" | "detail"): void; }` — not unit-tested (DOM wiring; matches `BlockConsole`/`initLegend` convention), consumed by Task 8.

- [ ] **Step 1: Write the failing tests**

Create `web/test/board-nav.test.ts`:

```typescript
import { expect, test } from "vitest";
import { parseHeightInput } from "../src/themes/board/block-nav.js";

test("parses a plain integer height", () => {
  expect(parseHeightInput("1234567")).toBe(1234567);
});

test("trims surrounding whitespace", () => {
  expect(parseHeightInput("  1234567  ")).toBe(1234567);
});

test("rejects non-numeric input", () => {
  expect(parseHeightInput("abc")).toBeNull();
  expect(parseHeightInput("")).toBeNull();
  expect(parseHeightInput("12.5")).toBeNull();
  expect(parseHeightInput("-5")).toBeNull();
});

test("0 is a valid height", () => {
  expect(parseHeightInput("0")).toBe(0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run web/test/board-nav.test.ts
```

Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement `block-nav.ts`**

Create `web/src/themes/board/block-nav.ts`:

```typescript
const HEIGHT_RE = /^\d+$/;

/** Parses a find-block text input into a valid, non-negative integer height, or null. Pure. */
export function parseHeightInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!HEIGHT_RE.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) ? n : null;
}

export interface BoardNavCallbacks {
  onFind(height: number): void;
  onPrev(): void;
  onNext(): void;
  onReturnToLive(): void;
}

/**
 * DOM overlay for the board's block navigation: a find-block input (always
 * visible) plus prev/next/return-to-live controls (shown only in detail mode).
 */
export class BoardNav {
  private readonly input: HTMLInputElement;
  private readonly prevBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly liveBtn: HTMLButtonElement;

  constructor(root: HTMLElement, callbacks: BoardNavCallbacks) {
    const form = document.createElement("form");
    form.id = "board-nav-find";

    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.inputMode = "numeric";
    this.input.placeholder = "block height";
    this.input.autocomplete = "off";

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = "go";

    form.append(this.input, submit);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const height = parseHeightInput(this.input.value);
      if (height !== null) callbacks.onFind(height);
    });

    this.prevBtn = document.createElement("button");
    this.prevBtn.type = "button";
    this.prevBtn.textContent = "◀ prev";
    this.prevBtn.addEventListener("click", () => callbacks.onPrev());

    this.nextBtn = document.createElement("button");
    this.nextBtn.type = "button";
    this.nextBtn.textContent = "next ▶";
    this.nextBtn.addEventListener("click", () => callbacks.onNext());

    this.liveBtn = document.createElement("button");
    this.liveBtn.type = "button";
    this.liveBtn.textContent = "return to live";
    this.liveBtn.addEventListener("click", () => callbacks.onReturnToLive());

    const controls = document.createElement("div");
    controls.id = "board-nav-controls";
    controls.append(this.prevBtn, this.nextBtn, this.liveBtn);

    root.append(form, controls);
    this.setMode("live");
  }

  setMode(mode: "live" | "detail"): void {
    this.prevBtn.hidden = mode !== "detail";
    this.nextBtn.hidden = mode !== "detail";
    this.liveBtn.hidden = mode !== "detail";
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run web/test/board-nav.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Add the DOM anchor to `index.html`**

In `web/index.html`, find:

```html
<div id="console" hidden></div>
```

Replace with:

```html
<div id="console" hidden></div>
<div id="board-nav" hidden></div>
```

- [ ] **Step 6: Add styling to `style.css`**

Append to the end of `web/src/style.css`:

```css
#board-nav {
  position: fixed;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 8px 14px;
  border-radius: 10px;
  background: rgba(4, 17, 10, 0.78);
  border: 1px solid rgba(61, 220, 132, 0.2);
  backdrop-filter: blur(6px);
  font:
    12px/1.4 ui-monospace,
    monospace;
  color: #b9ffd9;
}

#board-nav-find {
  display: flex;
  gap: 6px;
}

#board-nav-find input {
  width: 110px;
  background: rgba(4, 17, 10, 0.9);
  color: #eafff2;
  border: 1px solid rgba(61, 220, 132, 0.35);
  border-radius: 6px;
  font: inherit;
  padding: 3px 6px;
}

#board-nav-find button,
#board-nav-controls button {
  background: none;
  border: 1px solid rgba(61, 220, 132, 0.35);
  border-radius: 6px;
  color: #eafff2;
  font: inherit;
  padding: 3px 8px;
  cursor: pointer;
}

#board-nav-controls {
  display: flex;
  gap: 8px;
}
```

- [ ] **Step 7: Commit**

```bash
git add web/src/themes/board/block-nav.ts web/test/board-nav.test.ts web/index.html web/src/style.css
git commit -m "feat: add BoardNav find-block/prev/next/return-to-live overlay"
```

---

### Task 7: Web — column-aware picking (`types.ts` + `picker.ts`)

**Files:**

- Modify: `web/src/themes/types.ts`
- Modify: `web/src/ui/picker.ts`
- Create: `web/test/picker.test.ts`

**Interfaces:**

- Produces on `VisualizationHandle`:
  - `pickHeight?(object: THREE.Object3D, instanceId: number | undefined): number | null`
  - `selectHeight?(height: number): void`
- Produces: `export function hitKey(hit: { object: THREE.Object3D; instanceId: number | undefined } | null): string` — pure, tested directly.
- Consumed by Task 8 (`board.ts` implements `pickHeight`/`selectHeight`).

This is a generic, theme-agnostic extension — the other four themes (`grove`, `farm`, `gallery`, `mine`) don't implement `pickHeight`/`selectHeight`, so their behavior is unchanged (`viz.pickHeight?.(...)` is `undefined` for them, and `intersect()` falls through to the existing `meta`-only path).

- [ ] **Step 1: Write the failing test**

Create `web/test/picker.test.ts`:

```typescript
import { expect, test } from "vitest";
import * as THREE from "three";
import { hitKey } from "../src/ui/picker.js";

test("null hit has an empty key", () => {
  expect(hitKey(null)).toBe("");
});

test("same object and instanceId produce the same key", () => {
  const mesh = new THREE.Mesh();
  expect(hitKey({ object: mesh, instanceId: 5 })).toBe(hitKey({ object: mesh, instanceId: 5 }));
});

test("different instanceIds on the same object produce different keys", () => {
  const mesh = new THREE.Mesh();
  expect(hitKey({ object: mesh, instanceId: 5 })).not.toBe(hitKey({ object: mesh, instanceId: 6 }));
});

test("different objects produce different keys even with the same instanceId", () => {
  const a = new THREE.Mesh();
  const b = new THREE.Mesh();
  expect(hitKey({ object: a, instanceId: 1 })).not.toBe(hitKey({ object: b, instanceId: 1 }));
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run web/test/picker.test.ts
```

Expected: FAIL — `hitKey` is not exported.

- [ ] **Step 3: Add the new hooks to `VisualizationHandle`**

In `web/src/themes/types.ts`, find:

```typescript
export interface VisualizationHandle {
  camera: THREE.PerspectiveCamera;
  onFrame(fn: () => void): void;
  /** When true, main.ts skips the shared canvas picker; the theme wires its own input. */
  selfManagedInput?: boolean;
  isDragging?(): boolean;
  pickables?(): THREE.Object3D[];
  metaFor?(object: THREE.Object3D, instanceId: number | undefined): CardMeta | null;
  setHovered?(object: THREE.Object3D | null, instanceId: number | undefined): void;
}
```

Replace with:

```typescript
export interface VisualizationHandle {
  camera: THREE.PerspectiveCamera;
  onFrame(fn: () => void): void;
  /** When true, main.ts skips the shared canvas picker; the theme wires its own input. */
  selfManagedInput?: boolean;
  isDragging?(): boolean;
  pickables?(): THREE.Object3D[];
  metaFor?(object: THREE.Object3D, instanceId: number | undefined): CardMeta | null;
  /** A hit that means "jump to this block's detail view" rather than a spend card. */
  pickHeight?(object: THREE.Object3D, instanceId: number | undefined): number | null;
  /** Invoked by the picker on a `pickHeight` click; the theme owns what "selecting" a height means. */
  selectHeight?(height: number): void;
  setHovered?(object: THREE.Object3D | null, instanceId: number | undefined): void;
}
```

- [ ] **Step 4: Rewrite `picker.ts`**

Replace the entire content of `web/src/ui/picker.ts` with:

```typescript
import * as THREE from "three";
import type { CardMeta, VisualizationHandle } from "../themes/types.js";
import { hideCard, showCard } from "./detail-card.js";

interface Hit {
  object: THREE.Object3D;
  instanceId: number | undefined;
  meta: CardMeta | null;
  height: number | null;
}

/** Identifies a hovered pick target for dedup, independent of whether it carries card data. Pure. */
export function hitKey(
  hit: { object: THREE.Object3D; instanceId: number | undefined } | null
): string {
  if (!hit) return "";
  return `${hit.object.id}:${hit.instanceId ?? -1}`;
}

export function attachPicker(canvas: HTMLCanvasElement, viz: VisualizationHandle): void {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  function intersect(eventX: number, eventY: number): Hit | null {
    pointer.set((eventX / innerWidth) * 2 - 1, -(eventY / innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointer, viz.camera);
    const hits = raycaster.intersectObjects(viz.pickables?.() ?? [], false);
    for (const hit of hits) {
      const meta = viz.metaFor?.(hit.object, hit.instanceId) ?? null;
      const height = viz.pickHeight?.(hit.object, hit.instanceId) ?? null;
      if (meta || height !== null) {
        return { object: hit.object, instanceId: hit.instanceId, meta, height };
      }
    }
    return null;
  }

  // debounce the card only — highlight and cursor stay instant so the
  // scene feels responsive while sweeping across the meadow
  const SHOW_DELAY_MS = 160;
  // generous: leaving a plant must give the pointer time to travel into the
  // card (entering the card then holds it open for the spacescan link)
  const HIDE_DELAY_MS = 600;
  const CARD_EXIT_HIDE_MS = 240;

  let pendingX = -1;
  let pendingY = -1;
  let hoveredKey = "";
  // a click pins the card open so the spacescan link is reachable;
  // click-away (or clicking another plant) releases it
  let pinned = false;
  let insideCard = false;
  let showTimer: number | undefined;
  let hideTimer: number | undefined;

  const clearCardTimers = () => {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
  };

  // the card is interactive while visible; hovering it parks the hide timer
  const card = document.getElementById("card") as HTMLDivElement;
  card.addEventListener("pointerenter", () => {
    insideCard = true;
    clearTimeout(hideTimer);
  });
  card.addEventListener("pointerleave", () => {
    insideCard = false;
    if (!pinned) {
      hideTimer = window.setTimeout(hideCard, CARD_EXIT_HIDE_MS);
    }
  });

  canvas.addEventListener("pointermove", (event) => {
    pendingX = event.clientX;
    pendingY = event.clientY;
  });

  viz.onFrame(() => {
    if (pendingX < 0) return;
    if (viz.isDragging?.()) {
      pendingX = -1;
      return;
    }
    const hit = intersect(pendingX, pendingY);
    pendingX = -1;

    const key = hitKey(hit);
    if (key === hoveredKey) return;
    hoveredKey = key;

    viz.setHovered?.(hit?.object ?? null, hit?.instanceId);
    canvas.style.cursor = hit ? "pointer" : "default";
    if (!pinned && !insideCard) {
      clearCardTimers();
      if (hit?.meta) {
        const meta = hit.meta;
        showTimer = window.setTimeout(() => showCard(meta), SHOW_DELAY_MS);
      } else {
        hideTimer = window.setTimeout(hideCard, HIDE_DELAY_MS);
      }
    }
  });

  canvas.addEventListener("click", (event) => {
    if (viz.isDragging?.()) return;
    const hit = intersect(event.clientX, event.clientY);
    clearCardTimers();
    if (hit && hit.height !== null) {
      pinned = false;
      hideCard();
      viz.selectHeight?.(hit.height);
      return;
    }
    if (hit?.meta) {
      pinned = true;
      showCard(hit.meta);
    } else {
      pinned = false;
      hideCard();
    }
  });
}
```

- [ ] **Step 5: Run the test to verify it passes, plus typecheck**

```bash
npx vitest run web/test/picker.test.ts
npm run typecheck
```

Expected: all tests pass, no type errors (the other four themes' `VisualizationHandle` objects are unaffected — `pickHeight`/`selectHeight` are optional).

- [ ] **Step 6: Commit**

```bash
git add web/src/themes/types.ts web/src/ui/picker.ts web/test/picker.test.ts
git commit -m "feat: add column-aware height picking to the shared canvas picker"
```

---

### Task 8: Web — integrate detail mode into `board.ts`

**Files:**

- Modify: `web/src/themes/board/board.ts`

**Interfaces:**

- Consumes: `HEIGHT_COLS` (Task 1), `registerBlockLookup`'s response shape via `fetch` (Task 2), `readBlockParam`/`writeBlockParam` (Task 3), `BlockDetail`/`DetailStatus` (Task 4), `Header.setDetail` (Task 5), `BoardNav` (Task 6), `pickHeight`/`selectHeight` (Task 7).
- No new exports — this is the integration point. Not unit-tested (Three.js scene wiring); verified by typecheck + manual smoke test.

- [ ] **Step 1: Replace the entire content of `board.ts`**

Replace the entire content of `web/src/themes/board/board.ts` with:

```typescript
// web/src/themes/board/board.ts
import * as THREE from "three";
import type { GroveFeed } from "../../net/feed.js";
import type { BlockEvent, GroveEvent, SproutEvent } from "@grove/shared";
import type { VisualizationHandle } from "../types.js";
import { createFrameLimiter } from "../shared/frame-limiter.js";
import { BOARD } from "./palette.js";
import { buildGlyphAtlas } from "./glyphs.js";
import { FlapGrid } from "./flapgrid.js";
import { Header } from "./header.js";
import {
  rowTextFor,
  shouldShowHeight,
  cardMetaFor,
  toDisplayRows,
  BOARD_COLS,
  HEIGHT_COLS,
} from "./rows.js";
import type { DisplayRow } from "./rows.js";
import { fitDistance } from "./fit.js";
import { BlockDetail, type DetailStatus } from "./detail.js";
import { readBlockParam, writeBlockParam } from "./url-state.js";
import { BoardNav } from "./block-nav.js";

const LEDGER_ROWS = 20;
const HISTORY = 500; // spends kept in memory for scrolling back through
// Sprouts/frame above which an already-busy board snaps instead of riffling.
// Tuned just under the feed's 60/frame drain budget so only the sustained
// connect-snapshot backlog snaps; a normal live block (even one overlapping a
// still-settling riffle) stays under this and riffles. A settled board always
// riffles regardless — this only gates the `!wasIdle` case.
const FAST_FORWARD = 48;
const SCROLL_PX_PER_ROW = 30; // wheel delta per row scrolled

const DETAIL_MESSAGES: Record<Exclude<DetailStatus, "loaded">, string> = {
  loading: "LOADING…",
  empty: "NO SPENDS THIS BLOCK",
  error: "COULD NOT LOAD BLOCK",
};

export function startBoard(canvas: HTMLCanvasElement, feed: GroveFeed): VisualizationHandle {
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.setSize(innerWidth, innerHeight);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BOARD.backdrop);

  // Layout: a 3-row header (originY HEADER_ORIGIN_Y) above the ledger (originY
  // LEDGER_ORIGIN_Y). Frame the camera on the true content center so the header
  // is never clipped, and fit the whole board to the viewport on any aspect.
  const cell = 0.6;
  const HEADER_ORIGIN_Y = 7;
  const LEDGER_ORIGIN_Y = 5;
  const VFOV = 40;
  const contentTop = HEADER_ORIGIN_Y + cell; // top edge of the header row
  const contentBottom = LEDGER_ORIGIN_Y - (LEDGER_ROWS - 1) * cell - cell; // bottom of the last ledger row
  const centerY = (contentTop + contentBottom) / 2;
  const contentH = contentTop - contentBottom;
  const contentW = BOARD_COLS * cell + cell * 2;

  const housing = new THREE.Mesh(
    new THREE.PlaneGeometry(contentW + 0.8, contentH + 0.8),
    new THREE.MeshBasicMaterial({ color: BOARD.housing })
  );
  housing.position.set(0, centerY, -0.05);
  scene.add(housing);

  const camera = new THREE.PerspectiveCamera(VFOV, innerWidth / innerHeight, 0.1, 1000);
  let baseZ = fitDistance(contentW, contentH, VFOV, innerWidth / innerHeight);
  camera.position.set(0, centerY, baseZ);
  camera.lookAt(0, centerY, 0);

  const atlas = buildGlyphAtlas();
  const ledger = new FlapGrid(scene, atlas, LEDGER_ROWS, BOARD_COLS, {
    cell,
    originY: LEDGER_ORIGIN_Y,
  });
  const header = new Header(scene, atlas, { originY: HEADER_ORIGIN_Y });

  const navRoot = document.getElementById("board-nav") as HTMLDivElement;
  navRoot.hidden = false;
  const nav = new BoardNav(navRoot, {
    onFind: (height) => enterDetail(height),
    onPrev: () => stepDetail(-1),
    onNext: () => stepDetail(1),
    onReturnToLive: () => returnToLive(),
  });

  const events: SproutEvent[] = []; // newest first, capped at HISTORY
  let displayRows: DisplayRow[] = [];
  let ledgerDirty = false;
  let sproutsSinceFrame = 0;
  let scrollOffset = 0; // rows scrolled back from the newest (0 = following live)
  let scrollAccum = 0; // sub-row wheel remainder
  let lastRenderedOffset = -1;

  // --- block-detail mode -------------------------------------------------
  let mode: "live" | "detail" = "live";
  let detailMessage: string | null = null; // non-null replaces the ledger with a status line
  let detailDirty = false;
  let lastLiveBlock: BlockEvent | null = null; // so returning to live doesn't wait for the next block

  const maxOffset = () => Math.max(0, displayRows.length - LEDGER_ROWS);

  function renderLedger(instant: boolean): void {
    for (let r = 0; r < LEDGER_ROWS; r++) {
      if (detailMessage !== null) {
        ledger.setRow(r, r === 0 ? detailMessage : "", instant);
        continue;
      }
      const i = r + scrollOffset;
      const row = displayRows[i];
      if (row) {
        const showHeight = shouldShowHeight(displayRows[i - 1], row, r === 0);
        ledger.setRow(r, rowTextFor(row, { showHeight }), instant);
      } else {
        ledger.clearRow(r);
      }
    }
  }

  const detail = new BlockDetail(
    (height) =>
      fetch(`/block/${height}`).then((res) => {
        if (!res.ok) throw new Error(`block fetch failed: ${res.status}`);
        return res.json() as Promise<{ events: GroveEvent[] }>;
      }),
    (state) => {
      mode = "detail";
      detailMessage = state.status === "loaded" ? null : DETAIL_MESSAGES[state.status];
      if (state.status === "loaded" || state.status === "empty") {
        displayRows = state.rows;
      }
      scrollOffset = 0;
      lastRenderedOffset = -1;
      header.setDetail(state.height, state.status, state.spendCount, state.fees);
      nav.setMode("detail");
      detailDirty = true;
    }
  );

  function enterDetail(height: number, pushUrl = true): void {
    if (pushUrl) writeBlockParam(height);
    void detail.load(height);
  }

  function stepDetail(delta: number): void {
    enterDetail(detail.currentHeight + delta);
  }

  function returnToLive(pushUrl = true): void {
    mode = "live";
    detailMessage = null;
    scrollOffset = 0;
    lastRenderedOffset = -1;
    ledgerDirty = true;
    if (lastLiveBlock) {
      header.setBlock(lastLiveBlock.height, lastLiveBlock.spendCount, lastLiveBlock.fees);
    }
    header.setLive(true);
    nav.setMode("live");
    if (pushUrl) writeBlockParam(null);
  }

  feed.onEvent((event) => {
    switch (event.type) {
      case "sprout":
        events.unshift(event);
        if (events.length > HISTORY) events.pop();
        ledgerDirty = true;
        sproutsSinceFrame++;
        break;
      case "block":
        lastLiveBlock = event;
        if (mode === "live") header.setBlock(event.height, event.spendCount, event.fees);
        break;
      case "ambient":
        header.setAmbient(event.mempoolSize, event.netspace);
        break;
      case "reorg": {
        const before = events.length;
        for (let i = events.length - 1; i >= 0; i--) {
          if (events[i].height >= event.forkHeight) events.splice(i, 1);
        }
        if (events.length !== before) ledgerDirty = true;
        break;
      }
      case "content-flag": {
        for (const e of events) {
          if (e.kind === "nft" && e.launcherId === event.launcherId) {
            e.mediaFilter = event.mediaFilter;
          }
        }
        if (mode === "detail") {
          for (const row of displayRows) {
            if (
              row.type === "sprout" &&
              row.kind === "nft" &&
              row.launcherId === event.launcherId
            ) {
              row.mediaFilter = event.mediaFilter;
            }
          }
        }
        break;
      }
    }
  });

  const frameCallbacks: Array<() => void> = [];
  const timer = new THREE.Timer();
  const limiter = createFrameLimiter();
  let lastClock = 0;

  function frame(): void {
    requestAnimationFrame(frame);
    if (!limiter.shouldRender(performance.now())) return;
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.1);
    const t = timer.getElapsed();

    if (mode === "live") {
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
        // Scrubbing through history snaps instantly; a settled board always
        // riffles a fresh block no matter how many spends it carries. Only snap
        // when we're already mid-riffle and being flooded (e.g. the startup
        // snapshot replay) so the board can catch up instead of churning forever.
        const flooding = !wasIdle && sproutsSinceFrame > FAST_FORWARD;
        renderLedger(scrolled || reducedMotion || flooding);
        lastRenderedOffset = scrollOffset;
        header.setLive(scrollOffset === 0);
      }
    } else if (detailDirty) {
      // block navigation and the live↔detail switch always riffle, like any
      // other board update — only reduced-motion forces an instant cut
      renderLedger(reducedMotion);
      lastRenderedOffset = scrollOffset;
      detailDirty = false;
    }
    sproutsSinceFrame = 0;

    if (t - lastClock > 1) {
      header.tick(new Date());
      lastClock = t;
    }

    ledger.update(dt);
    header.update(dt);

    // gentle idle parallax sway; hold the framing distance (eased so a resize
    // settles smoothly rather than jumping)
    const sway = reducedMotion ? 0 : Math.sin(t * 0.4) * 0.25;
    camera.position.x += (sway - camera.position.x) * Math.min(dt, 1);
    camera.position.z += (baseZ - camera.position.z) * Math.min(dt * 2, 1);
    camera.lookAt(0, centerY, 0);

    for (const fn of frameCallbacks) fn();
    renderer.render(scene, camera);
  }
  frame();

  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    baseZ = fitDistance(contentW, contentH, VFOV, camera.aspect);
  });

  // wheel / trackpad scrolls vertically through history (live) or through a
  // busy block's spend list (detail); scrolling down reveals older rows
  canvas.addEventListener(
    "wheel",
    (e) => {
      const max = maxOffset();
      if (max === 0) return;
      scrollAccum += e.deltaY;
      const step = Math.trunc(scrollAccum / SCROLL_PX_PER_ROW);
      if (step !== 0) {
        scrollAccum -= step * SCROLL_PX_PER_ROW;
        scrollOffset = Math.max(0, Math.min(max, scrollOffset + step));
      }
      e.preventDefault();
    },
    { passive: false }
  );

  addEventListener("popstate", () => {
    const height = readBlockParam(location.search);
    if (height !== null) enterDetail(height, false);
    else returnToLive(false);
  });

  const initialHeight = readBlockParam(location.search);
  if (initialHeight !== null) enterDetail(initialHeight, false);

  return {
    camera,
    onFrame: (fn) => frameCallbacks.push(fn),
    pickables: () => [ledger.mesh],
    metaFor: (object, instanceId) => {
      if (object !== ledger.mesh || instanceId === undefined) return null;
      if (instanceId % BOARD_COLS < HEIGHT_COLS) return null; // height gutter: see pickHeight
      const row = displayRows[scrollOffset + ledger.rowOf(instanceId)];
      return row ? cardMetaFor(row) : null;
    },
    pickHeight: (object, instanceId) => {
      if (object !== ledger.mesh || instanceId === undefined) return null;
      if (instanceId % BOARD_COLS >= HEIGHT_COLS) return null;
      const row = displayRows[scrollOffset + ledger.rowOf(instanceId)];
      return row ? row.height : null;
    },
    selectHeight: (height) => enterDetail(height),
    setHovered: (object, instanceId) =>
      ledger.highlightRow(
        object === ledger.mesh && instanceId !== undefined ? ledger.rowOf(instanceId) : null
      ),
  };
}
```

- [ ] **Step 2: Run typecheck and the full test suite**

```bash
npm run typecheck
npm test
```

Expected: no type errors; all existing and new tests pass (the aggregation/rendering behavior for live mode is unchanged, so `board-rows.test.ts` and friends still pass as-is).

- [ ] **Step 3: Manual smoke test**

The detail view needs the real `/block/:height` endpoint, so use the dev server pair rather than `?demo=1`:

```bash
npm run dev:server
npm run dev:web
```

Open `http://localhost:5173/?theme=board`, then verify:

- Clicking a row's height (the leftmost field) riffles the ledger into block-detail mode, showing every individual spend in that block (no XCH/CAT aggregation) and a "BLOCK NNNN · N SPENDS · FEES" header with a "★ BLOCK DETAIL" status marker.
- Clicking anywhere else in a row still opens the existing spend/aggregate detail card, unchanged.
- `◀ prev` / `next ▶` step to adjacent heights, riffling each time; a block with no grove-relevant spends shows "NO SPENDS THIS BLOCK" instead of an empty ledger.
- `return to live` snaps back to the live ledger, and the header immediately shows the current live block (not stale detail text) even if no new block has arrived yet.
- The find-block input (visible in both live and detail views) jumps straight to that height's detail view on submit.
- The address bar shows `?theme=board&block=<height>` while in detail mode, and clears `block` on return to live; copy that URL into a new tab — it loads directly into that block's detail view.
- Browser back/forward moves between viewed blocks and live.
- Scrolling (wheel) inside a busy block's detail view scrolls through its rows if it has more than 20 spends.
- If you have `GOOGLE_VISION_API_KEY` set and can find a historical block with an NFT spend, confirm any freshly-flagged sensitive NFT blurs in its detail card once the (real, out-of-band) SafeSearch verdict lands.

- [ ] **Step 4: Commit**

```bash
git add web/src/themes/board/board.ts
git commit -m "feat: add block detail mode to the Big Board"
```

---

## Self-Review Notes

- **Spec coverage:** click-to-detail (Task 7 + 8), forward/back (Task 8 `stepDetail`), find-block on both views (Task 6 + 8), shareable URL (Task 3 + 8), arbitrary historical lookup via server (Task 2), full content filtering including SafeSearch (Task 2 reuses `contentFilter.enrich` verbatim), animated transitions (Task 8 `renderLedger(reducedMotion)` — never forces instant except reduced-motion), bundled live-ledger content-flag fix (Task 8 `content-flag` case patches `events` unconditionally, not just in detail mode).
- **Type consistency:** `DetailStatus` is defined once (Task 4, `detail.ts`) and imported everywhere else that needs it (`header.ts`, `board.ts`) rather than redefined. `HEIGHT_COLS` is defined once (Task 1, `rows.ts`) and imported by `board.ts` rather than a re-declared magic number.
- **Backward compatibility:** `buildServer`'s new 4th parameter is optional, so all three existing call sites (`index.ts`, `server.test.ts`, `img-proxy.test.ts`) keep working unmodified. `VisualizationHandle`'s two new methods are optional, so `grove`/`farm`/`gallery`/`mine` are unaffected.
