# Sensitive / Blocked NFT Content Filtering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Never display real pixels for NFT art that MintGarden flags as blocked (hard takedown) or sensitive (NSFW), while keeping card text, amounts, ids, and external links fully visible — across every scene, thumbnail, and media view.

**Architecture:** The server enriches each NFT `SproutEvent` with a `mediaFilter` flag by looking the NFT up on MintGarden (`GET /nfts/<nftId>`), collapsing all of MintGarden's block/sensitive signals into one disposition before the event is published (so it is baked into the ring buffer and replayed identically). The client funnels every NFT-art surface through a single `resolveMedia()` resolver in `web/src/ui/media.ts`: blocked → never fetch bytes + neutral placeholder; sensitive → blur in the DOM card, neutral placeholder texture in WebGL themes.

**Tech Stack:** TypeScript, npm workspaces (`shared`/`server`/`web`), Node ≥ 24 (global `fetch`), Fastify, Three.js, Vitest (node environment — no jsdom).

## Global Constraints

- Node ≥ 24; server runs via `tsx` (no build step). Global `fetch` / `AbortController` are available — do not add an HTTP client dependency.
- ESM throughout: intra-package relative imports MUST use the `.js` extension even for `.ts` sources.
- Add **no new npm dependencies**.
- `PROTOCOL_VERSION` is bumped `2 → 3` (safety feature: forces stale clients to reload into filtered code).
- **Permissive default:** unknown NFT / 404 / non-OK response / malformed JSON / fetch error / timeout → `"ok"` (show normally). Only positively-flagged content is filtered.
- **Blocked precedence:** blocked wins over sensitive.
- MintGarden base URL: `https://api.mintgarden.io`; the NFT endpoint is `/nfts/<nftId>` where `<nftId>` is the bech32 `nft1...` id already on `SproutEvent.nftId`. The response top-level **is** the NFT object (not wrapped).
- Verified field paths (live API, 2026-06-26): `is_blocked` (bool|null), `collection.blocked_content` (bool), `collection.sensitive_content` (bool), `creator.verification_state` (int; `2` = community-blocklisted), `data.metadata_json.sensitive_content` (bool | `"true"` | string[]).
- Run a single test file with `npx vitest run <path>`; the whole suite with `npm test`; `npm run typecheck` and `npm run lint` must stay green.

---

### Task 1: Wire field + protocol bump (`shared`)

**Files:**

- Modify: `shared/src/index.ts` (the `SproutEvent` interface near lines 30-45, and `PROTOCOL_VERSION` near line 8)

**Interfaces:**

- Consumes: nothing.
- Produces: `SproutEvent.mediaFilter?: "blocked" | "sensitive"`; `PROTOCOL_VERSION === 3`.

- [ ] **Step 1: Add the `mediaFilter` field to `SproutEvent`**

In `shared/src/index.ts`, inside `interface SproutEvent`, add after the `mediaKind` line:

```ts
  mediaFilter?: "blocked" | "sensitive"; // NFT only; absent = ok. Set server-side from MintGarden — blocked hides art (bytes made unreachable), sensitive blurs it.
```

- [ ] **Step 2: Bump the protocol version**

Change the constant:

```ts
export const PROTOCOL_VERSION = 3;
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no type errors).

- [ ] **Step 4: Run the existing suite to confirm nothing assumed the old value**

Run: `npx vitest run web/test/protocol-guard.test.ts`
Expected: PASS (the guard test computes against arguments, not the literal `2`).

- [ ] **Step 5: Commit**

```bash
git add shared/src/index.ts
git commit -m "feat(shared): add SproutEvent.mediaFilter and bump protocol to 3"
```

---

### Task 2: `MediaIndex.delete` (`server`)

**Files:**

- Modify: `server/src/web/media-index.ts`
- Test: `server/test/media-index.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `MediaIndex.delete(launcherId: string): void`.

- [ ] **Step 1: Write the failing test**

Append to `server/test/media-index.test.ts`:

```ts
test("delete removes an entry so the proxy can no longer resolve it", () => {
  const idx = new MediaIndex(10);
  idx.set("launch1", { url: "https://example.com/a.png", kind: "image" });
  expect(idx.get("launch1")).toBeDefined();
  idx.delete("launch1");
  expect(idx.get("launch1")).toBeUndefined();
});

test("delete of an absent key is a no-op", () => {
  const idx = new MediaIndex(10);
  expect(() => idx.delete("nope")).not.toThrow();
});
```

