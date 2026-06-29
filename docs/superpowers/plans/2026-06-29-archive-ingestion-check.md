# Archive Ingestion Pre-Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poll `archive.mintgarden.io/nfts/{launcherId}` before calling Google Vision to eliminate the race where the Archive CDN hasn't ingested content yet at the time SafeSearch runs.

**Architecture:** `SafeSearchWorker.run()` gains a pre-check: when `imageUri` starts with the Archive base URL, it calls `waitForArchive(launcherId)` which polls `GET {archiveBaseUrl}/nfts/{launcherId}` up to `archiveCheckAttempts` times looking for `assets[role="data"].fetch_succeeded === true`. On exhaustion it throws, which the existing `catch` block catches — setting `failedUntil` and deferring the retry to the next natural block cycle (same suppression TTL already used for Vision failures). The three new options (`archiveBaseUrl`, `archiveCheckAttempts`, `archiveCheckDelayMs`) flow from `ContentFilterOptions` → `ContentFilter` constructor → `SafeSearchWorker` constructor.

**Tech Stack:** TypeScript, Node ≥ 24, Vitest

## Global Constraints

- No new npm dependencies
- All new options have production-ready defaults: `archiveBaseUrl: "https://archive.mintgarden.io"`, `archiveCheckAttempts: 3`, `archiveCheckDelayMs: 2000`
- `archiveCheckDelayMs: 0` must be respected (no `setTimeout` called when 0) so tests run without real delays
- Exhaustion must NOT call Vision — `waitForArchive` throws, `run()`'s existing `catch` absorbs it
- Non-Archive `imageUri` must skip the check entirely and call Vision directly
- All 333 existing tests must continue to pass
- Uses the existing `fetchImpl` injection — no new fetch dependencies

---

### Task 1: Add `waitForArchive`, thread options, add tests

**Files:**

- Modify: `server/src/content-filter/safesearch-worker.ts`
- Modify: `server/src/content-filter/index.ts` (add 2 options to interface; pass 3 fields to SafeSearchWorker)
- Test: `server/test/content-filter.test.ts`

**Interfaces:**

- Produces on `SafeSearchWorkerOpts`: `archiveBaseUrl?: string`, `archiveCheckAttempts?: number`, `archiveCheckDelayMs?: number`
- Produces on `ContentFilterOptions`: `archiveCheckAttempts?: number`, `archiveCheckDelayMs?: number`
- `archiveBaseUrl` is already on `ContentFilterOptions` from the previous task — just needs to be threaded through to `SafeSearchWorker`

- [ ] **Step 1: Write the five failing tests**

Append to the bottom of `server/test/content-filter.test.ts`:

