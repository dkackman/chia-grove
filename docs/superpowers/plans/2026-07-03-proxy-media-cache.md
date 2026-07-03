# Image-proxy media cache + single-flight coalescing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-process byte-budgeted LRU cache plus single-flight coalescing to the `/img` and `/thumbnail` proxy endpoints so bounded media (thumbnails + small images) is fetched from upstream at most once and then served instantly to every later viewer and snapshot replay.

**Architecture:** A new pure `MediaCache` LRU store holds sanitized image bodies keyed by `img:`/`thumb:` + launcherId. The proxy checks the cache before fetching; on a miss it fetches once, tees the streamed bytes into the cache via a passive collector, and (for coalescing) registers an in-flight promise so concurrent requests for the same key share that one fetch. Large videos and ranged requests stream through the existing hardened path untouched.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Node 24, Fastify, `node:stream` `Transform`, vitest.

## Global Constraints

- Node ≥ 24; server runs via `tsx` (no build step).
- ESM: all relative imports use `.js` specifiers (e.g. `./media-cache.js`).
- Follow the existing bounded-LRU idiom: `Map`-based, `delete`+`set` to move a key to newest, oldest evicted from the front.
- New injected dependencies on `registerImageProxy` are added **last** in the parameter list and default to a fresh instance, so existing call sites (`registerImageProxy(app, media, failures, fetcher)` and `registerImageProxy(app, media)`) keep compiling unchanged.
- Cache only sanitized bytes: caching happens after `safeContentType`, SSRF validation, and the byte cap.
- `CACHE_BYTE_BUDGET = 64 * 1024 * 1024`; `CACHE_ENTRY_MAX_BYTES = 4 * 1024 * 1024` (equals the existing `THUMB_MAX_BYTES`).
- Every task ends green on `npm run typecheck`, `npm run lint`, and `npx vitest run <touched files>`; the full `npm test` stays green.

**Note on `server.ts`:** The design mentioned constructing the cache in `server.ts`, but because `registerImageProxy` is called once and both endpoints close over the same defaulted `cache` instance, a single shared budget is achieved without touching `server.ts`. No `server.ts` change is in this plan.

---

### Task 1: `MediaCache` — pure byte-budgeted LRU store

**Files:**
- Create: `server/src/web/media-cache.ts`
- Test: `server/test/media-cache.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export interface CachedResponse { body: Buffer; contentType: string }`
  - `export class MediaCache` with `constructor(budgetBytes: number)`, `get(key: string): CachedResponse | undefined`, `set(key: string, resp: CachedResponse): void`.

- [ ] **Step 1: Write the failing tests**

Create `server/test/media-cache.test.ts`:

```ts
import { expect, test } from "vitest";
import { MediaCache } from "../src/web/media-cache.js";

const resp = (n: number) => ({ body: Buffer.alloc(n), contentType: "image/png" });

test("get returns undefined for a key that was never set", () => {
  const cache = new MediaCache(100);
  expect(cache.get("nope")).toBeUndefined();
});

test("stores and returns an entry", () => {
  const cache = new MediaCache(100);
  cache.set("a", { body: Buffer.from("PNG"), contentType: "image/png" });
  const got = cache.get("a");
  expect(got?.body.toString()).toBe("PNG");
  expect(got?.contentType).toBe("image/png");
});

test("evicts oldest entries until total bytes are within budget", () => {
  const cache = new MediaCache(10);
  cache.set("a", resp(4));
  cache.set("b", resp(4)); // total 8
  cache.set("c", resp(4)); // total 12 > 10 → evict oldest ("a")
  expect(cache.get("a")).toBeUndefined();
  expect(cache.get("b")).toBeDefined();
  expect(cache.get("c")).toBeDefined();
});

test("get promotes a key so it survives a later eviction", () => {
  const cache = new MediaCache(10);
  cache.set("a", resp(4));
  cache.set("b", resp(4)); // total 8
  cache.get("a"); // promote "a" to newest → "b" is now oldest
  cache.set("c", resp(4)); // total 12 > 10 → evict oldest ("b")
  expect(cache.get("b")).toBeUndefined();
  expect(cache.get("a")).toBeDefined();
  expect(cache.get("c")).toBeDefined();
});

test("a body larger than the whole budget is not stored and evicts nothing", () => {
  const cache = new MediaCache(10);
  cache.set("small", resp(4));
  cache.set("huge", resp(20)); // exceeds budget → refused
  expect(cache.get("huge")).toBeUndefined();
  expect(cache.get("small")).toBeDefined(); // untouched
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run server/test/media-cache.test.ts`
Expected: FAIL — cannot resolve `../src/web/media-cache.js` (module does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `server/src/web/media-cache.ts`:

```ts
/**
 * Bounded byte-budgeted LRU of buffered small proxy responses. The image proxy
 * fills it with sanitized image bodies (already past SSRF validation,
 * safeContentType, and the byte cap) keyed by `img:`/`thumb:` + launcherId, so a
 * body fetched once is served to every later viewer and snapshot replay without
 * re-hitting upstream. Pure storage: no fetching, no TTL — launcherId → art bytes
 * is immutable, so a stale entry is never wrong, only eventually evicted. Total
 * stored bytes are held at or below `budgetBytes`; oldest entries evict first.
 */
export interface CachedResponse {
  body: Buffer;
  contentType: string; // already normalized by safeContentType
}

export class MediaCache {
  private readonly map = new Map<string, CachedResponse>();
  private bytes = 0;

  constructor(private readonly budgetBytes: number) {}

  get(key: string): CachedResponse | undefined {
    const resp = this.map.get(key);
    if (resp === undefined) return undefined;
    this.map.delete(key); // re-insert moves the key to newest (LRU recency)
    this.map.set(key, resp);
    return resp;
  }

  set(key: string, resp: CachedResponse): void {
    if (resp.body.length > this.budgetBytes) return; // can never fit — store nothing, evict nothing
    const existing = this.map.get(key);
    if (existing !== undefined) {
      this.bytes -= existing.body.length;
      this.map.delete(key);
    }
    this.map.set(key, resp);
    this.bytes += resp.body.length;
    while (this.bytes > this.budgetBytes) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.bytes -= this.map.get(oldest)!.body.length;
      this.map.delete(oldest);
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run server/test/media-cache.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck, lint, commit**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

```bash
git add server/src/web/media-cache.ts server/test/media-cache.test.ts
git commit -m "Add MediaCache: byte-budgeted LRU store for proxy media"
```

---

### Task 2: `/img` response cache (hit path + collector-tee fill)

Adds the cache dependency, constants, two module helpers (`cachingCollector`, `serveCached`), and wires `/img` to serve from cache on a hit and to tee a successful small-image body into the cache on a miss. **No coalescing yet** (Task 3).

**Files:**
- Modify: `server/src/web/img-proxy.ts`
- Test: `server/test/img-proxy.test.ts`

**Interfaces:**
- Consumes: `MediaCache`, `CachedResponse` from `./media-cache.js` (Task 1).
- Produces:
  - `registerImageProxy(app, media, failures?, fetchUpstream?, cache?)` — `cache` added last, defaulting to `new MediaCache(CACHE_BYTE_BUDGET)`.
  - Module-level `cachingCollector(cap: number): { stream: Transform; result(): Buffer | null }`.
  - Module-level `serveCached(reply, resp: CachedResponse): FastifyReply` (sets the same headers a fresh serve would and sends the buffer).
  - `/img` cache keys use the `img:<launcherId>` prefix.

- [ ] **Step 1: Write the failing tests**

Append to `server/test/img-proxy.test.ts` (the file already imports `fastify`, `PassThrough`, `IncomingMessage`, `registerImageProxy`, `MediaIndex`, `FailureCache`, and defines `fakeUpstream(status, contentType, body)`):

```ts
import { MediaCache } from "../src/web/media-cache.js";

test("caches a small image on first fetch and serves the second request from cache", async () => {
  const media = new MediaIndex(10);
  media.set("img1", { url: "https://cdn.test/a.png", kind: "image" });
  let calls = 0;
  const fetcher = async (): Promise<IncomingMessage | null> => {
    calls++;
    return fakeUpstream(200, "image/png", "PNGDATA");
  };
  const app = fastify();
  registerImageProxy(app, media, new FailureCache(60_000, 10), fetcher, new MediaCache(1_000_000));

  const first = await app.inject({ method: "GET", url: "/img?nft=img1" });
  expect(first.statusCode).toBe(200);
  expect(first.body).toBe("PNGDATA");

  const second = await app.inject({ method: "GET", url: "/img?nft=img1" });
  expect(second.statusCode).toBe(200);
  expect(second.body).toBe("PNGDATA");
  expect(second.headers["content-type"]).toBe("image/png");
  expect(calls).toBe(1); // second request served from cache, no upstream fetch
  await app.close();
});

test("does not cache a video body (streams it, refetches next time)", async () => {
  const media = new MediaIndex(10);
  media.set("vid1", { url: "https://cdn.test/clip.mp4", kind: "video" });
  let calls = 0;
  const fetcher = async (): Promise<IncomingMessage | null> => {
    calls++;
    return fakeUpstream(200, "video/mp4", "VIDEODATA");
  };
  const app = fastify();
  registerImageProxy(app, media, new FailureCache(60_000, 10), fetcher, new MediaCache(1_000_000));

  await app.inject({ method: "GET", url: "/img?nft=vid1" });
  await app.inject({ method: "GET", url: "/img?nft=vid1" });
  expect(calls).toBe(2); // videos are never cached
  await app.close();
});

test("a ranged request bypasses the cache", async () => {
  const media = new MediaIndex(10);
  media.set("img2", { url: "https://cdn.test/b.png", kind: "image" });
  let calls = 0;
  const fetcher = async (): Promise<IncomingMessage | null> => {
    calls++;
    return fakeUpstream(200, "image/png", "PNGDATA");
  };
  const app = fastify();
  registerImageProxy(app, media, new FailureCache(60_000, 10), fetcher, new MediaCache(1_000_000));

  await app.inject({ method: "GET", url: "/img?nft=img2" }); // primes the cache (fetch 1)
  await app.inject({ method: "GET", url: "/img?nft=img2", headers: { range: "bytes=0-3" } });
  expect(calls).toBe(2); // ranged request must not be served the full cached body
  await app.close();
});

test("a failed fetch leaves the cache empty", async () => {
  const media = new MediaIndex(10);
  media.set("fail2", { url: "https://nonexistent.invalid/x.png", kind: "image" });
  const cache = new MediaCache(1_000_000);
  const app = fastify();
  registerImageProxy(app, media, new FailureCache(60_000, 10), undefined, cache);
  const res = await app.inject({ method: "GET", url: "/img?nft=fail2" });
  expect(res.statusCode).toBe(504);
  expect(cache.get("img:fail2")).toBeUndefined();
  await app.close();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run server/test/img-proxy.test.ts`
Expected: FAIL — `registerImageProxy` currently takes no `cache` param and does not cache, so the first test's `calls` is `2` (and the `img:fail2` key check compiles only once `MediaCache` is imported, which it is). Also the passing of a 5th argument is ignored, so caching never happens.

- [ ] **Step 3: Add imports, constants, and helpers to `img-proxy.ts`**

At the top of `server/src/web/img-proxy.ts`, add to the existing import block, and widen the existing `import type { FastifyInstance } from "fastify";` to also bring in `FastifyReply`:

```ts
import type { FastifyInstance, FastifyReply } from "fastify";
import { MediaCache, type CachedResponse } from "./media-cache.js";
```

Add constants next to the existing `FAIL_*` / `MAX_*` constants (near line 42):

```ts
// In-memory response cache for bounded media (thumbnails + small images). Large
// videos and ranged requests are never cached — they stream through the hardened
// path unchanged. Total heap held at/below the budget; oldest evicts first.
const CACHE_BYTE_BUDGET = 64 * 1024 * 1024;
const CACHE_ENTRY_MAX_BYTES = 4 * 1024 * 1024; // == THUMB_MAX_BYTES
```

Add two module-level helpers just below the existing `byteCap` function (after line 182):

```ts
/**
 * A pass-through that forwards every chunk unchanged (so client delivery is
 * exactly the streamed path) while accumulating the body up to `cap` bytes for
 * caching. If the body exceeds `cap`, accumulation is abandoned (the buffer is
 * dropped) but forwarding continues. `result()` returns the full body only if the
 * stream ended cleanly within the cap, else null.
 */
function cachingCollector(cap: number): { stream: Transform; result(): Buffer | null } {
  const chunks: Buffer[] = [];
  let size = 0;
  let truncated = false;
  let ended = false;
  const stream = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      if (!truncated) {
        size += chunk.length;
        if (size > cap) {
          truncated = true;
          chunks.length = 0; // don't hold a partial body
        } else {
          chunks.push(chunk);
        }
      }
      cb(null, chunk);
    },
    flush(cb) {
      ended = true;
      cb();
    },
  });
  return { stream, result: () => (ended && !truncated ? Buffer.concat(chunks) : null) };
}

