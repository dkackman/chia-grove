# Archive CDN URL for SafeSearch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw IPFS URL passed to Google Vision SafeSearch with a stable Cloudflare-backed Archive CDN URL by extracting `data.data_hash` from the existing `api.mintgarden.io` response and upgrading the `MediaIndex` entry in-place.

**Architecture:** `ContentFilter.fetchVerdict()` already calls `api.mintgarden.io/nfts/{id}` — the response includes `data.data_hash` (SHA-256 of the image). We extract that hash alongside the verdict and, in `apply()`, overwrite the `MediaIndex` entry's URL with `https://archive.mintgarden.io/content/{hash}`. `SafeSearchWorker` reads from `MediaIndex` unchanged and gets the CDN URL automatically. Zero new API calls.

**Tech Stack:** TypeScript, Vitest, Node ≥ 24, existing `server/src/content-filter/` module.

## Global Constraints

- No changes outside `server/src/content-filter/` and `server/test/content-filter.test.ts`
- No new environment variables
- No changes to `SafeSearchWorker`, `MediaIndex`, `signals/safesearch.ts`
- All new behavior is covered by tests before implementation
- `npm test` must pass after every commit
- `npm run typecheck` must pass after every commit

---

### Task 1: `extractContentHash` — parse data_hash from api.mintgarden.io response

**Files:**

- Modify: `server/src/content-filter/signals/mintgarden.ts`
- Modify: `server/src/content-filter/index.ts` (export only)
- Modify: `server/test/content-filter.test.ts`

**Interfaces:**

- Produces: `extractContentHash(json: unknown): string | undefined` — exported from `server/src/content-filter/index.ts`

- [ ] **Step 1: Add `extractContentHash` tests to content-filter.test.ts**

Add after the last existing test in `server/test/content-filter.test.ts`. First add `extractContentHash` to the existing import on line 2:

```ts
import {
  mapMintgarden,
  mapMintgardenSignals,
  extractContentHash,
} from "../src/content-filter/index.js";
```

Then add these tests at the bottom of the file:

```ts
// ── extractContentHash ──────────────────────────────────────────────────────

test("extractContentHash returns lowercase hash for valid 64-char hex", () => {
  expect(extractContentHash({ data: { data_hash: "ab".repeat(32) } })).toBe("ab".repeat(32));
});

test("extractContentHash normalizes uppercase hex to lowercase", () => {
  expect(extractContentHash({ data: { data_hash: "AB".repeat(32) } })).toBe("ab".repeat(32));
});

test("extractContentHash returns undefined for 63-char string", () => {
  expect(extractContentHash({ data: { data_hash: "a".repeat(63) } })).toBeUndefined();
});

test("extractContentHash returns undefined for non-hex characters", () => {
  expect(extractContentHash({ data: { data_hash: "z".repeat(64) } })).toBeUndefined();
});

test("extractContentHash returns undefined when data_hash is null", () => {
  expect(extractContentHash({ data: { data_hash: null } })).toBeUndefined();
});

test("extractContentHash returns undefined when data key is absent", () => {
  expect(extractContentHash({ name: "no data key here" })).toBeUndefined();
});

test("extractContentHash returns undefined for null input", () => {
  expect(extractContentHash(null)).toBeUndefined();
});
```

- [ ] **Step 2: Run the new tests and verify they fail**

```bash
cd /Users/don/src/dkackman/chia-grove
npx vitest run server/test/content-filter.test.ts 2>&1 | tail -20
```

Expected: tests fail with `extractContentHash is not a function` (not yet exported).

- [ ] **Step 3: Implement `extractContentHash` in signals/mintgarden.ts**

Add this function at the bottom of `server/src/content-filter/signals/mintgarden.ts`, after `mapMintgarden`:

```ts
/**
 * Extract the SHA-256 content hash from an api.mintgarden.io /nfts/{id} response.
 * Returns undefined for any missing, null, or malformed value so callers can
 * skip gracefully without guarding.
 */
export function extractContentHash(json: unknown): string | undefined {
  const hash = asRecord(asRecord(json).data).data_hash;
  return typeof hash === "string" && /^[0-9a-f]{64}$/i.test(hash) ? hash.toLowerCase() : undefined;
}
```

- [ ] **Step 4: Export `extractContentHash` from index.ts**

In `server/src/content-filter/index.ts`, find the line:

```ts
export { mapMintgarden, mapMintgardenSignals } from "./signals/mintgarden.js";
```

Replace it with:

