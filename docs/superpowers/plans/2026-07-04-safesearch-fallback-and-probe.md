# SafeSearch Content-Readiness Probe, Original-URL Fallback & Retry Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the verified gaps in the content-filtering workflow: fall back to the NFT's original art URL when the MintGarden Archive never ingests the content, probe readiness against the actual content URL (covering video posters too), close the URI-dedup double-pay window, and retry unchecked NFTs periodically instead of only on re-spend.

**Architecture:** All changes live in `server/src/content-filter/` (which must stay liftable: it imports only `@grove/shared` types and `MediaIndex`). The SafeSearchWorker's per-NFT Archive JSON poll (`GET /nfts/{launcherId}`) is replaced by a `HEAD` probe of the exact URL Vision will fetch — verified live: `archive.mintgarden.io/content/{hash}` answers **301** (immutable redirect to `files.mintgarden.io`) when ingested and **404** when not; `assets.mainnet.mintgarden.io/thumbnails/…` answers **200**/404 the same way. On probe exhaustion, image NFTs retry Vision once with the original on-chain URL preserved in `MediaEntry.fallbackUrl` (skipping hosts unreachable from Google's fetchers). A periodic sweep re-enqueues eligible launchers from `MediaIndex` so an NFT that failed at mint time gets a verdict without needing a re-spend.

**Tech Stack:** TypeScript (Node ≥ 24, run via tsx, no build step), vitest, `node:sqlite`, undici `fetch`.

## Global Constraints