```ts
// ── Archive ingestion pre-check ──────────────────────────────────────────────

const ARCHIVE_BASE = "https://archive.mintgarden.io";
const ARCHIVE_MEDIA_URL = `${ARCHIVE_BASE}/content/${"ab".repeat(32)}`;

test("SafeSearch calls Archive ingestion check before Vision when imageUri is an Archive URL", async () => {
  const media = new MediaIndex(10);
  media.set("cd".repeat(32), { url: ARCHIVE_MEDIA_URL, kind: "image" });
  const store = new ContentStore(":memory:");
  let archiveCalls = 0,
    visionCalls = 0;
  const filter = new ContentFilter(media, {
    store,
    googleApiKey: "k",
    onFlag: () => {},
    archiveBaseUrl: ARCHIVE_BASE,
    archiveCheckAttempts: 3,
    archiveCheckDelayMs: 0,
    fetchImpl: (async (url: string) => {
      const s = String(url);
      if (s.includes("images:annotate")) {
        visionCalls++;
        return new Response(
          JSON.stringify({ responses: [{ safeSearchAnnotation: { adult: "UNLIKELY" } }] }),
          { status: 200 }
        );
      }
      if (s.includes(`${ARCHIVE_BASE}/nfts/`)) {
        archiveCalls++;
        return new Response(JSON.stringify({ assets: [{ role: "data", fetch_succeeded: true }] }), {
          status: 200,
        });
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch,
  });
  await filter.enrich([nftEvent({ mint: true })]);
  await tick();
  expect(archiveCalls).toBe(1);
  expect(visionCalls).toBe(1);
  store.close();
});

test("SafeSearch retries Archive check until ready then calls Vision", async () => {
  const media = new MediaIndex(10);
  media.set("cd".repeat(32), { url: ARCHIVE_MEDIA_URL, kind: "image" });
  const store = new ContentStore(":memory:");
  let archiveCalls = 0,
    visionCalls = 0;
  const filter = new ContentFilter(media, {
    store,
    googleApiKey: "k",
    onFlag: () => {},
    archiveBaseUrl: ARCHIVE_BASE,
    archiveCheckAttempts: 3,
    archiveCheckDelayMs: 0,
    fetchImpl: (async (url: string) => {
      const s = String(url);
      if (s.includes("images:annotate")) {
        visionCalls++;
        return new Response(
          JSON.stringify({ responses: [{ safeSearchAnnotation: { adult: "UNLIKELY" } }] }),
          { status: 200 }
        );
      }
      if (s.includes(`${ARCHIVE_BASE}/nfts/`)) {
        archiveCalls++;
        const ready = archiveCalls >= 3;
        return new Response(
          JSON.stringify({ assets: [{ role: "data", fetch_succeeded: ready }] }),
          { status: 200 }
        );
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch,
  });
  await filter.enrich([nftEvent({ mint: true })]);
  await tick();
  expect(archiveCalls).toBe(3);
  expect(visionCalls).toBe(1);
  store.close();
});

test("SafeSearch does not call Vision when Archive check is exhausted", async () => {
  const media = new MediaIndex(10);
  media.set("cd".repeat(32), { url: ARCHIVE_MEDIA_URL, kind: "image" });
  const store = new ContentStore(":memory:");
  let archiveCalls = 0,
    visionCalls = 0;
  const filter = new ContentFilter(media, {
    store,
    googleApiKey: "k",
    onFlag: () => {},
    archiveBaseUrl: ARCHIVE_BASE,
    archiveCheckAttempts: 2,
    archiveCheckDelayMs: 0,
    fetchImpl: (async (url: string) => {
      const s = String(url);
      if (s.includes("images:annotate")) {
        visionCalls++;
        return new Response(
          JSON.stringify({ responses: [{ safeSearchAnnotation: { adult: "UNLIKELY" } }] }),
          { status: 200 }
        );
      }
      if (s.includes(`${ARCHIVE_BASE}/nfts/`)) {
        archiveCalls++;
        return new Response(
          JSON.stringify({ assets: [{ role: "data", fetch_succeeded: false }] }),
          { status: 200 }
        );
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch,
  });
  await filter.enrich([nftEvent({ mint: true })]);
  await tick();
  expect(archiveCalls).toBe(2);
  expect(visionCalls).toBe(0);
  store.close();
});

test("SafeSearch skips Archive check when imageUri is not an Archive URL", async () => {
  const media = new MediaIndex(10);
  media.set("cd".repeat(32), { url: "https://ipfs.mintgarden.io/ipfs/abc", kind: "image" });
  const store = new ContentStore(":memory:");
  let archiveCalls = 0,
    visionCalls = 0;
  const filter = new ContentFilter(media, {
    store,
    googleApiKey: "k",
    onFlag: () => {},
    archiveBaseUrl: ARCHIVE_BASE,
    archiveCheckAttempts: 3,
    archiveCheckDelayMs: 0,
    fetchImpl: (async (url: string) => {
      const s = String(url);
      if (s.includes("images:annotate")) {
        visionCalls++;
        return new Response(
          JSON.stringify({ responses: [{ safeSearchAnnotation: { adult: "UNLIKELY" } }] }),
          { status: 200 }
        );
      }
      if (s.includes(`${ARCHIVE_BASE}/nfts/`)) {
        archiveCalls++;
        return new Response(JSON.stringify({ assets: [{ role: "data", fetch_succeeded: true }] }), {
          status: 200,
        });
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch,
  });
  await filter.enrich([nftEvent({ mint: true })]);
  await tick();
  expect(archiveCalls).toBe(0);
  expect(visionCalls).toBe(1);
  store.close();
});

test("SafeSearch treats Archive network error as not-ready and retries to exhaustion", async () => {
  const media = new MediaIndex(10);
  media.set("cd".repeat(32), { url: ARCHIVE_MEDIA_URL, kind: "image" });
  const store = new ContentStore(":memory:");
  let archiveCalls = 0,
    visionCalls = 0;
  const filter = new ContentFilter(media, {
    store,
    googleApiKey: "k",
    onFlag: () => {},
    archiveBaseUrl: ARCHIVE_BASE,
    archiveCheckAttempts: 2,
    archiveCheckDelayMs: 0,
    fetchImpl: (async (url: string) => {
      const s = String(url);
      if (s.includes("images:annotate")) {
        visionCalls++;
        return new Response(
          JSON.stringify({ responses: [{ safeSearchAnnotation: { adult: "UNLIKELY" } }] }),
          { status: 200 }
        );
      }
      if (s.includes(`${ARCHIVE_BASE}/nfts/`)) {
        archiveCalls++;
        throw new Error("network error");
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch,
  });
  await filter.enrich([nftEvent({ mint: true })]);
  await tick();
  expect(archiveCalls).toBe(2);
  expect(visionCalls).toBe(0);
  store.close();
});
```