```ts
export { mapMintgarden, mapMintgardenSignals, extractContentHash } from "./signals/mintgarden.js";
```

- [ ] **Step 5: Run the new tests and verify they pass**

```bash
npx vitest run server/test/content-filter.test.ts 2>&1 | tail -20
```

Expected: all tests pass including the 7 new `extractContentHash` tests.

- [ ] **Step 6: Run full test suite and typecheck**

```bash
npm test && npm run typecheck
```

Expected: all tests pass, no type errors.

- [ ] **Step 7: Commit**

```bash
git add server/src/content-filter/signals/mintgarden.ts \
        server/src/content-filter/index.ts \
        server/test/content-filter.test.ts
git commit -m "feat: add extractContentHash to parse data_hash from MintGarden API response"
```

---

### Task 2: Thread hash through ContentFilter and upgrade MediaIndex URL

**Files:**

- Modify: `server/src/content-filter/index.ts:54-239` (FetchResult type, fetchVerdict, resolve, inflight map, apply, archiveBaseUrl option)
- Modify: `server/test/content-filter.test.ts`

**Interfaces:**

- Consumes: `extractContentHash(json: unknown): string | undefined` from Task 1 (already imported via `signals/mintgarden.js` in `index.ts`)
- Produces: `ContentFilterOptions.archiveBaseUrl?: string` (default `"https://archive.mintgarden.io"`)

- [ ] **Step 1: Add failing tests for MediaIndex upgrade and SafeSearch URL**

Add these tests at the bottom of `server/test/content-filter.test.ts` (after the Task 1 tests):

```ts
// ── Archive CDN URL upgrade ─────────────────────────────────────────────────

const CONTENT_HASH = "ab".repeat(32); // valid 64-char hex

test("enrich upgrades MediaIndex to Archive CDN URL when data_hash is present", async () => {
  const media = new MediaIndex(10);
  media.set("cd".repeat(32), { url: "https://ipfs.mintgarden.io/ipfs/abc", kind: "image" });
  const filter = new ContentFilter(media, {
    fetchImpl: async () => okJson({ is_blocked: false, data: { data_hash: CONTENT_HASH } }),
  });
  await filter.enrich([nftEvent()]);
  expect(media.get("cd".repeat(32))?.url).toBe(
    `https://archive.mintgarden.io/content/${CONTENT_HASH}`
  );
  expect(media.get("cd".repeat(32))?.kind).toBe("image");
});

test("enrich does not change MediaIndex URL when data_hash is absent", async () => {
  const media = new MediaIndex(10);
  const originalUrl = "https://ipfs.mintgarden.io/ipfs/abc";
  media.set("cd".repeat(32), { url: originalUrl, kind: "image" });
  const filter = new ContentFilter(media, {
    fetchImpl: async () => okJson({ is_blocked: false }),
  });
  await filter.enrich([nftEvent()]);
  expect(media.get("cd".repeat(32))?.url).toBe(originalUrl);
});

test("enrich deletes blocked NFT from MediaIndex even when data_hash is present", async () => {
  const media = new MediaIndex(10);
  media.set("cd".repeat(32), { url: "https://ipfs.mintgarden.io/ipfs/abc", kind: "image" });
  const filter = new ContentFilter(media, {
    fetchImpl: async () => okJson({ is_blocked: true, data: { data_hash: CONTENT_HASH } }),
  });
  await filter.enrich([nftEvent()]);
  expect(media.get("cd".repeat(32))).toBeUndefined();
});

test("enrich respects archiveBaseUrl option when upgrading MediaIndex", async () => {
  const media = new MediaIndex(10);
  media.set("cd".repeat(32), { url: "https://ipfs/a.png", kind: "image" });
  const filter = new ContentFilter(media, {
    fetchImpl: async () => okJson({ data: { data_hash: CONTENT_HASH } }),
    archiveBaseUrl: "https://test-archive.example",
  });
  await filter.enrich([nftEvent()]);
  expect(media.get("cd".repeat(32))?.url).toBe(
    `https://test-archive.example/content/${CONTENT_HASH}`
  );
});