- Branch: all work happens on `non-archive-fallback` (branched from main at `a85f504`, which already contains the dedup work PR #36 — Task 0 is therefore already satisfied; skip it).
- `server/src/content-filter/` must not gain imports beyond `@grove/shared`, `MediaIndex`, `../util/bounded-map.js`, and `../logger.js` (liftability invariant).
- `SafeSearchWorker.maybeEnqueue` (and anything it calls synchronously) must **never throw** — it is called from `ContentFilter.apply`, which must never reject.
- Only the paid Vision call goes behind the `gate()` concurrency limiter; readiness probing must run outside it.
- Failures stay fail-open: an NFT we cannot check renders permissive; failures are backed off via `failedUntil`/`dedupFailedUntil`, never persisted to SQLite.
- Test style: one behavior per `test()`, plain `test`/`expect` from vitest, in-memory `ContentStore(":memory:")`, `fetchImpl` injection — match the existing files.
- Run a task's test file(s) before every commit; run `npm test && npm run typecheck && npm run lint` before the final commit of the plan.
- Commit messages: descriptive sentence style (match `git log`), ending with trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Subagent execution notes

Per-task dispatch recommendation (cheaper models for well-specified TDD tasks; the orchestrating session reviews between tasks):

| Task | Agent model | Why |
| ---- | ----------- | --- |
| 0 | (main session) | One commit, no code authored |
| 1–4 | `sonnet` | Fully specified TDD tasks with exact code; no design judgment needed |
| 5 | `haiku` | Documentation text is provided verbatim |

## Explicitly deferred (do NOT implement in this plan)

- **Denylist retroactivity** (stored cheap verdicts never re-evaluated when the curated denylist changes): independent cheap-tier feature needing a schema change; separate plan.
- **Persisting failure state across restarts**: restart cost is only cheap HEAD probes (verdicts are persisted; Vision is never called before a probe passes), so in-memory backoff is acceptable.
- **Verifying whether Google bills Vision requests whose image fetch fails**: ops question, not code.

---

### Task 0: Commit the pending `dedupFailedUntil` work

The working tree already contains a finished, tested change (content-level failure backoff). Commit it as-is so Tasks 1–5 start from a clean tree.

**Files:**
- Commit (no edits): `server/src/content-filter/safesearch-worker.ts`, `server/test/safesearch-worker.test.ts`

- [ ] **Step 1: Verify the pending diff is green**

Run: `npx vitest run server/test/safesearch-worker.test.ts`
Expected: all tests PASS (12+ tests, including "a content hash's archive failure suppresses later launchers instead of each re-polling")

- [ ] **Step 2: Commit**

```bash
git add server/src/content-filter/safesearch-worker.ts server/test/safesearch-worker.test.ts
git commit -m "Suppress repeat archive polls per content hash after a failure

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 1: HEAD readiness probe on the content URL (replaces per-NFT Archive JSON polling; adds poster coverage)

Replace `waitForArchive(launcherId)` (GET `${archiveBaseUrl}/nfts/${launcherId}` + JSON `assets[].fetch_succeeded` check) with `waitForContentReady(url)` — a `HEAD` of the exact URL Vision will fetch. This probes the true resource (content-keyed, so it succeeds whenever the bytes are ingested regardless of which launcher we're checking), and extends readiness checking to video posters on the assets CDN, which today burn a Vision attempt when the thumbnail isn't generated yet.

Live-verified CDN behavior (2026-07-04): ingested `archive.mintgarden.io/content/{hash}` → `301` with `location: https://files.mintgarden.io/originals/…` and `cache-control: immutable`; unknown hash → `404`. `assets.mainnet.mintgarden.io/thumbnails/{hash}_512.webp` → `200` HEAD for existing thumbnails. So: **2xx or 3xx = ready; anything else (or a network error) = not ready, retry.** Use `redirect: "manual"` so the probe doesn't pay for a second request following the 301.

**Files:**
- Modify: `server/src/content-filter/safesearch-worker.ts` (opts, `checkVision`, delete `waitForArchive`, add `waitForContentReady` + `needsReadyProbe`)
- Modify: `server/src/content-filter/index.ts:107-117` (pass `thumbnailBaseUrl` to the worker)
- Test: `server/test/safesearch-worker.test.ts`, `server/test/content-filter.test.ts`

**Interfaces:**
- Consumes: existing `SafeSearchWorkerOpts`, `querySafeSearch(imageUri, opts)`.
- Produces (Tasks 2–4 rely on these exact names):
  - `SafeSearchWorkerOpts.thumbnailBaseUrl?: string` (default `"https://assets.mainnet.mintgarden.io/thumbnails"`)
  - `private needsReadyProbe(imageUri: string): boolean`
  - `private waitForContentReady(url: string): Promise<boolean>` (never throws; false = not ready after `archiveCheckAttempts`)
  - `private checkVision(imageUri: string): Promise<SafeSearchResult>` (launcherId param removed)

- [ ] **Step 1: Write the failing tests**

Append to `server/test/safesearch-worker.test.ts`:

```typescript
// ── content-readiness probe: HEAD of the URL Vision will fetch ───────────────
// The archive answers an immutable 301 (to files.mintgarden.io) for ingested
// content and 404 otherwise, so a redirect counts as ready. Probing the content
// URL itself (not /nfts/{launcherId}) means readiness is content-keyed.

test("the readiness probe is a HEAD of the content URL and a redirect counts as ready", async () => {
  const HASH = "1a".repeat(32);
  const CONTENT_URL = `${ARCHIVE}/content/${HASH}`;
  const media = new MediaIndex(10);
  media.set("L1", { url: CONTENT_URL, kind: "image" });
  const store = new ContentStore(":memory:");
  store.putCheap("L1", "nft1", { disposition: "ok" }, HASH);
  const headUrls: string[] = [];
  let visionUri: string | undefined;
  const worker = new SafeSearchWorker({
    media,
    store,
    apiKey: "k",
    onFlag: () => {},
    archiveBaseUrl: ARCHIVE,
    archiveCheckAttempts: 3,
    archiveCheckDelayMs: 0,
    fetchImpl: (async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") {
        headUrls.push(String(url));
        return new Response(null, { status: 301 });
      }
      visionUri = JSON.parse((init?.body as string) ?? "{}").requests?.[0]?.image?.source
        ?.imageUri;
      return visionOk();
    }) as typeof fetch,
  });
  worker.maybeEnqueue(nftEvent());
  await flushMicrotasks();
  expect(headUrls).toEqual([CONTENT_URL]); // one probe, of the content URL itself
  expect(visionUri).toBe(CONTENT_URL);
  expect(store.get("L1")?.safesearchChecked).toBe(true);
  store.close();
});

test("a video poster on the assets CDN is probed for readiness before Vision", async () => {
  const POSTER = "https://assets.mainnet.mintgarden.io/thumbnails/9f_512.webp";
  const media = new MediaIndex(10);
  media.set("V9", { url: "https://ipfs/clip.mp4", kind: "video", thumbnailUrl: POSTER });
  const store = new ContentStore(":memory:");
  store.putCheap("V9", "nftv9", { disposition: "ok" });
  let headCalls = 0;
  let visionCalls = 0;
  const worker = new SafeSearchWorker({
    media,
    store,
    apiKey: "k",
    onFlag: () => {},
    archiveCheckAttempts: 2,
    archiveCheckDelayMs: 0,
    fetchImpl: (async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") {
        headCalls++;
        return new Response(null, { status: 404 }); // thumbnail not generated yet
      }
      if (String(url).includes("images:annotate")) visionCalls++;
      return new Response("{}", { status: 404 });
    }) as typeof fetch,
  });
  worker.maybeEnqueue(nftEvent({ launcherId: "V9", nftId: "nftv9", mediaKind: "video" }));
  await flushMicrotasks();
  expect(headCalls).toBe(2); // probed with retries, like archive URLs
  expect(visionCalls).toBe(0); // no Vision attempt burned on a missing poster
  expect(store.get("V9")?.safesearchChecked).toBe(false);
  store.close();
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run server/test/safesearch-worker.test.ts -t "readiness probe"`
Also: `npx vitest run server/test/safesearch-worker.test.ts -t "assets CDN is probed"`
Expected: FAIL — the first because no HEAD request is made (probe currently GETs `/nfts/L1` and, finding no `assets`, never becomes ready → no Vision call); the second because Vision IS called (`visionCalls` = 1, no probe for poster URLs).

- [ ] **Step 3: Implement the probe**

In `server/src/content-filter/safesearch-worker.ts`:

3a. Add to `SafeSearchWorkerOpts` (after `archiveCheckDelayMs`):

```typescript
  /** Base URL of the assets-CDN poster thumbnails; poster URLs get the same readiness probe. */
  thumbnailBaseUrl?: string;
```

3b. Add the field + constructor default (after `archiveCheckDelayMs` handling):

```typescript
  private readonly thumbnailBaseUrl: string;
```

```typescript
    this.thumbnailBaseUrl = opts.thumbnailBaseUrl ?? "https://assets.mainnet.mintgarden.io/thumbnails";
```

3c. Replace `checkVision` and `waitForArchive` entirely with:

```typescript
  private async checkVision(imageUri: string): Promise<SafeSearchResult> {
    if (this.needsReadyProbe(imageUri)) {
      const ready = await this.waitForContentReady(imageUri);
      if (!ready) {
        throw new Error(`content not ready after ${this.archiveCheckAttempts} attempts`);
      }
    }
    return this.gate(() =>
      querySafeSearch(imageUri, {
        apiKey: this.opts.apiKey,
        fetchImpl: this.fetchImpl,
        timeoutMs: this.timeoutMs,
      })
    );
  }

  /** MintGarden's ingestion-lagged CDNs, where a probe from here predicts what
   *  Google's fetcher will see. Other hosts are checked blind: our reachability
   *  says nothing about Google's (e.g. gateways that block Google's IP ranges). */
  private needsReadyProbe(imageUri: string): boolean {
    return imageUri.startsWith(this.archiveBaseUrl) || imageUri.startsWith(this.thumbnailBaseUrl);
  }

  // Runs outside the Vision gate, so a not-yet-ingested NFT sleeps between polls
  // without occupying a paid-call slot; many waits proceed in parallel (capped by
  // maxPending, which bounds concurrent probes too). HEAD of the exact URL Vision
  // will fetch: ingested archive content answers an immutable 301 (to
  // files.mintgarden.io), existing thumbnails 200, missing content 404 — so any
  // 2xx/3xx is ready and everything else (incl. network errors) retries.
  private async waitForContentReady(url: string): Promise<boolean> {
    for (let attempt = 0; attempt < this.archiveCheckAttempts; attempt++) {
      if (attempt > 0 && this.archiveCheckDelayMs > 0) {
        await new Promise<void>((r) => setTimeout(r, this.archiveCheckDelayMs));
      }
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        let res: Response;
        try {
          res = await this.fetchImpl(url, {
            method: "HEAD",
            redirect: "manual",
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
        if (res.ok || (res.status >= 300 && res.status < 400)) return true;
      } catch {
        // network error or abort → treat as not ready, retry
      }
    }
    return false;
  }
```

3d. Update the one call site in `run()`: `this.checkVision(launcherId, imageUri)` → `this.checkVision(imageUri)`.

3e. In `server/src/content-filter/index.ts`, worker construction (line ~107), add one option:

```typescript
        thumbnailBaseUrl: THUMBNAIL_BASE_URL,
```

- [ ] **Step 4: Migrate existing test mocks from `/nfts/` JSON polling to HEAD**

In `server/test/safesearch-worker.test.ts`:

4a. Replace the `archiveReady` helper (near line 134) with:

```typescript
const headOk = (): Response => new Response(null, { status: 200 });
```

4b. Test "archive readiness waits run concurrently…" (~line 139) — replace its `fetchImpl` with:

```typescript
    fetchImpl: (async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") {
        archiveActive++;
        archivePeak = Math.max(archivePeak, archiveActive);
        await held;
        archiveActive--;
        return headOk();
      }
      if (String(url).includes("images:annotate")) return visionOk();
      return new Response("{}", { status: 404 });
    }) as typeof fetch,
```

4c. Test "maybeEnqueue drops work beyond maxPending…" (~line 217) — replace its `fetchImpl` with (the `polled` set now keys by content URL; assertions unchanged):

```typescript
    fetchImpl: (async (url: string, init?: RequestInit) => {
      const s = String(url);
      if (init?.method === "HEAD") {
        polled.add(s);
        await held;
        return headOk();
      }
      if (s.includes("images:annotate")) return visionOk();
      return new Response("{}", { status: 404 });
    }) as typeof fetch,
```

4d. Test "a video NFT is SafeSearch-checked against its thumbnail poster…" (~line 259) — its poster URL is on the assets CDN, so it now gets probed first. Add a HEAD branch at the top of its `fetchImpl`:

```typescript
    fetchImpl: (async (_url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return headOk();
      visionUri = JSON.parse((init?.body as string) ?? "{}").requests?.[0]?.image?.source?.imageUri;
      return new Response(
        JSON.stringify({ responses: [{ safeSearchAnnotation: { adult: "VERY_LIKELY" } }] }),
        { status: 200 }
      );
    }) as typeof fetch,
```

4e. Test "a content hash's archive failure suppresses later launchers…" (~line 511) — replace the `/nfts/` counting line inside its `fetchImpl`:

```typescript
    fetchImpl: (async (_url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") {
        archiveCalls++;
        return new Response(null, { status: 404 }); // never ready
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch,
```

(`expect(archiveCalls).toBe(2)` still holds — only the leader's own attempts run.)

In `server/test/content-filter.test.ts`, the four Archive pre-check tests (~lines 562-750) intercept `${ARCHIVE_BASE}/nfts/` or the `archive.mintgarden.io` hostname and return `assets` JSON. Convert each the same way; the counters and assertions keep their exact values. In each, widen the mock signature to `(async (url: string, init?: RequestInit) =>` so the HEAD branch can inspect `init` (prefix `url` with `_` if the migrated body no longer reads it):

4f. "SafeSearch receives Archive CDN URL when data_hash is present" (~line 562) — replace the hostname branch:

```typescript
      if (init?.method === "HEAD") {
        return new Response(null, { status: 200 });
      }
```

4g. "SafeSearch calls Archive ingestion check before Vision…" (~line 603) — rename the test to `"SafeSearch HEAD-probes the content URL before Vision when it is an Archive URL"` and replace the `/nfts/` branch (note the added `init` parameter on the mock):

```typescript
      if (init?.method === "HEAD") {
        archiveCalls++;
        return new Response(null, { status: 200 });
      }
```

4h. "SafeSearch retries Archive check until ready then calls Vision" (~line 641):

```typescript
      if (init?.method === "HEAD") {
        archiveCalls++;
        return new Response(null, { status: archiveCalls >= 3 ? 200 : 404 });
      }
```

4i. "SafeSearch does not call Vision when Archive check is exhausted" (~line 681):

```typescript
      if (init?.method === "HEAD") {
        archiveCalls++;
        return new Response(null, { status: 404 });
      }
```

4j. "SafeSearch skips Archive check when imageUri is not an Archive URL" (~line 720) — same HEAD-counting branch as 4i; its media URL (`https://ipfs.mintgarden.io/ipfs/abc`) matches neither probe base, so `archiveCalls` stays 0 as asserted.

If any other test in these two files fails after the change, it means its mock media URL matches a probe base but the mock lacks a HEAD branch — apply the same pattern.

- [ ] **Step 5: Run both test files**

Run: `npx vitest run server/test/safesearch-worker.test.ts server/test/content-filter.test.ts`
Expected: ALL PASS (including both new tests from Step 1)

- [ ] **Step 6: Commit**

```bash
git add server/src/content-filter/safesearch-worker.ts server/src/content-filter/index.ts server/test/safesearch-worker.test.ts server/test/content-filter.test.ts
git commit -m "Probe content readiness with a HEAD of the media URL itself

Replaces the per-NFT archive JSON poll: content-keyed, covers video
posters on the assets CDN, and a 301 (immutable redirect for ingested
content) counts as ready.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Fall back to the original art URL when the Archive never ingests the content

When the readiness probe exhausts its attempts for an **image** NFT, retry Vision once with the original on-chain URL preserved in `MediaEntry.fallbackUrl` — unless that URL's host is known-unreachable from Google's fetchers (`ipfs.mintgarden.io`, the reason the Archive upgrade exists). Videos never fall back: the fallback is the raw clip, which Vision cannot decode. The verdict row records the URI actually checked (`checked_uri`), and `content_hash` is untouched (already stored by `putCheap`), so hash-keyed dedup keeps working across the fallback.

**Files:**
- Modify: `server/src/content-filter/safesearch-worker.ts`
- Test: `server/test/safesearch-worker.test.ts`

**Interfaces:**
- Consumes (from Task 1): `needsReadyProbe(imageUri)`, `waitForContentReady(url): Promise<boolean>`, `thumbnailBaseUrl`.
- Produces (Task 3 relies on these exact names):
  - `interface VisionOutcome { result: SafeSearchResult; checkedUri: string }` (module-local, not exported)
  - `private readonly dedupInflight: Map<string, Promise<VisionOutcome>>`
  - `private run(launcherId: string, imageUri: string, contentHash?: string, fallbackUri?: string): Promise<void>`
  - `private checkVision(imageUri: string, fallbackUri?: string): Promise<VisionOutcome>`
  - `private usableFallback(imageUri: string, fallbackUri?: string): string | undefined`

- [ ] **Step 1: Write the failing tests**

Append to `server/test/safesearch-worker.test.ts`:

```typescript
// ── original-URL fallback when the Archive never ingests the content ─────────
// The archive URL upgrade exists because ipfs.mintgarden.io blocks Google's IP
// ranges — so the fallback skips that host, but plain HTTPS art (nftstorage
// gateways etc.) is worth one Vision attempt instead of giving up entirely.

test("archive never ready + reachable original URL → Vision checks the fallback", async () => {
  const HASH = "2b".repeat(32);
  const ORIGINAL = "https://bafy.nftstorage.link/1.png";
  const media = new MediaIndex(10);
  media.set("L1", { url: `${ARCHIVE}/content/${HASH}`, kind: "image", fallbackUrl: ORIGINAL });
  const store = new ContentStore(":memory:");
  store.putCheap("L1", "nft1", { disposition: "ok" }, HASH);
  let visionUri: string | undefined;
  const worker = new SafeSearchWorker({
    media,
    store,
    apiKey: "k",
    onFlag: () => {},
    archiveBaseUrl: ARCHIVE,
    archiveCheckAttempts: 2,
    archiveCheckDelayMs: 0,
    fetchImpl: (async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 404 });
      visionUri = JSON.parse((init?.body as string) ?? "{}").requests?.[0]?.image?.source
        ?.imageUri;
      return visionOk();
    }) as typeof fetch,
  });
  worker.maybeEnqueue(nftEvent());
  await flushMicrotasks();
  expect(visionUri).toBe(ORIGINAL);
  expect(store.get("L1")?.safesearchChecked).toBe(true);
  // checked_uri records the URL actually classified, so URI dedup finds it
  expect(store.getSafeSearchByUri(ORIGINAL)?.adult).toBe("UNLIKELY");
  store.close();
});