- [ ] **Step 2: Run tests to verify the 5 new tests fail**

```bash
npx vitest run server/test/content-filter.test.ts 2>&1 | tail -30
```

Expected: 5 new tests fail; existing 333 pass. TypeScript errors are fine at this stage — the new options don't exist yet on `ContentFilterOptions`.

- [ ] **Step 3: Add new options to `SafeSearchWorkerOpts` and implement `waitForArchive`**

Replace the entire contents of `server/src/content-filter/safesearch-worker.ts` with:

```ts
import type { ContentFlagEvent, SproutEvent } from "@grove/shared";
import type { MediaIndex } from "../web/media-index.js";
import type { ContentStore } from "./store.js";
import { querySafeSearch } from "./signals/safesearch.js";

export interface SafeSearchWorkerOpts {
  media: MediaIndex;
  store: ContentStore;
  apiKey: string;
  onFlag: (e: ContentFlagEvent) => void;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  concurrency?: number;
  /** How long a failed lookup is suppressed before another attempt. */
  failTtlMs?: number;
  now?: () => number;
  /** Base URL for the MintGarden Archive API; used for ingestion pre-check. */
  archiveBaseUrl?: string;
  /** Max attempts to poll Archive before giving up (each separated by archiveCheckDelayMs). */
  archiveCheckAttempts?: number;
  /** Milliseconds to wait between Archive poll attempts (0 = no delay). */
  archiveCheckDelayMs?: number;
}

/**
 * Out-of-band SafeSearch path. `maybeEnqueue` is fire-and-forget: eligible image
 * mints whose cheap verdict was `ok` get a single Vision lookup behind a bounded
 * concurrency gate. A `sensitive` result is persisted and pushed to clients as a
 * `content-flag`. Failures leave the NFT permissive and are suppressed for
 * `failTtlMs` so an outage doesn't re-spend the paid quota every block.
 */
const FAILED_UNTIL_CAP = 10000;

export class SafeSearchWorker {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly concurrency: number;
  private readonly failTtlMs: number;
  private readonly now: () => number;
  private readonly archiveBaseUrl: string;
  private readonly archiveCheckAttempts: number;
  private readonly archiveCheckDelayMs: number;
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly queued = new Set<string>();
  private readonly failedUntil = new Map<string, number>();

  constructor(private readonly opts: SafeSearchWorkerOpts) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 8000;
    this.concurrency = opts.concurrency ?? 2;
    this.failTtlMs = opts.failTtlMs ?? 300_000;
    this.now = opts.now ?? Date.now;
    this.archiveBaseUrl = opts.archiveBaseUrl ?? "https://archive.mintgarden.io";
    this.archiveCheckAttempts = opts.archiveCheckAttempts ?? 3;
    this.archiveCheckDelayMs = opts.archiveCheckDelayMs ?? 2000;
  }

  maybeEnqueue(event: SproutEvent): void {
    if (event.kind !== "nft" || event.mediaKind !== "image") return;
    const launcherId = event.launcherId;
    if (!launcherId || this.queued.has(launcherId)) return;
    const media = this.opts.media.get(launcherId);
    if (!media || media.kind !== "image") return;
    const stored = this.opts.store.get(launcherId);
    if (stored?.safesearchChecked) return;
    const until = this.failedUntil.get(launcherId);
    if (until !== undefined && this.now() < until) return;

    this.queued.add(launcherId);
    void this.gate(() => this.run(launcherId, media.url)).finally(() =>
      this.queued.delete(launcherId)
    );
  }

  private async run(launcherId: string, imageUri: string): Promise<void> {
    try {
      if (imageUri.startsWith(this.archiveBaseUrl)) {
        await this.waitForArchive(launcherId);
      }
      const result = await querySafeSearch(imageUri, {
        apiKey: this.opts.apiKey,
        fetchImpl: this.fetchImpl,
        timeoutMs: this.timeoutMs,
      });
      const updated = this.opts.store.putSafeSearch(launcherId, result);
      // on success, clear any prior failure suppression for this launcher
      this.failedUntil.delete(launcherId);
      if (result.sensitive) {
        this.opts.onFlag({
          type: "content-flag",
          launcherId,
          mediaFilter: "sensitive",
          signals: updated.signals,
        });
      }
    } catch (err) {
      console.warn(`[safesearch] failed for ${launcherId} (${imageUri}):`, err);
      this.failedUntil.set(launcherId, this.now() + this.failTtlMs);
      // evict oldest entry if the map has grown too large
      if (this.failedUntil.size > FAILED_UNTIL_CAP) {
        const oldest = this.failedUntil.keys().next().value;
        if (oldest !== undefined) this.failedUntil.delete(oldest);
      }
    }
  }

  private async waitForArchive(launcherId: string): Promise<void> {
    for (let attempt = 0; attempt < this.archiveCheckAttempts; attempt++) {
      if (attempt > 0 && this.archiveCheckDelayMs > 0) {
        await new Promise<void>((r) => setTimeout(r, this.archiveCheckDelayMs));
      }
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        let res: Response;
        try {
          res = await this.fetchImpl(`${this.archiveBaseUrl}/nfts/${launcherId}`, {
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
        if (!res.ok) continue;
        const json = (await res.json()) as {
          assets?: Array<{ role: string; fetch_succeeded: boolean }>;
        };
        if (json.assets?.some((a) => a.role === "data" && a.fetch_succeeded === true)) return;
      } catch {
        // network error or abort → treat as not ready, retry
      }
    }
    throw new Error(`archive not ready after ${this.archiveCheckAttempts} attempts`);
  }

  private gate<T>(fn: () => Promise<T>): Promise<T> {
    const runNow = async (): Promise<T> => {
      this.active++;
      try {
        return await fn();
      } finally {
        this.active--;
        this.waiters.shift()?.();
      }
    };
    if (this.active < this.concurrency) return runNow();
    return new Promise<T>((resolve, reject) => {
      this.waiters.push(() => runNow().then(resolve, reject));
    });
  }
}
```