/** Serve a cached body with the same headers a fresh successful serve sets. */
function serveCached(reply: FastifyReply, resp: CachedResponse): FastifyReply {
  reply.code(200);
  reply.header("access-control-allow-origin", "*");
  reply.header("cache-control", "public, max-age=86400");
  reply.header("content-type", resp.contentType);
  reply.header("x-content-type-options", "nosniff");
  reply.header("content-security-policy", "sandbox; default-src 'none'");
  reply.header("content-length", String(resp.body.length));
  return reply.send(resp.body);
}
```

Note: `Transform` is already imported (`import { Transform } from "node:stream";`); `FastifyReply` is added to the `fastify` type import in Step 3's first block.

- [ ] **Step 4: Add the `cache` parameter (last) and default it**

Change the `registerImageProxy` signature (currently ends `fetchUpstream: UpstreamFetcher = fetchFollowingSafeRedirects`):

```ts
export function registerImageProxy(
  app: FastifyInstance,
  media: MediaIndex,
  failures: FailureCache = new FailureCache(
    FAIL_BASE_TTL_MS,
    FAIL_CAPACITY,
    Date.now,
    FAIL_MAX_TTL_MS
  ),
  fetchUpstream: UpstreamFetcher = fetchFollowingSafeRedirects,
  cache: MediaCache = new MediaCache(CACHE_BYTE_BUDGET)
): void {
```

- [ ] **Step 5: Add the cache-hit check to `/img`**

In the `/img` handler, immediately after the unknown-nft 404 (`if (!entry) return reply.code(404).send("unknown nft");`) and **before** the `failures.has(...)` check, insert:

```ts
    const key = `img:${launcherId!}`;
    const hasRange = typeof request.headers.range === "string";
    if (!hasRange) {
      const cached = cache.get(key);
      if (cached) return serveCached(reply, cached);
    }
```

- [ ] **Step 6: Tee a successful small-image body into the cache**

In the `/img` handler's success section, replace the existing content-type/stream block. The current code is:

```ts
    reply.header("content-type", safeContentType(upstream.headers["content-type"]));
    reply.header("x-content-type-options", "nosniff");
    reply.header("content-security-policy", "sandbox; default-src 'none'");
    for (const name of PASS_THROUGH) {
      const value = upstream.headers[name];
      if (typeof value === "string") reply.header(name, value);
    }

    // enforce the cap mid-stream too — content-length can lie or be absent.
    // tearing down either end propagates to the other and frees the inflight slot.
    const capped = byteCap(MAX_BODY_BYTES);
    capped.on("error", () => upstream.destroy());
    upstream.on("error", () => capped.destroy());
    capped.on("close", release);
    upstream.pipe(capped);
    return reply.send(capped);
```

Replace it with:

```ts
    const ct = safeContentType(upstream.headers["content-type"]);
    reply.header("content-type", ct);
    reply.header("x-content-type-options", "nosniff");
    reply.header("content-security-policy", "sandbox; default-src 'none'");
    for (const name of PASS_THROUGH) {
      const value = upstream.headers[name];
      if (typeof value === "string") reply.header(name, value);
    }

    // enforce the cap mid-stream too — content-length can lie or be absent.
    // tearing down either end propagates to the other and frees the inflight slot.
    const capped = byteCap(MAX_BODY_BYTES);
    upstream.on("error", () => capped.destroy());

    // Cache only a full 200 image with no range: tee the streamed bytes into a
    // collector that fills the cache on a clean end. Everything else (videos,
    // ranged/partial responses) streams through the hardened path unchanged.
    const cacheable = !hasRange && status === 200 && ct.startsWith("image/");
    if (cacheable) {
      const collector = cachingCollector(CACHE_ENTRY_MAX_BYTES);
      // Full teardown triangle across the 3-stage pipe (upstream → capped →
      // collector). Any stage's error must destroy the other two; plain .pipe()
      // does not propagate a destroyed source's teardown to its destination, and
      // destroy() with no error emits only "close" (not "error"), so each leg is
      // wired explicitly. `release` rides on the collector's "close", so the
      // collector MUST be torn down on every failure or the reply hangs and the
      // inflight slot leaks.
      capped.on("error", () => upstream.destroy());
      capped.on("error", () => collector.stream.destroy());
      upstream.on("error", () => collector.stream.destroy());
      collector.stream.on("error", () => capped.destroy());
      // `close` fires on both clean completion and client abort; result() is
      // non-null only after a clean end within the cap, so this both fills the
      // cache and frees the slot in one place.
      collector.stream.on("close", () => {
        release();
        const body = collector.result();
        if (body) cache.set(key, { body, contentType: ct });
      });
      upstream.pipe(capped).pipe(collector.stream);
      return reply.send(collector.stream);
    }

    capped.on("error", () => upstream.destroy());
    capped.on("close", release);
    upstream.pipe(capped);
    return reply.send(capped);
```

(`status` is the existing `const status = upstream.statusCode ?? 502;` a few lines above; `key`, `hasRange`, `release`, and `ct` are all in scope.)

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run server/test/img-proxy.test.ts`
Expected: PASS — including the four new tests and all pre-existing ones (the `fetchUpstream`-in-position-4 call sites still compile because `cache` is the 5th param).

- [ ] **Step 8: Typecheck, lint, full test, commit**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green.

```bash
git add server/src/web/img-proxy.ts server/test/img-proxy.test.ts
git commit -m "Cache small /img image responses in an in-memory LRU"
```

---

### Task 3: `/img` single-flight coalescing

Collapses concurrent cold requests for the same launcherId to a single upstream fetch: the first request registers an in-flight promise before fetching; later requests await it and serve from the resulting cache entry (or fall through if the leader's body turned out uncacheable).

**Files:**
- Modify: `server/src/web/img-proxy.ts`
- Test: `server/test/img-proxy.test.ts`

**Interfaces:**
- Consumes: everything from Task 2.
- Produces: an `inFlight = new Map<string, Promise<CachedResponse | null>>()` in the `registerImageProxy` closure and a module-level `deferred<T>()` helper. No signature change.

- [ ] **Step 1: Write the failing test**

Append to `server/test/img-proxy.test.ts`:

```ts
test("coalesces concurrent requests for the same nft into one upstream fetch", async () => {
  const media = new MediaIndex(10);
  media.set("img3", { url: "https://cdn.test/c.png", kind: "image" });
  let calls = 0;
  // A deferred fetcher: the fetch stays pending until we release it, so the
  // second request provably arrives while the first is still fetching.
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const fetcher = async (): Promise<IncomingMessage | null> => {
    calls++;
    await gate;
    return fakeUpstream(200, "image/png", "PNGDATA");
  };
  const app = fastify();
  registerImageProxy(app, media, new FailureCache(60_000, 10), fetcher, new MediaCache(1_000_000));

  const p1 = app.inject({ method: "GET", url: "/img?nft=img3" });
  const p2 = app.inject({ method: "GET", url: "/img?nft=img3" });
  await new Promise((r) => setTimeout(r, 20)); // let both handlers reach the fetch/await
  release();
  const [r1, r2] = await Promise.all([p1, p2]);

  expect(r1.body).toBe("PNGDATA");
  expect(r2.body).toBe("PNGDATA");
  expect(calls).toBe(1); // one leader fetch shared by both requests
  await app.close();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run server/test/img-proxy.test.ts -t coalesces`
Expected: FAIL — `calls` is `2` (both requests fetch independently; no coalescing yet).

- [ ] **Step 3: Add the `deferred` helper**

Add a module-level helper near `cachingCollector` in `server/src/web/img-proxy.ts`:

```ts
/** A promise with its resolver exposed, for the single-flight in-flight map. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
```

- [ ] **Step 4: Add the in-flight map to the closure**

In `registerImageProxy`, next to `let inflight = 0;`, add:

```ts
  // Single-flight: concurrent cold requests for the same key await one leader's
  // fetch instead of each opening their own. Resolves with the cached body, or
  // null when the leader's body turned out uncacheable (waiters then fall
  // through to their own fetch — same as today for videos).
  const inFlight = new Map<string, Promise<CachedResponse | null>>();
```

- [ ] **Step 5: Await an in-flight leader on a cache miss**

Extend the cache-hit block added in Task 2 so it also coalesces. Replace:

```ts
    const key = `img:${launcherId!}`;
    const hasRange = typeof request.headers.range === "string";
    if (!hasRange) {
      const cached = cache.get(key);
      if (cached) return serveCached(reply, cached);
    }
```

with:

```ts
    const key = `img:${launcherId!}`;
    const hasRange = typeof request.headers.range === "string";
    if (!hasRange) {
      const cached = cache.get(key);
      if (cached) return serveCached(reply, cached);
      const pending = inFlight.get(key);
      if (pending) {
        const shared = await pending;
        if (shared) return serveCached(reply, shared);
        // leader's body was uncacheable → fall through to an independent fetch
      }
    }
```

- [ ] **Step 6: Register as leader before fetching, and settle on every exit**

Immediately before the candidate `inflight++;` / fetch section (after the `candidates.length === 0` → 400 check), add the leader registration:

```ts
    // Become the single-flight leader for this key so concurrent cold requests
    // coalesce onto this fetch. Only non-ranged requests participate.
    const lead = !hasRange ? deferred<CachedResponse | null>() : null;
    if (lead) inFlight.set(key, lead.promise);
    let settled = false;
    const settle = (value: CachedResponse | null): void => {
      if (lead && !settled) {
        settled = true;
        inFlight.delete(key);
        lead.resolve(value);
      }
    };
```

Then settle on each post-registration exit. Change the fetch-failure block:

```ts
    if (!upstream) {
      release();
      failures.mark(launcherId!);
      settle(null);
      return sawError
        ? reply.code(504).send("upstream fetch failed")
        : reply.code(502).send("upstream unavailable");
    }
```

and the oversized block:

```ts
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      upstream.destroy();
      release();
      failures.mark(launcherId!);
      settle(null);
      return reply.code(502).send("upstream too large");
    }
```

- [ ] **Step 7: Resolve the leader from the stream outcome**

Update the cacheable/non-cacheable stream branches from Task 2 to settle the leader. Replace the `cacheable` block's `end` handler and the non-cacheable tail:

```ts
    const cacheable = !hasRange && status === 200 && ct.startsWith("image/");
    if (cacheable) {
      const collector = cachingCollector(CACHE_ENTRY_MAX_BYTES);
      capped.on("error", () => upstream.destroy()); // capped's byte-cap error must tear down upstream too
      capped.on("error", () => collector.stream.destroy());
      upstream.on("error", () => collector.stream.destroy()); // upstream error must tear down the collector (release rides on its close)
      collector.stream.on("error", () => capped.destroy());
      // Single finalization point: `close` fires on clean completion and on
      // client abort. result() is non-null only after a clean end within the
      // cap, so this fills the cache, frees the slot, and settles waiters at
      // once (on abort, body is null → not cached and waiters fall through).
      collector.stream.on("close", () => {
        release();
        const body = collector.result();
        if (body) cache.set(key, { body, contentType: ct });
        settle(body ? { body, contentType: ct } : null);
      });
      upstream.pipe(capped).pipe(collector.stream);
      return reply.send(collector.stream);
    }

    settle(null); // this body won't be cached (video/partial); waiters fall through
    capped.on("error", () => upstream.destroy());
    capped.on("close", release);
    upstream.pipe(capped);
    return reply.send(capped);
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run server/test/img-proxy.test.ts`
Expected: PASS — the new coalescing test shows `calls === 1`, and all Task 2 + pre-existing tests stay green.

- [ ] **Step 9: Typecheck, lint, full test, commit**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green.

```bash
git add server/src/web/img-proxy.ts server/test/img-proxy.test.ts
git commit -m "Coalesce concurrent /img fetches with single-flight"
```

---

### Task 4: `/thumbnail` cache + coalescing

Applies the same cache + single-flight to `/thumbnail`, reusing the Task 2/3 helpers and the shared `cache` and `inFlight`. `/thumbnail` never takes a client `Range` and only serves images ≤ 4 MB, so it is simpler than `/img`.

**Files:**
- Modify: `server/src/web/img-proxy.ts`
- Test: `server/test/img-proxy.test.ts`

**Interfaces:**
- Consumes: `cachingCollector`, `serveCached`, `deferred`, `cache`, `inFlight`, `CACHE_ENTRY_MAX_BYTES` from Tasks 2–3.
- Produces: `/thumbnail` uses the `thumb:<launcherId>` cache key.

- [ ] **Step 1: Write the failing tests**

Append to `server/test/img-proxy.test.ts`:

```ts
test("caches a thumbnail on first fetch and serves the second from cache", async () => {
  const media = new MediaIndex(10);
  media.set("thumb1", {
    url: "https://cdn.test/a.png",
    kind: "video",
    thumbnailUrl: "https://cdn.test/a_512.webp",
  });
  let calls = 0;
  const fetcher = async (): Promise<IncomingMessage | null> => {
    calls++;
    return fakeUpstream(200, "image/webp", "WEBPDATA");
  };
  const app = fastify();
  registerImageProxy(app, media, new FailureCache(60_000, 10), fetcher, new MediaCache(1_000_000));

  const first = await app.inject({ method: "GET", url: "/thumbnail?nft=thumb1" });
  expect(first.statusCode).toBe(200);
  expect(first.body).toBe("WEBPDATA");
  const second = await app.inject({ method: "GET", url: "/thumbnail?nft=thumb1" });
  expect(second.body).toBe("WEBPDATA");
  expect(second.headers["content-type"]).toBe("image/webp");
  expect(calls).toBe(1);
  await app.close();
});

test("coalesces concurrent thumbnail requests into one fetch", async () => {
  const media = new MediaIndex(10);
  media.set("thumb2", {
    url: "https://cdn.test/b.png",
    kind: "video",
    thumbnailUrl: "https://cdn.test/b_512.webp",
  });
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const fetcher = async (): Promise<IncomingMessage | null> => {
    calls++;
    await gate;
    return fakeUpstream(200, "image/webp", "WEBPDATA");
  };
  const app = fastify();
  registerImageProxy(app, media, new FailureCache(60_000, 10), fetcher, new MediaCache(1_000_000));

  const p1 = app.inject({ method: "GET", url: "/thumbnail?nft=thumb2" });
  const p2 = app.inject({ method: "GET", url: "/thumbnail?nft=thumb2" });
  await new Promise((r) => setTimeout(r, 20));
  release();
  const [r1, r2] = await Promise.all([p1, p2]);
  expect(r1.body).toBe("WEBPDATA");
  expect(r2.body).toBe("WEBPDATA");
  expect(calls).toBe(1);
  await app.close();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run server/test/img-proxy.test.ts -t thumbnail`
Expected: FAIL — `/thumbnail` does not cache yet, so `calls` is `2` in both tests.

- [ ] **Step 3: Add the cache-hit + coalesce check to `/thumbnail`**

In the `/thumbnail` handler, after `if (!entry?.thumbnailUrl) return reply.code(404).send("no thumbnail");` and the `validateProxyTarget` 400 check, before `if (inflight >= MAX_INFLIGHT)`, insert:

```ts
    const key = `thumb:${launcherId!}`;
    const cachedThumb = cache.get(key);
    if (cachedThumb) return serveCached(reply, cachedThumb);
    const pendingThumb = inFlight.get(key);
    if (pendingThumb) {
      const shared = await pendingThumb;
      if (shared) return serveCached(reply, shared);
      // leader uncacheable → fall through
    }
```

- [ ] **Step 4: Register the leader and tee the body into the cache**

Register as leader just before `inflight++;` in `/thumbnail`:

```ts
    const lead = deferred<CachedResponse | null>();
    inFlight.set(key, lead.promise);
    let settled = false;
    const settle = (value: CachedResponse | null): void => {
      if (!settled) {
        settled = true;
        inFlight.delete(key);
        lead.resolve(value);
      }
    };
```

Update the `/thumbnail` failure exits to settle. The catch block:

```ts
    } catch {
      release();
      settle(null);
      return reply.code(504).send("upstream fetch failed");
    }
```

the unavailable block:

```ts
    if (!upstream || (upstream.statusCode ?? 0) >= 400) {
      upstream?.resume();
      release();
      settle(null);
      return reply.code(502).send("upstream unavailable");
    }
```

and the too-large block:

```ts
    if (Number.isFinite(declared) && declared > THUMB_MAX_BYTES) {
      upstream.destroy();
      release();
      settle(null);
      return reply.code(502).send("upstream too large");
    }
```

Then replace the `/thumbnail` stream tail. The current code is:

```ts
    const capped = byteCap(THUMB_MAX_BYTES);
    capped.on("error", () => upstream!.destroy());
    upstream.on("error", () => capped.destroy());
    capped.on("close", release);
    upstream.pipe(capped);
    return reply.send(capped);
```

Replace it with:

```ts
    const ct = safeContentType(upstream.headers["content-type"]);
    const capped = byteCap(THUMB_MAX_BYTES);
    upstream.on("error", () => capped.destroy());

    const cacheable = status === 200 && ct.startsWith("image/");
    if (cacheable) {
      const collector = cachingCollector(CACHE_ENTRY_MAX_BYTES);
      capped.on("error", () => upstream!.destroy()); // capped's byte-cap error must tear down upstream too
      capped.on("error", () => collector.stream.destroy());
      upstream.on("error", () => collector.stream.destroy()); // upstream error must tear down the collector (release rides on its close)
      collector.stream.on("error", () => capped.destroy());
      collector.stream.on("close", () => {
        release();
        const body = collector.result();
        if (body) cache.set(key, { body, contentType: ct });
        settle(body ? { body, contentType: ct } : null);
      });
      upstream.pipe(capped).pipe(collector.stream);
      return reply.send(collector.stream);
    }

    settle(null);
    capped.on("error", () => upstream.destroy());
    capped.on("close", release);
    upstream.pipe(capped);
    return reply.send(capped);
```

Confirm `status` exists in `/thumbnail` (`const status = upstream.statusCode ?? 502;`); the content-type header is already set from `safeContentType` a couple lines below the original tail — since we now compute `ct` up front, also update the existing `reply.header("content-type", safeContentType(upstream.headers["content-type"]));` line in `/thumbnail` to `reply.header("content-type", ct);` to avoid computing it twice.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run server/test/img-proxy.test.ts`
Expected: PASS — both new `/thumbnail` tests plus all earlier tests.

- [ ] **Step 6: Typecheck, lint, full test, commit**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green.

```bash
git add server/src/web/img-proxy.ts server/test/img-proxy.test.ts
git commit -m "Cache and coalesce /thumbnail responses"
```

---

## Self-review notes

- **Spec coverage:** MediaCache store → Task 1. Cache-hit fast path + `img:`/`thumb:` keys → Tasks 2/4. Cacheability rules (no Range, 200, image, ≤ cap) → Task 2 Step 6 (`cacheable` gate) + `cachingCollector` cap. Collector-tee leader → Tasks 2/4. Single-flight coalescing → Tasks 3/4. Serving headers parity + `content-length` → `serveCached` (Task 2). No-TTL/no-invalidation → inherent (no code). `server.ts` unchanged → documented in Global Constraints. Tests enumerated in the spec → Tasks 1–4 test steps (the spec's "non-200 not cached" is realized as Task 2's "a failed fetch leaves the cache empty", since a 404-without-fallback becomes a 502/504 and never reaches the cache branch).
- **Placeholder scan:** none — every step has concrete code and commands.
- **Type consistency:** `CachedResponse { body: Buffer; contentType: string }` is used identically across `MediaCache`, `serveCached`, the `inFlight` map, and both endpoints. `cache` is the 5th param everywhere. `cachingCollector` returns `{ stream, result() }` and is consumed the same way in Tasks 2–4.