test("a fallback on a Google-unreachable gateway is not attempted", async () => {
  const HASH = "3c".repeat(32);
  const media = new MediaIndex(10);
  media.set("L1", {
    url: `${ARCHIVE}/content/${HASH}`,
    kind: "image",
    fallbackUrl: "https://ipfs.mintgarden.io/ipfs/abc",
  });
  const store = new ContentStore(":memory:");
  store.putCheap("L1", "nft1", { disposition: "ok" }, HASH);
  let visionCalls = 0;
  const worker = new SafeSearchWorker({
    media,
    store,
    apiKey: "k",
    onFlag: () => {},
    archiveBaseUrl: ARCHIVE,
    archiveCheckAttempts: 1,
    archiveCheckDelayMs: 0,
    fetchImpl: (async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 404 });
      if (String(url).includes("images:annotate")) visionCalls++;
      return new Response("{}", { status: 404 });
    }) as typeof fetch,
  });
  worker.maybeEnqueue(nftEvent());
  await flushMicrotasks();
  expect(visionCalls).toBe(0); // guaranteed-failure host: fail and back off instead
  expect(store.get("L1")?.safesearchChecked).toBe(false);
  store.close();
});

test("a video NFT never falls back to the raw clip when its poster is not ready", async () => {
  const POSTER = "https://assets.mainnet.mintgarden.io/thumbnails/4d_512.webp";
  const media = new MediaIndex(10);
  media.set("V1", {
    url: "https://gw.example/clip.mp4",
    kind: "video",
    thumbnailUrl: POSTER,
    fallbackUrl: "https://gw.example/clip.mp4",
  });
  const store = new ContentStore(":memory:");
  store.putCheap("V1", "nftv", { disposition: "ok" });
  let visionCalls = 0;
  const worker = new SafeSearchWorker({
    media,
    store,
    apiKey: "k",
    onFlag: () => {},
    archiveCheckAttempts: 1,
    archiveCheckDelayMs: 0,
    fetchImpl: (async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 404 });
      if (String(url).includes("images:annotate")) visionCalls++;
      return new Response("{}", { status: 404 });
    }) as typeof fetch,
  });
  worker.maybeEnqueue(nftEvent({ launcherId: "V1", nftId: "nftv", mediaKind: "video" }));
  await flushMicrotasks();
  expect(visionCalls).toBe(0); // Vision can't decode video frames
  store.close();
});