test("SafeSearch receives Archive CDN URL when data_hash is present", async () => {
  const media = new MediaIndex(10);
  media.set("cd".repeat(32), { url: "https://ipfs.mintgarden.io/ipfs/abc", kind: "image" });
  const store = new ContentStore(":memory:");
  let capturedVisionUri: string | undefined;
  const filter = new ContentFilter(media, {
    store,
    googleApiKey: "k",
    onFlag: () => {},
    archiveBaseUrl: "https://archive.mintgarden.io",
    fetchImpl: (async (url: string, init?: RequestInit) => {
      if (String(url).includes("images:annotate")) {
        const body = JSON.parse((init?.body as string) ?? "{}");
        capturedVisionUri = body.requests?.[0]?.image?.source?.imageUri;
        return new Response(
          JSON.stringify({ responses: [{ safeSearchAnnotation: { adult: "UNLIKELY" } }] }),
          { status: 200 }
        );
      }
      // api.mintgarden.io response with data_hash
      return new Response(JSON.stringify({ data: { data_hash: CONTENT_HASH } }), { status: 200 });
    }) as typeof fetch,
  });
  await filter.enrich([nftEvent({ mint: true })]);
  await tick();
  expect(capturedVisionUri).toBe(`https://archive.mintgarden.io/content/${CONTENT_HASH}`);
  store.close();
});
```

- [ ] **Step 2: Run the new tests and verify they fail**

```bash
npx vitest run server/test/content-filter.test.ts 2>&1 | grep -E "FAIL|✗|Error" | head -20
```

Expected: 5 new tests fail — `archiveBaseUrl` is not a known option and the MediaIndex upgrade logic doesn't exist yet.

- [ ] **Step 3: Add FetchResult type and archiveBaseUrl to ContentFilter**

In `server/src/content-filter/index.ts`:

**a)** Add `extractContentHash` to the import from `signals/mintgarden.js`. Find the line:

```ts
import { mapMintgardenSignals } from "./signals/mintgarden.js";
```

Replace with:

```ts
import { mapMintgardenSignals, extractContentHash } from "./signals/mintgarden.js";
```

**b)** Add `FetchResult` as a private internal type. Add this line after the `const OK` declaration (around line 13):

```ts
interface FetchResult {
  verdict: Verdict;
  contentHash?: string;
}
```

**c)** Add `archiveBaseUrl` to `ContentFilterOptions`. Add this field after `now?`:

```ts
/** Base URL for the MintGarden Archive CDN; used to construct stable image URLs for SafeSearch. */
archiveBaseUrl?: string;
```

**d)** Add `archiveBaseUrl` field declaration in the `ContentFilter` class. Add after `private readonly now`:

```ts
private readonly archiveBaseUrl: string;
```

**e)** Initialize it in the constructor. Add after `this.now = opts.now ?? Date.now;`:

```ts
this.archiveBaseUrl = opts.archiveBaseUrl ?? "https://archive.mintgarden.io";
```

- [ ] **Step 4: Update inflight map type and resolve() return type**

In `server/src/content-filter/index.ts`, find:

```ts
private readonly inflight = new Map<string, Promise<Verdict>>();
```

Replace with:

```ts
private readonly inflight = new Map<string, Promise<FetchResult>>();
```

Find the `resolve` method signature:

```ts
private resolve(nftId: string): Promise<Verdict> {
```

Replace with:

```ts
private resolve(nftId: string): Promise<FetchResult> {
```

Inside `resolve`, find:

```ts
const cached = this.cache.get(nftId);
if (cached !== undefined) return Promise.resolve(cached);
```

Replace with:

```ts
const cached = this.cache.get(nftId);
if (cached !== undefined) return Promise.resolve({ verdict: cached });
```

Find:

```ts
if (until !== undefined) {
  // a recent failure keeps us permissive without hammering a struggling
  // MintGarden every block; once the TTL lapses we let the next lookup retry
  if (this.now() < until) return Promise.resolve(OK);
  this.negativeUntil.delete(nftId);
}
```

Replace with:

```ts
if (until !== undefined) {
  // a recent failure keeps us permissive without hammering a struggling
  // MintGarden every block; once the TTL lapses we let the next lookup retry
  if (this.now() < until) return Promise.resolve({ verdict: OK });
  this.negativeUntil.delete(nftId);
}
```

Find:

```ts
const promise = this.gate(() => this.fetchVerdict(nftId))
  .then((verdict) => {
    this.remember(nftId, verdict);
    return verdict;
  })
  .catch(() => {
    // transient failure/timeout: permissive now, negatively cached briefly so
    // the same doomed lookup doesn't re-stall the next block
    this.rememberFailure(nftId);
    return OK;
  });
```

Replace with:

```ts
const promise = this.gate(() => this.fetchVerdict(nftId))
  .then((result) => {
    this.remember(nftId, result.verdict);
    return result;
  })
  .catch(() => {
    // transient failure/timeout: permissive now, negatively cached briefly so
    // the same doomed lookup doesn't re-stall the next block
    this.rememberFailure(nftId);
    return { verdict: OK };
  });
```

- [ ] **Step 5: Update fetchVerdict() return type and body**

Find:

```ts
private async fetchVerdict(nftId: string): Promise<Verdict> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), this.timeoutMs);
  try {
    const res = await this.fetchImpl(`${this.baseUrl}/nfts/${nftId}`, {
      signal: controller.signal,
    });
    if (res.status === 404) return { disposition: "ok", signals: [] }; // genuinely unknown to MintGarden → cacheable permissive
    if (!res.ok) throw new Error(`mintgarden ${res.status}`); // 5xx/429/etc → transient, don't poison the cache
    return mapMintgardenSignals(await res.json());
  } finally {
    clearTimeout(timer);
  }
}
```

Replace with:

```ts
private async fetchVerdict(nftId: string): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), this.timeoutMs);
  try {
    const res = await this.fetchImpl(`${this.baseUrl}/nfts/${nftId}`, {
      signal: controller.signal,
    });
    if (res.status === 404) return { verdict: { disposition: "ok", signals: [] } }; // genuinely unknown to MintGarden → cacheable permissive
    if (!res.ok) throw new Error(`mintgarden ${res.status}`); // 5xx/429/etc → transient, don't poison the cache
    const json = await res.json();
    return { verdict: mapMintgardenSignals(json), contentHash: extractContentHash(json) };
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 6: Update apply() to use FetchResult and upgrade MediaIndex**

Find the section inside `apply()` that reads:

```ts
const verdict: Verdict = stored
  ? { disposition: stored.disposition, signals: stored.signals }
  : await this.resolve(event.nftId!);

if (!stored && launcherId) {
  try {
    this.store?.putCheap(launcherId, event.nftId, verdict);
  } catch (err) {
    console.warn("content-filter store.putCheap failed (verdict not persisted):", err);
  }
}

if (verdict.disposition === "ok") this.worker?.maybeEnqueue(event);

if (verdict.disposition === "blocked") {
  event.mediaFilter = "blocked";
  if (launcherId) this.media.delete(launcherId);
} else if (verdict.disposition === "sensitive") {
  event.mediaFilter = "sensitive";
}
if (verdict.signals.length > 0) event.signals = [...verdict.signals];
```

Replace with:

```ts
let verdict: Verdict;
let contentHash: string | undefined;
if (stored) {
  verdict = { disposition: stored.disposition, signals: stored.signals };
} else {
  const result = await this.resolve(event.nftId!);
  verdict = result.verdict;
  contentHash = result.contentHash;
}

if (!stored && launcherId) {
  try {
    this.store?.putCheap(launcherId, event.nftId, verdict);
  } catch (err) {
    console.warn("content-filter store.putCheap failed (verdict not persisted):", err);
  }
}

// Upgrade MediaIndex from IPFS to Archive CDN URL so SafeSearch passes a
// reliably reachable URL to Google Vision (MintGarden's IPFS gateway is
// inaccessible from Google's IP ranges).
if (contentHash && launcherId && verdict.disposition !== "blocked") {
  const existing = this.media.get(launcherId);
  if (existing) {
    this.media.set(launcherId, {
      url: `${this.archiveBaseUrl}/content/${contentHash}`,
      kind: existing.kind,
    });
  }
}

if (verdict.disposition === "ok") this.worker?.maybeEnqueue(event);

if (verdict.disposition === "blocked") {
  event.mediaFilter = "blocked";
  if (launcherId) this.media.delete(launcherId);
} else if (verdict.disposition === "sensitive") {
  event.mediaFilter = "sensitive";
}
if (verdict.signals.length > 0) event.signals = [...verdict.signals];
```

- [ ] **Step 7: Run the new tests and verify they pass**

```bash
npx vitest run server/test/content-filter.test.ts 2>&1 | tail -30
```

Expected: all tests pass including the 5 new Archive CDN tests.

- [ ] **Step 8: Run full test suite and typecheck**

```bash
npm test && npm run typecheck
```

Expected: all tests pass, no type errors. If `npm run typecheck` fails with a type error on `resolve()` or `inflight`, double-check that the `FetchResult` interface is declared at module scope (not inside a method) and that all return sites in `resolve()` return `{ verdict: ... }` not a bare `Verdict`.

- [ ] **Step 9: Commit**

```bash
git add server/src/content-filter/index.ts \
        server/test/content-filter.test.ts
git commit -m "feat: upgrade MediaIndex to Archive CDN URL for reliable SafeSearch classification"
```