- [ ] **Step 4: Thread new options through `ContentFilter` → `SafeSearchWorker`**

In `server/src/content-filter/index.ts`, add two lines to `ContentFilterOptions` after the existing `archiveBaseUrl` line (line 30):

```ts
  /** Max attempts to poll the Archive before giving up (each separated by archiveCheckDelayMs). */
  archiveCheckAttempts?: number;
  /** Milliseconds to wait between Archive poll attempts. */
  archiveCheckDelayMs?: number;
```

Replace the `SafeSearchWorker` construction block (currently lines 91-99) with:

```ts
if (opts.store && opts.googleApiKey && opts.onFlag) {
  this.worker = new SafeSearchWorker({
    media,
    store: opts.store,
    apiKey: opts.googleApiKey,
    onFlag: opts.onFlag,
    fetchImpl: opts.fetchImpl,
    archiveBaseUrl: opts.archiveBaseUrl,
    archiveCheckAttempts: opts.archiveCheckAttempts,
    archiveCheckDelayMs: opts.archiveCheckDelayMs,
  });
}
```

- [ ] **Step 5: Run the content-filter tests and verify all pass**

```bash
npx vitest run server/test/content-filter.test.ts 2>&1 | tail -20
```

Expected: 338 tests pass (333 existing + 5 new). Zero failures.

- [ ] **Step 6: Run the full test suite**

```bash
npm test 2>&1 | tail -20
```

Expected: All tests pass.

- [ ] **Step 7: Run typecheck**

```bash
npm run typecheck 2>&1 | tail -20
```

Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add server/src/content-filter/safesearch-worker.ts server/src/content-filter/index.ts server/test/content-filter.test.ts
git commit -m "feat(content-filter): poll Archive ingestion status before SafeSearch

Adds waitForArchive() pre-check in SafeSearchWorker.run(): when
imageUri starts with archiveBaseUrl, polls archive.mintgarden.io/
nfts/{launcherId} up to archiveCheckAttempts times before passing the
URL to Google Vision. Eliminates the race where Vision gets a CDN URL
before the Archive has fetched the content. Exhaustion falls through to
the existing failedUntil suppression (same TTL as Vision failures)."
```