test("a sensitive verdict reached via the fallback URL still emits a content-flag", async () => {
  const HASH = "5e".repeat(32);
  const ORIGINAL = "https://bafy.nftstorage.link/2.png";
  const media = new MediaIndex(10);
  media.set("L1", { url: `${ARCHIVE}/content/${HASH}`, kind: "image", fallbackUrl: ORIGINAL });
  const store = new ContentStore(":memory:");
  store.putCheap("L1", "nft1", { disposition: "ok" }, HASH);
  const flags: ContentFlagEvent[] = [];
  const worker = new SafeSearchWorker({
    media,
    store,
    apiKey: "k",
    onFlag: (e) => flags.push(e),
    archiveBaseUrl: ARCHIVE,
    archiveCheckAttempts: 1,
    archiveCheckDelayMs: 0,
    fetchImpl: (async (_url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 404 });
      return new Response(
        JSON.stringify({ responses: [{ safeSearchAnnotation: { adult: "VERY_LIKELY" } }] }),
        { status: 200 }
      );
    }) as typeof fetch,
  });
  worker.maybeEnqueue(nftEvent());
  await flushMicrotasks();
  expect(flags).toEqual([{ type: "content-flag", launcherId: "L1", mediaFilter: "sensitive" }]);
  expect(store.get("L1")?.disposition).toBe("sensitive");
  store.close();
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run server/test/safesearch-worker.test.ts -t "fallback"`
Expected: the two positive tests FAIL (no Vision call happens today — probe exhaustion throws); the unreachable-gateway and video tests PASS already (current behavior is "give up") — they are regression guards pinning what must NOT change.

- [ ] **Step 3: Implement the fallback**

In `server/src/content-filter/safesearch-worker.ts`:

3a. Add near the top of the file (after `DEFAULT_MAX_PENDING`):

```typescript
/** Hosts Google's image fetcher cannot reach (the reason the Archive upgrade
 *  exists) — a Vision call against them is a guaranteed failure, so don't pay
 *  the attempt. */
const GOOGLE_UNREACHABLE_HOSTS = new Set(["ipfs.mintgarden.io"]);

interface VisionOutcome {
  result: SafeSearchResult;
  checkedUri: string;
}
```

3b. Change the inflight map's value type:

```typescript
  private readonly dedupInflight = new Map<string, Promise<VisionOutcome>>();
```

3c. In `maybeEnqueue`, capture the fallback (only images can use one — a video's
fallback is the raw clip) and pass it through. Replace the final `void this.run(...)` block with:

```typescript
    // Only images can fall back to the on-chain original: a video's fallback is
    // the raw clip, which Vision cannot decode.
    const fallbackUri = media.kind === "image" ? media.fallbackUrl : undefined;
    this.queued.add(launcherId);
    // run() is not gated: its content-readiness wait is cheap polling that must
    // not occupy a Vision slot. Only the paid Vision call inside run() is gated.
    void this.run(launcherId, imageUri, stored?.contentHash, fallbackUri).finally(() =>
      this.queued.delete(launcherId)
    );