(If `MediaIndex` is not yet imported in this test file, add `import { MediaIndex } from "../src/web/media-index.js";` at the top — check the existing imports first.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/test/media-index.test.ts`
Expected: FAIL — `idx.delete is not a function`.

- [ ] **Step 3: Implement `delete`**

In `server/src/web/media-index.ts`, add this method to the `MediaIndex` class (after `get`):

```ts
  /** Remove an entry so /img?nft=<launcherId> can no longer resolve it. */
  delete(launcherId: string): void {
    this.map.delete(launcherId);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/test/media-index.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/web/media-index.ts server/test/media-index.test.ts
git commit -m "feat(server): add MediaIndex.delete for unreachable blocked art"
```

---

### Task 3: `mapMintgarden` pure disposition mapper (`server`)

**Files:**

- Create: `server/src/classify/content-filter.ts`
- Test: `server/test/content-filter.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `type Disposition = "blocked" | "sensitive" | "ok"`; `mapMintgarden(json: unknown): Disposition`.

- [ ] **Step 1: Write the failing test**

Create `server/test/content-filter.test.ts`:

```ts
import { expect, test } from "vitest";
import { mapMintgarden } from "../src/classify/content-filter.js";

test("is_blocked true → blocked", () => {
  expect(mapMintgarden({ is_blocked: true })).toBe("blocked");
});

test("collection.blocked_content true → blocked", () => {
  expect(mapMintgarden({ collection: { blocked_content: true } })).toBe("blocked");
});

test("creator.verification_state 2 → blocked", () => {
  expect(mapMintgarden({ creator: { verification_state: 2 } })).toBe("blocked");
});

test("collection.sensitive_content true → sensitive", () => {
  expect(mapMintgarden({ collection: { sensitive_content: true } })).toBe("sensitive");
});

test("metadata_json.sensitive_content boolean true → sensitive", () => {
  expect(mapMintgarden({ data: { metadata_json: { sensitive_content: true } } })).toBe("sensitive");
});

test('metadata_json.sensitive_content string "true" → sensitive', () => {
  expect(mapMintgarden({ data: { metadata_json: { sensitive_content: "true" } } })).toBe(
    "sensitive"
  );
});

test("metadata_json.sensitive_content non-empty array → sensitive", () => {
  expect(mapMintgarden({ data: { metadata_json: { sensitive_content: ["nudity"] } } })).toBe(
    "sensitive"
  );
});

test("blocked takes precedence over sensitive", () => {
  expect(mapMintgarden({ is_blocked: true, collection: { sensitive_content: true } })).toBe(
    "blocked"
  );
});

test("benign NFT → ok", () => {
  expect(
    mapMintgarden({
      is_blocked: false,
      collection: { blocked_content: false, sensitive_content: false },
      creator: { verification_state: 1 },
      data: { metadata_json: { sensitive_content: false } },
    })
  ).toBe("ok");
});

test("missing fields / non-object → ok", () => {
  expect(mapMintgarden({})).toBe("ok");
  expect(mapMintgarden(null)).toBe("ok");
  expect(mapMintgarden("nope")).toBe("ok");
  expect(mapMintgarden({ collection: null, data: null, creator: null })).toBe("ok");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/test/content-filter.test.ts`
Expected: FAIL — cannot find module `content-filter.js`.

- [ ] **Step 3: Implement `mapMintgarden`**

Create `server/src/classify/content-filter.ts`:

```ts
export type Disposition = "blocked" | "sensitive" | "ok";

const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};

/** sensitive_content per CHIP-0007 may be boolean, the string "true", or a non-empty list. */
const isSensitiveFlag = (v: unknown): boolean =>
  v === true || v === "true" || (Array.isArray(v) && v.length > 0);

/**
 * Collapse a MintGarden GET /nfts/:id response object into one disposition.
 * Blocked (hard takedown) wins over sensitive (NSFW). Anything unrecognized or
 * malformed maps to "ok" (permissive) — the filter only acts on positive flags.
 */
export function mapMintgarden(json: unknown): Disposition {
  const nft = asRecord(json);
  const collection = asRecord(nft.collection);
  const creator = asRecord(nft.creator);
  const metadata = asRecord(asRecord(nft.data).metadata_json);

  if (
    nft.is_blocked === true ||
    collection.blocked_content === true ||
    creator.verification_state === 2
  ) {
    return "blocked";
  }
  if (
    isSensitiveFlag(collection.sensitive_content) ||
    isSensitiveFlag(metadata.sensitive_content)
  ) {
    return "sensitive";
  }
  return "ok";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/test/content-filter.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add server/src/classify/content-filter.ts server/test/content-filter.test.ts
git commit -m "feat(server): map MintGarden NFT response to content disposition"
```

---

### Task 4: `ContentFilter` (fetch + cache + enrich) (`server`)

**Files:**

- Modify: `server/src/classify/content-filter.ts`
- Test: `server/test/content-filter.test.ts`

**Interfaces:**

- Consumes: `mapMintgarden` (Task 3); `MediaIndex` + `MediaIndex.delete` (Task 2); `SproutEvent.mediaFilter` (Task 1).
- Produces: `class ContentFilter` with constructor `(media: MediaIndex, opts?: ContentFilterOptions)` and `enrich(events: GroveEvent[]): Promise<void>`. `ContentFilterOptions = { fetchImpl?: typeof fetch; baseUrl?: string; timeoutMs?: number; concurrency?: number; cacheCapacity?: number }`.

- [ ] **Step 1: Write the failing test**

Append to `server/test/content-filter.test.ts`:

```ts
import { ContentFilter } from "../src/classify/content-filter.js";
import { MediaIndex } from "../src/web/media-index.js";
import type { GroveEvent, SproutEvent } from "@grove/shared";

const nftEvent = (over: Partial<SproutEvent> = {}): SproutEvent => ({
  type: "sprout",
  kind: "nft",
  height: 1,
  coinId: "ab".repeat(32),
  amount: "1",
  launcherId: "cd".repeat(32),
  nftId: "nft1example",
  mediaKind: "image",
  ...over,
});

const okJson = (obj: unknown) => ({ ok: true, json: async () => obj }) as unknown as Response;

test("enrich marks blocked NFTs and makes their art unreachable", async () => {
  const media = new MediaIndex(10);
  media.set("cd".repeat(32), { url: "https://x/a.png", kind: "image" });
  const filter = new ContentFilter(media, {
    fetchImpl: async () => okJson({ is_blocked: true }),
  });
  const event = nftEvent();
  await filter.enrich([event]);
  expect(event.mediaFilter).toBe("blocked");
  expect(media.get("cd".repeat(32))).toBeUndefined();
});

test("enrich marks sensitive NFTs but keeps their art entry", async () => {
  const media = new MediaIndex(10);
  media.set("cd".repeat(32), { url: "https://x/a.png", kind: "image" });
  const filter = new ContentFilter(media, {
    fetchImpl: async () => okJson({ collection: { sensitive_content: true } }),
  });
  const event = nftEvent();
  await filter.enrich([event]);
  expect(event.mediaFilter).toBe("sensitive");
  expect(media.get("cd".repeat(32))).toBeDefined();
});

test("enrich leaves benign NFTs unflagged", async () => {
  const filter = new ContentFilter(new MediaIndex(10), {
    fetchImpl: async () => okJson({ is_blocked: false }),
  });
  const event = nftEvent();
  await filter.enrich([event]);
  expect(event.mediaFilter).toBeUndefined();
});

test("a determination is cached per nftId (no refetch)", async () => {
  let calls = 0;
  const filter = new ContentFilter(new MediaIndex(10), {
    fetchImpl: async () => {
      calls++;
      return okJson({ collection: { sensitive_content: true } });
    },
  });
  await filter.enrich([nftEvent(), nftEvent()]);
  expect(calls).toBe(1);
});

test("a fetch error is permissive and not cached (retries next time)", async () => {
  let calls = 0;
  const filter = new ContentFilter(new MediaIndex(10), {
    fetchImpl: async () => {
      calls++;
      throw new Error("network");
    },
  });
  const a = nftEvent();
  await filter.enrich([a]);
  expect(a.mediaFilter).toBeUndefined();
  const b = nftEvent();
  await filter.enrich([b]);
  expect(calls).toBe(2);
});

test("non-NFT and nftId-less events are ignored", async () => {
  let calls = 0;
  const filter = new ContentFilter(new MediaIndex(10), {
    fetchImpl: async () => {
      calls++;
      return okJson({});
    },
  });
  const xch: SproutEvent = { type: "sprout", kind: "xch", height: 1, coinId: "1", amount: "1" };
  const noId = nftEvent({ nftId: undefined });
  await filter.enrich([xch as GroveEvent, noId]);
  expect(calls).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/test/content-filter.test.ts`
Expected: FAIL — `ContentFilter` is not exported.

- [ ] **Step 3: Implement `ContentFilter`**

Append to `server/src/classify/content-filter.ts`:

```ts
import type { GroveEvent, SproutEvent } from "@grove/shared";
import type { MediaIndex } from "../web/media-index.js";

export interface ContentFilterOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  concurrency?: number;
  cacheCapacity?: number;
}

/**
 * Enriches NFT sprout events with a `mediaFilter` flag by resolving each NFT's
 * disposition from MintGarden. Determinations are cached per nftId (sensitivity
 * is stable per NFT) behind a bounded concurrency gate with a per-request
 * timeout; any failure is permissive ("ok") and not cached so a later spend can
 * retry. Blocked NFTs also have their MediaIndex entry dropped so /img cannot
 * serve the bytes (defense in depth, independent of the client flag).
 */
export class ContentFilter {
  private readonly cache = new Map<string, Disposition>();
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly concurrency: number;
  private readonly cacheCapacity: number;
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(
    private readonly media: MediaIndex,
    opts: ContentFilterOptions = {}
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.baseUrl = opts.baseUrl ?? "https://api.mintgarden.io";
    this.timeoutMs = opts.timeoutMs ?? 4000;
    this.concurrency = opts.concurrency ?? 4;
    this.cacheCapacity = opts.cacheCapacity ?? 10000;
  }

  async enrich(events: GroveEvent[]): Promise<void> {
    const nfts = events.filter(
      (e): e is SproutEvent =>
        e.type === "sprout" && e.kind === "nft" && typeof e.nftId === "string"
    );
    await Promise.all(nfts.map((e) => this.apply(e)));
  }

  private async apply(event: SproutEvent): Promise<void> {
    const disposition = await this.resolve(event.nftId!);
    if (disposition === "blocked") {
      event.mediaFilter = "blocked";
      if (event.launcherId) this.media.delete(event.launcherId);
    } else if (disposition === "sensitive") {
      event.mediaFilter = "sensitive";
    }
  }

  private async resolve(nftId: string): Promise<Disposition> {
    const cached = this.cache.get(nftId);
    if (cached !== undefined) return cached;
    try {
      const disposition = await this.gate(() => this.fetchDisposition(nftId));
      this.remember(nftId, disposition);
      return disposition;
    } catch {
      return "ok"; // transient failure: permissive, and not cached so we retry later
    }
  }

  private async fetchDisposition(nftId: string): Promise<Disposition> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/nfts/${nftId}`, {
        signal: controller.signal,
      });
      if (!res.ok) return "ok"; // 404 (unknown to MintGarden) / 5xx → permissive, cacheable
      return mapMintgarden(await res.json());
    } finally {
      clearTimeout(timer);
    }
  }

  private remember(nftId: string, disposition: Disposition): void {
    this.cache.delete(nftId);
    this.cache.set(nftId, disposition);
    if (this.cache.size > this.cacheCapacity) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
  }

  private gate<T>(fn: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      this.active++;
      try {
        return await fn();
      } finally {
        this.active--;
        this.waiters.shift()?.();
      }
    };
    if (this.active < this.concurrency) return run();
    return new Promise<T>((resolve, reject) => {
      this.waiters.push(() => run().then(resolve, reject));
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/test/content-filter.test.ts`
Expected: PASS (all cases, including the Task 3 ones).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/classify/content-filter.ts server/test/content-filter.test.ts
git commit -m "feat(server): ContentFilter resolves and enriches NFT mediaFilter"
```

---

### Task 5: Make the poller await `onBlock` (`server`)

**Files:**

- Modify: `server/src/ingest/types.ts` (the `ChainHandlers` interface, line ~35)
- Modify: `server/src/ingest/coinset-poller.ts` (the `onBlock` call in `walkTo`, line ~108)
- Test: `server/test/coinset-poller.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `ChainHandlers.onBlock(block: BlockData): void | Promise<void>` — awaited in order by `walkTo`.

- [ ] **Step 1: Write the failing test**

Append to `server/test/coinset-poller.test.ts`:

```ts
test("awaits an async onBlock so blocks are processed in order", async () => {
  const rpc = new FakeRpc();
  rpc.chain([
    { h: 0, hash: "h0" },
    { h: 1, hash: "h1" },
    { h: 2, hash: "h2" },
  ]);
  const order: number[] = [];
  const handlers = {
    // block 0 resolves slowest; without awaiting, its push would land last
    onBlock: async (b: BlockData) => {
      await new Promise((r) => setTimeout(r, b.height === 0 ? 20 : 1));
      order.push(b.height);
    },
    onAmbient: () => {},
    onReorg: () => {},
  };
  const poller = new CoinsetPoller(rpc, handlers, { backfillBlocks: 3 });
  await poller.tick();
  expect(order).toEqual([0, 1, 2]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/test/coinset-poller.test.ts`
Expected: FAIL — `order` is `[1, 2, 0]` (block 0 not awaited).

- [ ] **Step 3: Widen the handler type**

In `server/src/ingest/types.ts`, change the `onBlock` signature in `ChainHandlers`:

```ts
  onBlock(block: BlockData): void | Promise<void>;
```

- [ ] **Step 4: Await the call**

In `server/src/ingest/coinset-poller.ts`, in `walkTo`, change `this.handlers.onBlock({ … });` to await it:

```ts
await this.handlers.onBlock({
  height,
  headerHash: info.headerHash,
  timestamp: Number(info.timestamp),
  fees: info.fees ?? 0n,
  spends,
});
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npx vitest run server/test/coinset-poller.test.ts`
Expected: PASS (new test `[0,1,2]`; all existing poller tests still pass).

- [ ] **Step 6: Commit**

```bash
git add server/src/ingest/types.ts server/src/ingest/coinset-poller.ts server/test/coinset-poller.test.ts
git commit -m "feat(server): await onBlock to preserve order with async enrichment"
```

---

### Task 6: Wire `ContentFilter` into the server entrypoint (`server`)

**Files:**

- Modify: `server/src/index.ts` (imports; `media` construction near line 33; `onBlock` near line 40-43)

**Interfaces:**

- Consumes: `ContentFilter` (Task 4); awaited `onBlock` (Task 5).
- Produces: nothing (composition root).

- [ ] **Step 1: Import `ContentFilter`**

In `server/src/index.ts`, add to the import block:

```ts
import { ContentFilter } from "./classify/content-filter.js";
```

- [ ] **Step 2: Construct the filter beside `MediaIndex`**

After `const media = new MediaIndex(10000);`, add:

```ts
const contentFilter = new ContentFilter(media); // >= ring buffer cap; MintGarden lookups cached per nftId
```

- [ ] **Step 3: Enrich before publishing in `onBlock`**

Replace the body of `onBlock` with:

```ts
    async onBlock(block) {
      const events = classifyBlock(block, cats, media);
      await contentFilter.enrich(events);
      hub.publish(events);
      console.log(`block ${block.height} (${block.spends.length} spends)`);
    },
```

- [ ] **Step 4: Typecheck and run the full suite**

Run: `npm run typecheck && npm test`
Expected: PASS (no type errors; all tests green).

- [ ] **Step 5: Commit**

```bash
git add server/src/index.ts
git commit -m "feat(server): enrich blocks with content filter before publishing"
```

---

### Task 7: `resolveMedia` single-source resolver (`web`)

**Files:**

- Modify: `web/src/ui/media.ts`
- Test: `web/test/media-resolve.test.ts`

**Interfaces:**

- Consumes: `SproutEvent.mediaFilter` (Task 1).
- Produces:
  - `mediaSrc(event): string | null` — now returns `null` when `mediaFilter === "blocked"`.
  - `type MediaDisposition = { render: "art"; src: string; kind: MediaKind } | { render: "blur"; src: string; kind: MediaKind } | { render: "placeholder" } | { render: "none" }`.
  - `resolveMedia(event: SproutEvent): MediaDisposition`.

- [ ] **Step 1: Write the failing test**

Create `web/test/media-resolve.test.ts`:

```ts
import { expect, test } from "vitest";
import type { SproutEvent } from "@grove/shared";
import { resolveMedia, mediaSrc } from "../src/ui/media.js";

const nft = (over: Partial<SproutEvent> = {}): SproutEvent => ({
  type: "sprout",
  kind: "nft",
  height: 1,
  coinId: "ab".repeat(32),
  amount: "1",
  launcherId: "cd".repeat(32),
  mediaKind: "image",
  ...over,
});

test("blocked → placeholder and no src", () => {
  const e = nft({ mediaFilter: "blocked" });
  expect(resolveMedia(e)).toEqual({ render: "placeholder" });
  expect(mediaSrc(e)).toBeNull();
});

test("sensitive → blur with proxied src", () => {
  const e = nft({ mediaFilter: "sensitive" });
  expect(resolveMedia(e)).toEqual({
    render: "blur",
    src: `/img?nft=${"cd".repeat(32)}`,
    kind: "image",
  });
});

test("normal NFT with art → art", () => {
  const e = nft();
  expect(resolveMedia(e)).toEqual({
    render: "art",
    src: `/img?nft=${"cd".repeat(32)}`,
    kind: "image",
  });
});

test("no usable media → none", () => {
  expect(resolveMedia(nft({ mediaKind: undefined, launcherId: undefined }))).toEqual({
    render: "none",
  });
});

test("demo dataUri is honored, but blocked still wins", () => {
  expect(resolveMedia(nft({ dataUri: "data:image/png;base64,AAAA" }))).toMatchObject({
    render: "art",
    src: "data:image/png;base64,AAAA",
  });
  expect(
    resolveMedia(nft({ dataUri: "data:image/png;base64,AAAA", mediaFilter: "blocked" }))
  ).toEqual({ render: "placeholder" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/test/media-resolve.test.ts`
Expected: FAIL — `resolveMedia` is not exported.

- [ ] **Step 3: Implement the resolver**

In `web/src/ui/media.ts`, replace the existing `mediaSrc` function with the version below and add `MediaDisposition` + `resolveMedia` beneath it:

```ts
/**
 * Resolve the loadable src for a sprout's art, or null if it has none. Returns
 * null for blocked NFTs so no surface can fetch the bytes. Demo/offline events
 * inline a data: URI; live events are addressed by launcher id through the
 * same-origin proxy (no open URL crosses the wire; launcherId keeps /img cacheable).
 */
export function mediaSrc(event: SproutEvent): string | null {
  if (event.mediaFilter === "blocked") return null;
  if (event.dataUri) return event.dataUri; // data: (demo)
  if (event.mediaKind && event.launcherId) return `/img?nft=${event.launcherId}`;
  return null;
}

/**
 * The single source of truth for how an NFT's media should be presented. Every
 * render surface (detail card, gallery walls, mine paintings) routes through
 * this, so content filtering is uniform by construction — a new surface that
 * calls resolveMedia inherits it automatically.
 *
 * - blocked   → placeholder, never any src (bytes unreachable).
 * - sensitive → blur (DOM blurs the element; WebGL shows a placeholder texture).
 * - otherwise → art if a src resolves, else none.
 */
export type MediaDisposition =
  | { render: "art"; src: string; kind: MediaKind }
  | { render: "blur"; src: string; kind: MediaKind }
  | { render: "placeholder" }
  | { render: "none" };

export function resolveMedia(event: SproutEvent): MediaDisposition {
  if (event.mediaFilter === "blocked") return { render: "placeholder" };
  const src = mediaSrc(event);
  if (!src) return { render: "none" };
  const kind = event.mediaKind ?? "image";
  return { render: event.mediaFilter === "sensitive" ? "blur" : "art", src, kind };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run web/test/media-resolve.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/ui/media.ts web/test/media-resolve.test.ts
git commit -m "feat(web): resolveMedia as the single content-filter chokepoint"
```

---

### Task 8: Apply the filter in the detail card (`web`)

**Files:**

- Modify: `web/src/ui/detail-card.ts` (imports line 4; the media branch lines ~99-102)
- Modify: `web/src/style.css` (after the `#card img, #card video` block, ~line 82)

**Interfaces:**

- Consumes: `resolveMedia` (Task 7).
- Produces: nothing.

- [ ] **Step 1: Switch the import from `mediaSrc` to `resolveMedia`**

In `web/src/ui/detail-card.ts` line 4, change:

```ts
import { escalateMediaKind, mediaSrc, type MediaKind } from "./media.js";
```

to:

```ts
import { escalateMediaKind, resolveMedia, type MediaKind } from "./media.js";
```

- [ ] **Step 2: Replace the media branch**

In `showCard`, replace the current `else` branch:

```ts
  } else {
    const src = mediaSrc(event);
    if (src) card.appendChild(nftMediaEl(src, event.mediaKind ?? "image"));
  }
```

with:

```ts
  } else {
    const media = resolveMedia(event);
    if (media.render === "art") {
      card.appendChild(nftMediaEl(media.src, media.kind));
    } else if (media.render === "blur") {
      const node = nftMediaEl(media.src, media.kind);
      node.classList.add("sensitive");
      card.appendChild(node);
      card.appendChild(el("div", "media-note", "sensitive content"));
    } else if (media.render === "placeholder") {
      card.appendChild(el("div", "media-note", "media unavailable"));
    }
  }
```

- [ ] **Step 3: Add the CSS**

In `web/src/style.css`, after the `#card audio { … }` rule (~line 82), add:

```css
#card img.sensitive,
#card video.sensitive {
  filter: blur(24px);
  pointer-events: none;
}

#card .media-note {
  margin: 8px 0;
  padding: 10px;
  border-radius: 6px;
  text-align: center;
  font-size: 11px;
  letter-spacing: 0.04em;
  color: rgba(185, 255, 217, 0.6);
  background: rgba(255, 255, 255, 0.04);
  border: 1px dashed rgba(185, 255, 217, 0.25);
}
```

- [ ] **Step 4: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS (no unused `mediaSrc` import remains; `resolveMedia` used).

- [ ] **Step 5: Commit**

```bash
git add web/src/ui/detail-card.ts web/src/style.css
git commit -m "feat(web): blur sensitive and hide blocked art in the detail card"
```

---

### Task 9: Shared placeholder texture (`web`)

**Files:**

- Modify: `web/src/themes/shared/textures.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `sensitivePlaceholderTexture(): THREE.CanvasTexture` (a shared singleton).

- [ ] **Step 1: Add the placeholder texture builder**

In `web/src/themes/shared/textures.ts` (which already imports `THREE` and uses `CanvasTexture`), append:

```ts
let placeholderTex: THREE.CanvasTexture | null = null;

/**
 * Neutral "content hidden" tile shown in WebGL frames (gallery walls, mine
 * paintings) in place of blocked/sensitive NFT art. A single shared instance —
 * the real art is never fetched for filtered NFTs.
 */
export function sensitivePlaceholderTexture(): THREE.CanvasTexture {
  if (placeholderTex) return placeholderTex;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#1b2230";
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "rgba(159, 182, 201, 0.22)";
  ctx.lineWidth = 4;
  for (let i = -size; i < size; i += 12) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + size, size);
    ctx.stroke();
  }
  placeholderTex = new THREE.CanvasTexture(canvas);
  placeholderTex.colorSpace = THREE.SRGBColorSpace;
  return placeholderTex;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add web/src/themes/shared/textures.ts
git commit -m "feat(web): shared neutral placeholder texture for filtered art"
```

---

### Task 10: Apply the filter in the gallery theme (`web`)

**Files:**

- Modify: `web/src/themes/gallery/gallery.ts` (imports line 15-16; the `case "sprout"` NFT branch lines ~113-149)

**Interfaces:**

- Consumes: `resolveMedia` (Task 7); `sensitivePlaceholderTexture` (Task 9). `shouldHang` (unchanged — sensitive/blocked NFTs keep `mediaKind`, so they still qualify for a frame).
- Produces: nothing.

- [ ] **Step 1: Update imports**

In `web/src/themes/gallery/gallery.ts`, change line 16 from:

```ts
import { mediaSrc } from "../../ui/media.js";
```

to:

```ts
import { resolveMedia } from "../../ui/media.js";
import { sensitivePlaceholderTexture } from "../shared/textures.js";
```

(Keep the existing `import { loadArtTexture } from "./media.js";` on line 15.)

- [ ] **Step 2: Replace the NFT hang logic**

Replace the block that currently begins at `if (!event.launcherId) break;` and ends at the closing of the `else if (shouldHang(event) && !pending.has(launcher)) { … }` branch (lines ~113-148) with:

```ts
if (!event.launcherId) break;
const launcher = event.launcherId;
if (pieces.hasLauncher(launcher)) {
  // already hung → register activity on the existing frame, no duplicate
  if (pieces.ping(event)) refreshPlacardIf(launcher);
  break;
}
if (!shouldHang(event) || pending.has(launcher)) break;
const media = resolveMedia(event);
if (media.render === "none") break;
if (media.render !== "art") {
  // blocked/sensitive → hang a neutral placeholder; never fetch the art
  pieces.add(event, sensitivePlaceholderTexture());
  break;
}
const src = media.src;
const kind = media.kind;
pending.add(launcher);
const mySeq = nftSeq++;
artLoads.submit({
  // if this many newer NFTs have queued behind it, this one would be
  // wrapped straight off the wall — skip the fetch (and free its guard)
  stillWanted: () => nftSeq - mySeq < pieces.capacity,
  onDrop: () => pending.delete(launcher),
  start: (done) => {
    loadArtTexture(
      src,
      kind,
      (texture) => {
        done(); // release the pool slot regardless of dedup outcome
        pending.delete(launcher);
        pieces.add(event, texture);
      },
      () => {
        done();
        pending.delete(launcher);
      }
    );
  },
});
break;
```

(This preserves the original `artLoads.submit` behavior for the `art` path; the only changes are the early `hasLauncher`/`shouldHang` breaks and the filtered placeholder branch. `const kind` replaces the previous `event.mediaKind ?? "image"` line — `media.kind` already applied that default.)

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS (no remaining `mediaSrc` reference in this file).

- [ ] **Step 4: Run the gallery tests**

Run: `npx vitest run web/test/gallery-select.test.ts web/test/gallery-pieces.test.ts`
Expected: PASS (logic unchanged for those units).

- [ ] **Step 5: Commit**

```bash
git add web/src/themes/gallery/gallery.ts
git commit -m "feat(web): gallery shows placeholder for filtered NFT art"
```

---

### Task 11: Apply the filter in the mine theme paintings (`web`)

**Files:**

- Modify: `web/src/themes/mine/structures.ts` (imports line 6-7; the painting art-load block lines ~167-193)

**Interfaces:**

- Consumes: `resolveMedia` (Task 7); `sensitivePlaceholderTexture` (Task 9).
- Produces: nothing.

- [ ] **Step 1: Update imports**

In `web/src/themes/mine/structures.ts`, change line 7 from:

```ts
import { mediaSrc } from "../../ui/media.js";
```

to:

```ts
import { resolveMedia } from "../../ui/media.js";
import { sensitivePlaceholderTexture } from "../shared/textures.js";
```

(Keep `import { loadArtTexture } from "../gallery/media.js";` on line 6.)

- [ ] **Step 2: Replace the art-load block**

Replace the block that currently begins at `const src = mediaSrc(event);` and ends at the close of `if (src) { … }` (lines ~167-193) with:

```ts
const media = resolveMedia(event);
if (media.render === "art") {
  const src = media.src;
  const kind = media.kind;
  this.loads.submit({
    // by the time a queued load reaches the front the slot may have been
    // recycled (replay churns hundreds of NFTs through it) — skip the fetch
    stillWanted: () => p.meta === event,
    start: (done) => {
      loadArtTexture(
        src,
        kind,
        (tex) => {
          done(); // free the pool slot regardless of whether we still want the art
          // guard against a slot recycled while this load was in flight
          if (p.meta !== event) return;
          tex.magFilter = THREE.NearestFilter;
          tex.colorSpace = THREE.SRGBColorSpace;
          mat.map = tex;
          mat.color.set(0xffffff);
          mat.needsUpdate = true;
        },
        done
      );
    },
  });
} else if (media.render === "blur" || media.render === "placeholder") {
  // filtered → neutral placeholder texture; never fetch the real art
  mat.map = sensitivePlaceholderTexture();
  mat.color.set(0xffffff);
  mat.needsUpdate = true;
}
// render === "none" → leave the solid placeholder color set above
```

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS (no remaining `mediaSrc` reference in this file).

- [ ] **Step 4: Run the mine tests**

Run: `npx vitest run web/test/mine-structures.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/themes/mine/structures.ts
git commit -m "feat(web): mine paintings show placeholder for filtered NFT art"
```

---

### Task 12: Seed demo events so both paths are exercisable offline (`web`)

**Files:**

- Modify: `web/src/net/demo.ts` (the `if (kind === "nft")` block, lines ~65-72)

**Interfaces:**

- Consumes: `SproutEvent.mediaFilter` (Task 1).
- Produces: nothing.

- [ ] **Step 1: Tag a fraction of demo NFTs**

In `web/src/net/demo.ts`, inside `if (kind === "nft") { … }`, after the existing `if (Math.random() < 0.25) event.mint = true;` line, add:

```ts
// exercise the content filter offline: ~12% sensitive (blur), ~6% blocked (hidden)
const filterRoll = Math.random();
if (filterRoll < 0.06) event.mediaFilter = "blocked";
else if (filterRoll < 0.18) event.mediaFilter = "sensitive";
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Manual verification**

Run: `npm run dev:web`, open `http://localhost:5173/?demo=1`.
Expected:

- Some gallery frames (and mine paintings on `?demo=1&theme=mine`) show the neutral hatched placeholder instead of art.
- Clicking a sensitive NFT shows a blurred image with a "sensitive content" note; clicking a blocked one shows "media unavailable"; both still show amount, ids, and the spacescan/mintgarden links.

- [ ] **Step 4: Commit**

```bash
git add web/src/net/demo.ts
git commit -m "feat(web): seed demo NFTs with sensitive/blocked filters"
```

---

### Task 13: Full verification sweep

**Files:** none.

- [ ] **Step 1: Run the entire suite, typecheck, lint, and a production build**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all PASS (build emits `web/dist/`).

- [ ] **Step 2: Commit any incidental fixes**

```bash
git add -A
git commit -m "chore: verification sweep for content filtering" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage**

- MintGarden as source, blocked/sensitive two-tier mapping, blocked precedence, permissive default → Tasks 3, 4 (`mapMintgarden` + `ContentFilter`).
- Blocked = art bytes unreachable → Task 2 (`MediaIndex.delete`) + Task 4 (`apply` calls it) + Task 7 (`mediaSrc` returns null for blocked).
- Single wire flag + protocol bump → Task 1.
- Enrich before publish, in block order → Tasks 5 (await) + 6 (wire-up).
- Centralized client resolver covering all three pixel surfaces → Task 7 (`resolveMedia`) consumed by Task 8 (detail card, shared by all scenes), Task 10 (gallery), Task 11 (mine).
- WebGL placeholder fidelity → Task 9 (texture) + Tasks 10/11.
- Sensitive = permanent blur in DOM, no reveal → Task 8 (CSS `.sensitive`, no reveal control).
- Demo seeding → Task 12.
- grove/farm/board need no art changes (no NFT image surface; their detail view is the shared card from Task 8) — confirmed by the codebase audit; no task required.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every command has an expected result.

**Type consistency:** `Disposition` ("blocked"|"sensitive"|"ok") used consistently in Tasks 3-4. `MediaDisposition` render tags ("art"|"blur"|"placeholder"|"none") match between Task 7 (producer) and Tasks 8/10/11 (consumers). `mediaFilter` values ("blocked"|"sensitive") match between Task 1 (type), Task 4 (writer), and Task 7 (reader). `ContentFilter(media, opts)` signature in Task 4 matches the call in Task 6. `MediaIndex.delete` in Task 2 matches its use in Task 4.

**Note on test coverage:** The DOM card (Task 8), WebGL themes (Tasks 10-11), placeholder texture (Task 9), and demo seeding (Task 12) are verified by typecheck/lint + manual demo, consistent with the repo's existing approach (rendering/canvas/WebGL code is not unit-tested). The safety-critical decision logic is fully unit-tested where it lives: `mapMintgarden` and `ContentFilter` (server) and `resolveMedia` (web) — the single chokepoint every surface depends on.