```

3d. Update `run()` — new signature and the leader/follower persist paths:

```typescript
  private async run(
    launcherId: string,
    imageUri: string,
    contentHash?: string,
    fallbackUri?: string
  ): Promise<void> {
```

Inside the `try`, the follower branch becomes:

```typescript
      const inflight = this.dedupInflight.get(dedupKey);
      if (inflight) {
        this.persistVerdict(launcherId, imageUri, (await inflight).result, "reused");
        return;
      }
```

and the leader branch becomes:

```typescript
      const work = this.checkVision(imageUri, fallbackUri);
      this.dedupInflight.set(dedupKey, work);
      // .finally() derives a new promise; it must carry its own rejection
      // handler; the "real" rejection is still caught below via `await work`.
      work.finally(() => this.dedupInflight.delete(dedupKey)).catch(() => {});
      const outcome = await work;
      this.persistVerdict(launcherId, outcome.checkedUri, outcome.result, "vision");
```

3e. Replace `checkVision` (from Task 1) with the fallback-aware version, and add `usableFallback`:

```typescript
  private async checkVision(imageUri: string, fallbackUri?: string): Promise<VisionOutcome> {
    let target = imageUri;
    if (this.needsReadyProbe(imageUri)) {
      const ready = await this.waitForContentReady(imageUri);
      if (!ready) {
        const fallback = this.usableFallback(imageUri, fallbackUri);
        if (!fallback) {
          throw new Error(`content not ready after ${this.archiveCheckAttempts} attempts`);
        }
        // MintGarden never ingested these bytes; classify the on-chain original
        // instead of giving up. checked_uri records what was actually classified.
        target = fallback;
      }
    }
    const result = await this.gate(() =>
      querySafeSearch(target, {
        apiKey: this.opts.apiKey,
        fetchImpl: this.fetchImpl,
        timeoutMs: this.timeoutMs,
      })
    );
    return { result, checkedUri: target };
  }

  /** The original art URL, if it is worth one Vision attempt: http(s), distinct
   *  from what we already tried, and not on a host Google cannot reach. */
  private usableFallback(imageUri: string, fallbackUri?: string): string | undefined {
    if (!fallbackUri || fallbackUri === imageUri) return undefined;
    try {
      const u = new URL(fallbackUri);
      if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
      if (GOOGLE_UNREACHABLE_HOSTS.has(u.hostname)) return undefined;
      return fallbackUri;
    } catch {
      return undefined;
    }
  }
```

- [ ] **Step 4: Run the worker test file**

Run: `npx vitest run server/test/safesearch-worker.test.ts`
Expected: ALL PASS (new fallback tests plus all existing coalescing/backoff tests)

- [ ] **Step 5: Run the content-filter file too (it constructs the worker end-to-end)**

Run: `npx vitest run server/test/content-filter.test.ts`
Expected: ALL PASS — in particular "SafeSearch does not call Vision when Archive check is exhausted" still passes because its media entry has no `fallbackUrl`.

- [ ] **Step 6: Commit**

```bash
git add server/src/content-filter/safesearch-worker.ts server/test/safesearch-worker.test.ts
git commit -m "Fall back to the original art URL when the Archive never ingests content

Images only, one attempt, skipping hosts Google's fetcher cannot reach;
checked_uri records the URL actually classified so dedup keeps working.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Second-chance URI dedup when the hash lookup misses

Closes the double-pay window: content checked under its URI before MintGarden resolved a hash (row has `checked_uri`, NULL `content_hash`) is invisible to a later launcher that *does* have the hash — its `imageUri` is the archive URL, so neither lookup matches. Its `fallbackUrl`, however, is the original URI that WAS checked. Try it before paying.

**Files:**
- Modify: `server/src/content-filter/safesearch-worker.ts` (the `prior` lookup in `run()`)
- Test: `server/test/safesearch-worker.test.ts`

**Interfaces:**
- Consumes (from Task 2): `run(launcherId, imageUri, contentHash?, fallbackUri?)`, `store.getSafeSearchByUri(uri)`, `store.getSafeSearchByContentHash(hash)`.
- Produces: no new names; behavior only.

- [ ] **Step 1: Write the failing test**

Append to `server/test/safesearch-worker.test.ts`:

```typescript
test("a hash-keyed launcher reuses a verdict recorded earlier under the original URI", async () => {
  const HASH = "6f".repeat(32);
  const ORIGINAL = "https://gw.example/ipfs/xyz";
  const store = new ContentStore(":memory:");
  // Lold was checked before MintGarden resolved a hash: its row has a
  // checked_uri but a NULL content_hash.
  store.putCheap("Lold", "nftold", { disposition: "ok" });
  store.putSafeSearch("Lold", { sensitive: false, adult: "UNLIKELY", raw: {} }, ORIGINAL);
  // Lnew shares the bytes and DOES have the hash, so its media URL is the
  // archive content URL and its fallback is the original URI.
  const media = new MediaIndex(10);
  media.set("Lnew", { url: `${ARCHIVE}/content/${HASH}`, kind: "image", fallbackUrl: ORIGINAL });
  store.putCheap("Lnew", "nftnew", { disposition: "ok" }, HASH);
  let fetchCalls = 0;
  const worker = new SafeSearchWorker({
    media,
    store,
    apiKey: "k",
    onFlag: () => {},
    archiveBaseUrl: ARCHIVE,
    archiveCheckAttempts: 1,
    archiveCheckDelayMs: 0,
    fetchImpl: (async () => {
      fetchCalls++;
      return new Response("{}", { status: 404 });
    }) as typeof fetch,
  });
  worker.maybeEnqueue(nftEvent({ launcherId: "Lnew", nftId: "nftnew" }));
  await flushMicrotasks();
  expect(fetchCalls).toBe(0); // no probe, no Vision: the URI row satisfied the check
  expect(store.get("Lnew")?.safesearchChecked).toBe(true);
  store.close();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run server/test/safesearch-worker.test.ts -t "recorded earlier under the original URI"`
Expected: FAIL — `fetchCalls` is ≥ 1 (the hash lookup misses, so the worker probes the archive URL).

- [ ] **Step 3: Implement the second-chance lookup**

In `run()`, replace:

```typescript
      const prior = contentHash
        ? this.opts.store.getSafeSearchByContentHash(contentHash)
        : this.opts.store.getSafeSearchByUri(imageUri);
```

with:

```typescript
      // Second chance on a hash miss: content checked before MintGarden resolved
      // its hash sits in a row with a checked_uri and a NULL content_hash. This
      // launcher's fallbackUri is that same original URI, so one extra indexed
      // SELECT can save a paid Vision call. (When contentHash is undefined,
      // fallbackUri is too — media is never Archive-upgraded without a hash.)
      const prior =
        (contentHash
          ? this.opts.store.getSafeSearchByContentHash(contentHash)
          : this.opts.store.getSafeSearchByUri(imageUri)) ??
        (fallbackUri ? this.opts.store.getSafeSearchByUri(fallbackUri) : undefined);
```

- [ ] **Step 4: Run the worker tests**

Run: `npx vitest run server/test/safesearch-worker.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/content-filter/safesearch-worker.ts server/test/safesearch-worker.test.ts
git commit -m "Reuse URI-keyed verdicts when the content-hash dedup lookup misses

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Periodic sweep so unchecked NFTs get a verdict without a re-spend

Today a retry after failure only happens when the same NFT (or one sharing its content) is spent again. A mint whose content lagged Archive ingestion and is never re-spent stays unchecked forever while the server runs. Add `SafeSearchWorker.sweep()` — re-attempt every eligible launcher still in `MediaIndex` — and have `ContentFilter` call it on an unref'd interval (`SAFESEARCH_SWEEP_INTERVAL_MS`, default 10 min, 0 disables). All existing guards (checked flag, failure backoff, `maxPending`, in-flight coalescing) apply to swept launchers automatically; the sweep additionally skips launchers whose cheap disposition is not `ok`, since ContentFilter's ok-gate isn't in front of it. Cost when idle: one synchronous SQLite point-read per MediaIndex entry every interval — negligible at the 10-minute default.

**Files:**
- Modify: `server/src/util/bounded-map.ts` (add `entries()`)
- Modify: `server/src/web/media-index.ts` (add `entries()`)
- Modify: `server/src/content-filter/safesearch-worker.ts` (extract `tryEnqueue`, add `sweep()`, disposition guard)
- Modify: `server/src/content-filter/index.ts` (sweep interval + `close()`)
- Modify: `server/src/index.ts:55-60` (pass env-configured interval)
- Modify: `server/CLAUDE.md` (env table row)
- Test: `server/test/bounded-map.test.ts`, `server/test/media-index.test.ts`, `server/test/safesearch-worker.test.ts`, `server/test/content-filter.test.ts`

**Interfaces:**
- Consumes (from Tasks 1–3): `tryEnqueue` body is the current `maybeEnqueue` logic including `fallbackUri` capture and `run(launcherId, imageUri, contentHash?, fallbackUri?)`.
- Produces:
  - `BoundedMap.entries(): IterableIterator<[K, V]>`
  - `MediaIndex.entries(): IterableIterator<[string, MediaEntry]>`
  - `SafeSearchWorker.sweep(): void` (public)
  - `ContentFilterOptions.safesearchSweepIntervalMs?: number` (default `600_000`; `<= 0` disables)
  - `ContentFilter.close(): void`

- [ ] **Step 1: Write the failing collection tests**

Append to `server/test/bounded-map.test.ts`:

```typescript
test("entries() iterates insertion order and reflects eviction", () => {
  const m = new BoundedMap<string, number>(2);
  m.set("a", 1);
  m.set("b", 2);
  m.set("c", 3); // evicts "a"
  expect([...m.entries()]).toEqual([
    ["b", 2],
    ["c", 3],
  ]);
});
```

Append to `server/test/media-index.test.ts`:

```typescript
test("entries() yields every stored launcherId with its media entry", () => {
  const media = new MediaIndex(10);
  media.set("L1", { url: "https://e/a.png", kind: "image" });
  media.set("L2", { url: "https://e/b.mp4", kind: "video" });
  expect([...media.entries()].map(([id]) => id)).toEqual(["L1", "L2"]);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run server/test/bounded-map.test.ts server/test/media-index.test.ts`
Expected: FAIL with "entries is not a function" (both files' other tests pass)

- [ ] **Step 3: Implement `entries()` on both collections**

In `server/src/util/bounded-map.ts`, after `delete`:

```typescript
  entries(): IterableIterator<[K, V]> {
    return this.map.entries();
  }
```

In `server/src/web/media-index.ts`, after `delete`:

```typescript
  /** Iterate every stored [launcherId, entry] pair (insertion order). */
  entries(): IterableIterator<[string, MediaEntry]> {
    return this.store.entries();
  }
```

- [ ] **Step 4: Run them again**

Run: `npx vitest run server/test/bounded-map.test.ts server/test/media-index.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Write the failing sweep tests**

Append to `server/test/safesearch-worker.test.ts`:

```typescript
// ── periodic sweep: retry unchecked NFTs without waiting for a re-spend ──────

test("sweep() re-attempts an unchecked NFT without a new spend", async () => {
  const media = new MediaIndex(10);
  media.set("L1", { url: "https://e/x.png", kind: "image" });
  const store = new ContentStore(":memory:");
  store.putCheap("L1", "nft1", { disposition: "ok" });
  let visionCalls = 0;
  const worker = new SafeSearchWorker({
    media,
    store,
    apiKey: "k",
    onFlag: () => {},
    fetchImpl: (async () => {
      visionCalls++;
      return visionOk();
    }) as typeof fetch,
  });
  worker.sweep(); // no maybeEnqueue — the sweep alone finds it
  await flushMicrotasks();
  expect(visionCalls).toBe(1);
  expect(store.get("L1")?.safesearchChecked).toBe(true);
  store.close();
});

test("sweep() skips launchers whose cheap disposition is not ok", async () => {
  const media = new MediaIndex(10);
  media.set("L1", { url: "https://e/x.png", kind: "image" });
  const store = new ContentStore(":memory:");
  store.putCheap("L1", "nft1", { disposition: "sensitive" });
  let visionCalls = 0;
  const worker = new SafeSearchWorker({
    media,
    store,
    apiKey: "k",
    onFlag: () => {},
    fetchImpl: (async () => {
      visionCalls++;
      return visionOk();
    }) as typeof fetch,
  });
  worker.sweep();
  await flushMicrotasks();
  expect(visionCalls).toBe(0); // SafeSearch can only upgrade ok → sensitive; nothing to gain
  store.close();
});

test("sweep() skips already-checked launchers", async () => {
  const media = new MediaIndex(10);
  media.set("L1", { url: "https://e/x.png", kind: "image" });
  const store = new ContentStore(":memory:");
  store.putCheap("L1", "nft1", { disposition: "ok" });
  store.putSafeSearch("L1", { sensitive: false, adult: "UNLIKELY", raw: {} }, "https://e/x.png");
  let visionCalls = 0;
  const worker = new SafeSearchWorker({
    media,
    store,
    apiKey: "k",
    onFlag: () => {},
    fetchImpl: (async () => {
      visionCalls++;
      return visionOk();
    }) as typeof fetch,
  });
  worker.sweep();
  await flushMicrotasks();
  expect(visionCalls).toBe(0);
  store.close();
});

test("sweep() respects the failure backoff until the TTL lapses", async () => {
  const media = new MediaIndex(10);
  media.set("L1", { url: "https://e/x.png", kind: "image" });
  const store = new ContentStore(":memory:");
  store.putCheap("L1", "nft1", { disposition: "ok" });
  let fakeNow = 0;
  let fail = true;
  let visionCalls = 0;
  const worker = new SafeSearchWorker({
    media,
    store,
    apiKey: "k",
    onFlag: () => {},
    now: () => fakeNow,
    failTtlMs: 300_000,
    fetchImpl: (async () => {
      if (fail) throw new Error("vision down");
      visionCalls++;
      return visionOk();
    }) as typeof fetch,
  });
  worker.maybeEnqueue(nftEvent());
  await flushMicrotasks(); // fails → backed off until fakeNow + 300000
  fail = false;
  worker.sweep();
  await flushMicrotasks();
  expect(visionCalls).toBe(0); // still inside the backoff window
  fakeNow = 300_001;
  worker.sweep();
  await flushMicrotasks();
  expect(visionCalls).toBe(1); // TTL lapsed → the sweep retries
  expect(store.get("L1")?.safesearchChecked).toBe(true);
  store.close();
});
```

- [ ] **Step 6: Run them to verify they fail**

Run: `npx vitest run server/test/safesearch-worker.test.ts -t "sweep"`
Expected: FAIL with "worker.sweep is not a function"

- [ ] **Step 7: Implement `sweep()` in the worker**

In `server/src/content-filter/safesearch-worker.ts`, replace the whole `maybeEnqueue` method with:

```typescript
  maybeEnqueue(event: SproutEvent): void {
    if (event.kind !== "nft" || !event.launcherId) return;
    this.tryEnqueue(event.launcherId);
  }

  /** Re-attempt every launcher still in MediaIndex that remains eligible
   *  (unchecked, cheap-ok, not backed off). Lets an NFT whose content lagged
   *  Archive ingestion at mint time get a verdict without waiting for a
   *  re-spend. All the usual guards apply, so a sweep is cheap when idle:
   *  one synchronous store point-read per entry. */
  sweep(): void {
    for (const [launcherId] of this.opts.media.entries()) this.tryEnqueue(launcherId);
  }

  private tryEnqueue(launcherId: string): void {
    if (this.queued.has(launcherId)) return;
    const media = this.opts.media.get(launcherId);
    if (!media) return;
    // The image Vision classifies: the art itself for images, the static poster
    // for videos (Vision can't decode video frames). Best-effort — a video with
    // no resolved thumbnail, or an audio NFT, has nothing to classify, so skip.
    const imageUri =
      media.kind === "image" ? media.url : media.kind === "video" ? media.thumbnailUrl : undefined;
    if (!imageUri) return;
    let stored;
    try {
      stored = this.opts.store.get(launcherId);
    } catch (err) {
      // Called synchronously from ContentFilter.apply, which must never reject.
      // A store read failure means we can't honor the safesearchChecked guard,
      // so skip (don't burn paid Vision quota un-deduped) rather than throw.
      log.warn(
        { launcherId, err: err instanceof Error ? err.message : String(err) },
        "safesearch: store.get failed (skipping)"
      );
      return;
    }
    // The sweep path has no ContentFilter ok-gate in front of it, so guard here:
    // SafeSearch can only upgrade ok → sensitive, so anything already flagged
    // (or blocked) has nothing to gain from a paid check.
    if (stored && stored.disposition !== "ok") return;
    if (stored?.safesearchChecked) return;
    const until = this.failedUntil.get(launcherId);
    if (until !== undefined && this.now() < until) return;
    // Bound total in-flight work. Dropped launchers are picked up on a later
    // spend or sweep, or after failedUntil lapses — acceptable for an
    // out-of-band path.
    if (this.queued.size >= this.maxPending) return;

    // Only images can fall back to the on-chain original: a video's fallback is
    // the raw clip, which Vision cannot decode.
    const fallbackUri = media.kind === "image" ? media.fallbackUrl : undefined;
    this.queued.add(launcherId);
    // run() is not gated: its content-readiness wait is cheap polling that must
    // not occupy a Vision slot. Only the paid Vision call inside run() is gated.
    void this.run(launcherId, imageUri, stored?.contentHash, fallbackUri).finally(() =>
      this.queued.delete(launcherId)
    );
  }
```

(This is the existing `maybeEnqueue` body verbatim — including Task 2's `fallbackUri` capture — plus the event-guard extraction and the new `stored.disposition !== "ok"` guard.)

- [ ] **Step 8: Run the worker tests**

Run: `npx vitest run server/test/safesearch-worker.test.ts`
Expected: ALL PASS

- [ ] **Step 9: Write the failing ContentFilter wiring test**

In `server/test/content-filter.test.ts`, change the vitest import at line 1 to include `vi`:

```typescript
import { expect, test, vi } from "vitest";
```

Append:

```typescript
// ── periodic SafeSearch sweep wiring ─────────────────────────────────────────

test("the sweep interval re-checks an unchecked NFT without a new spend, and close() stops it", async () => {
  vi.useFakeTimers();
  try {
    const media = new MediaIndex(10);
    media.set("cd".repeat(32), { url: "https://e/x.png", kind: "image" });
    const store = new ContentStore(":memory:");
    store.putCheap("cd".repeat(32), "nft1", { disposition: "ok" });
    let visionCalls = 0;
    const filter = new ContentFilter(media, {
      store,
      googleApiKey: "k",
      onFlag: () => {},
      safesearchSweepIntervalMs: 1000,
      fetchImpl: (async (url: string) => {
        if (String(url).includes("images:annotate")) {
          visionCalls++;
          return new Response(
            JSON.stringify({ responses: [{ safeSearchAnnotation: { adult: "UNLIKELY" } }] }),
            { status: 200 }
          );
        }
        return new Response("{}", { status: 404 });
      }) as typeof fetch,
    });
    await vi.advanceTimersByTimeAsync(1000); // first tick → sweep → Vision
    expect(visionCalls).toBe(1);
    filter.close();
    // a fresh, unchecked launcher that a further tick WOULD pick up if the
    // timer were still alive (the first launcher is now safesearchChecked, so
    // it alone can't distinguish a stopped timer from the checked-flag guard)
    media.set("ef".repeat(32), { url: "https://e/y.png", kind: "image" });
    store.putCheap("ef".repeat(32), "nft2", { disposition: "ok" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(visionCalls).toBe(1); // closed → no further sweeps
    store.close();
  } finally {
    vi.useRealTimers();
  }
});
```

- [ ] **Step 10: Run it to verify it fails**

Run: `npx vitest run server/test/content-filter.test.ts -t "sweep interval"`
Expected: FAIL — `safesearchSweepIntervalMs` is not a known option and no sweep fires (`visionCalls` stays 0), plus `filter.close` is not a function.

- [ ] **Step 11: Implement the wiring**

In `server/src/content-filter/index.ts`:

11a. Add to `ContentFilterOptions` (after `onFlag`):

```typescript
  /** How often to sweep MediaIndex for still-unchecked NFTs (0 disables; default 10 min).
   *  Retries content that lagged Archive ingestion without waiting for a re-spend. */
  safesearchSweepIntervalMs?: number;
```

11b. Add the field (next to `private readonly worker?: SafeSearchWorker;`):

```typescript
  private sweepTimer?: ReturnType<typeof setInterval>;
```

11c. In the constructor, right after the `this.worker = new SafeSearchWorker({...})` block (inside the same `if`):

```typescript
      const sweepMs = opts.safesearchSweepIntervalMs ?? 600_000;
      if (sweepMs > 0) {
        const worker = this.worker;
        this.sweepTimer = setInterval(() => worker.sweep(), sweepMs);
        this.sweepTimer.unref?.();
      }
```

11d. Add a public method after `enrich`:

```typescript
  /** Stop the periodic SafeSearch sweep (the unref'd timer never blocks exit,
   *  but tests and orderly shutdown want it gone deterministically). */
  close(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = undefined;
  }
```

11e. In `server/src/index.ts`, add to the `new ContentFilter(media, { ... })` options (line ~55):

```typescript
  safesearchSweepIntervalMs: envInt("SAFESEARCH_SWEEP_INTERVAL_MS", 600_000),
```

11f. In `server/CLAUDE.md`, add a row to the environment-variables table:

```markdown
| `SAFESEARCH_SWEEP_INTERVAL_MS` | `600000` | Re-check cadence for still-unchecked NFTs in MediaIndex; `0` disables |
```

- [ ] **Step 12: Run both test files, then the full suite**

Run: `npx vitest run server/test/content-filter.test.ts server/test/safesearch-worker.test.ts`
Expected: ALL PASS
Run: `npm test && npm run typecheck`
Expected: all tests pass, typecheck clean

- [ ] **Step 13: Commit**

```bash
git add server/src/util/bounded-map.ts server/src/web/media-index.ts server/src/content-filter/safesearch-worker.ts server/src/content-filter/index.ts server/src/index.ts server/CLAUDE.md server/test/bounded-map.test.ts server/test/media-index.test.ts server/test/safesearch-worker.test.ts server/test/content-filter.test.ts
git commit -m "Sweep MediaIndex periodically so unchecked NFTs get a verdict without a re-spend

SAFESEARCH_SWEEP_INTERVAL_MS (default 10 min, 0 disables); the sweep
reuses every existing guard and additionally skips non-ok dispositions.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Documentation coherence pass

Bring the three descriptions of the SafeSearch flow (worker header comment, `server/CLAUDE.md`, root `CLAUDE.md` data-flow) in line with the new behavior, and state the fail-open policy explicitly.

**Files:**
- Modify: `server/src/content-filter/safesearch-worker.ts:30-47` (class doc comment)
- Modify: `server/CLAUDE.md` (ContentFilter bullet, tier 2)
- Modify: `CLAUDE.md` (data-flow diagram line)

**Interfaces:** none — documentation only. No code or test changes; if a test fails after this task, the edit touched code by mistake.

- [ ] **Step 1: Replace the SafeSearchWorker class doc comment**

Replace the block comment directly above `const FAILED_UNTIL_CAP` (currently beginning "Out-of-band SafeSearch path…") with:

```typescript
/**
 * Out-of-band SafeSearch path. `maybeEnqueue` is fire-and-forget: any NFT spend
 * whose cheap verdict was `ok` and that hasn't yet been SafeSearch-checked gets a
 * single Vision lookup — images are classified by their art URL, videos by their
 * static poster (best-effort; Vision can't decode video frames, and a video with
 * no resolved thumbnail is skipped). `sweep()` re-attempts every still-eligible
 * launcher in MediaIndex on a timer, so a mint whose content lagged Archive
 * ingestion gets a verdict without waiting for a re-spend.
 *
 * URLs on MintGarden's ingestion-lagged CDNs (archive content, assets-CDN
 * posters) are readiness-probed first: a HEAD of the exact URL Vision will
 * fetch (2xx/3xx = ready). If the probe exhausts its attempts, image NFTs fall
 * back to one Vision attempt against the on-chain original URL — unless its
 * host is unreachable from Google's fetchers — and `checked_uri` records what
 * was actually classified. Everything is fail-open: an NFT we cannot check
 * renders permissive, failures back off in memory (`failedUntil` per launcher,
 * `dedupFailedUntil` per content) and are never persisted.
 *
 * Two limits, deliberately separate: the concurrency gate bounds only the paid,
 * rate-limited Vision call, while the cheap readiness probing runs unbounded by
 * the gate (it would otherwise occupy a Vision slot while merely sleeping,
 * collapsing throughput to concurrency / probeWait). `maxPending` caps total
 * in-flight launchers — and therefore concurrent probes — so a large mint drop
 * can't grow the queue (or open sockets) without bound.
 */
```

- [ ] **Step 2: Update `server/CLAUDE.md` ContentFilter tier-2 bullet**

Replace the tier-2 sentence block (currently beginning "_Google Vision SafeSearch_ async/out-of-band — for any image or video NFT spend…") with:

```markdown
  2. _Google Vision SafeSearch_ async/out-of-band — for any image or video NFT spend whose cheap verdict was `ok` and that hasn't yet been SafeSearch-checked (`safesearchChecked` store flag ensures each `launcherId` is checked at most once; `content_hash` and `checked_uri` lookups additionally reuse a prior verdict across distinct NFTs sharing identical bytes, so the paid Vision call runs once per unique content). Images are classified by their art URL; videos by their static poster (best-effort — Vision can't decode video frames, and a video with no resolved thumbnail is skipped). URLs on MintGarden's ingestion-lagged CDNs (archive content, assets-CDN posters) are readiness-probed first via HEAD; on exhaustion, images fall back to one Vision attempt against the on-chain original URL (skipping hosts Google can't reach). A periodic sweep (`SAFESEARCH_SWEEP_INTERVAL_MS`) re-attempts still-unchecked NFTs in MediaIndex so verdicts don't depend on re-spends. adult LIKELY/VERY_LIKELY → `sensitive`. SafeSearch never downloads image bytes; Google fetches the URI directly via `image.source.imageUri`. Verdicts persist per `launcherId` in `store.ts` (SQLite via Node's built-in `node:sqlite`); failures are fail-open (render permissive) with in-memory backoff only. A late verdict is pushed to clients as a `ContentFlagEvent` via Hub→RingBuffer.
```

- [ ] **Step 3: Update the root `CLAUDE.md` data-flow line**

Replace:

```
    ↓ async SafeSearch (image NFT spends, cheap verdict ok, not yet checked) → ContentFlagEvent
```

with:

```
    ↓ async SafeSearch (image/video-poster spends + periodic sweep; cheap verdict ok, not yet checked) → ContentFlagEvent
```

- [ ] **Step 4: Verify nothing but docs changed, and the suite still passes**

Run: `git diff --stat` — expected: only `safesearch-worker.ts` (comment lines), `server/CLAUDE.md`, `CLAUDE.md`.
Run: `npm test`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/content-filter/safesearch-worker.ts server/CLAUDE.md CLAUDE.md
git commit -m "Document the readiness probe, original-URL fallback, sweep, and fail-open policy

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Final verification (after Task 5)

- [ ] `npm test` — all workspaces green
- [ ] `npm run typecheck` — clean
- [ ] `npm run lint` — clean
- [ ] `npm run format` — no diff churn (run before the last commit if needed)
