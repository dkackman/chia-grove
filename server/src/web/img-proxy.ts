import type { IncomingMessage } from "node:http";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { MediaIndex } from "./media-index.js";
import { FailureCache } from "./failure-cache.js";
import { RateLimiter } from "./rate-limiter.js";
import { MediaCache, type CachedResponse } from "./media-cache.js";
import {
  drainAndDiscard,
  fetchFollowingSafeRedirects,
  safeContentType,
  validateProxyTarget,
} from "./safe-fetch.js";
import { byteCap, cachingCollector } from "./proxy-streams.js";

// The SSRF guard lives in safe-fetch.ts; re-exported for existing callers.
export {
  drainAndDiscard,
  isPrivateAddress,
  safeContentType,
  validateProxyTarget,
} from "./safe-fetch.js";

// Cap the response body so a huge (or endless) upstream can't exhaust bandwidth
// or memory. NFT video is the largest legit media; 64 MB is generous for it.
const MAX_BODY_BYTES = 64 * 1024 * 1024;
// Open-proxy abuse guards: a per-IP sliding window plus a global ceiling on
// concurrent upstream fetches (each holds a socket for up to REQUEST_TIMEOUT_MS).
// The per-IP window is a coarse abuse cap, not the bandwidth control — MAX_INFLIGHT
// bounds instantaneous load and MAX_BODY_BYTES bounds each response. Clients now
// coalesce art loads (see themes' LoadPool), so a single legitimate viewer's
// startup burst stays well under this; the headroom covers theme reloads and
// several viewers sharing one NAT/CGNAT address.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_IP = 600;
const MAX_INFLIGHT = 32;
// Negative cache: once an NFT's art fetch fails (dead DNS, unpinned IPFS CID
// that hangs to the timeout, deprecated gateway), remember it so we short-circuit
// instead of re-stalling on every viewer and every snapshot replay. Capacity
// tracks the MediaIndex so any replayable NFT can be remembered.
//
// Backoff, not a flat window: a merely-slow gateway that trips the 6 s timeout
// once is blocked for just FAIL_BASE_TTL_MS and then retried (so its thumbnail
// comes back quickly), while a genuinely dead target that keeps failing doubles
// its way up to FAIL_MAX_TTL_MS so we stop re-stalling on it. A successful fetch
// clears the streak.
const FAIL_BASE_TTL_MS = 30 * 1000;
const FAIL_MAX_TTL_MS = 10 * 60 * 1000;
const FAIL_CAPACITY = 10_000;

// In-memory response cache for bounded media (thumbnails + small images). Large
// videos and ranged requests are never cached — they stream through the hardened
// path unchanged. Total heap held at/below the budget; oldest evicts first.
const CACHE_BYTE_BUDGET = 64 * 1024 * 1024;
const CACHE_ENTRY_MAX_BYTES = 4 * 1024 * 1024; // == THUMB_MAX_BYTES
// Real transient RSS ≈ (MAX_INFLIGHT × CACHE_ENTRY_MAX_BYTES) + CACHE_BYTE_BUDGET
// ≈ 32×4MB + 64MB ≈ 192MB, since each cacheable leader also buffers its body.

const PASS_THROUGH = ["content-length", "content-range", "accept-ranges"] as const;

/** A promise with its resolver exposed, for the single-flight in-flight map. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** Serve a cached body with the same headers a fresh serve would set. */
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

/**
 * GET /img?nft=… — resolve the NFT launcher id through the server-side MediaIndex
 * to the on-chain art URL the server decoded, then fetch it server-side and stream
 * it back with permissive CORS so the WebGL gallery can texture media from hosts
 * that don't send CORS headers. /img never accepts an arbitrary client-supplied
 * URL; every target comes from the server's own chain decoding. launcherId is
 * stable across spends, so the response URL caches well. Hardened against SSRF
 * (protocol allowlist; private-range blocking with connect-time DNS validation that
 * also closes rebinding; manual redirect re-validation) and against open-proxy
 * HTML/script injection (media-only content-type + nosniff + sandbox CSP).
 */
/** Resolves a target URL (following redirects) to a final upstream response. */
export type UpstreamFetcher = (
  url: URL,
  range: string | undefined
) => Promise<IncomingMessage | null>;

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
  const limiter = new RateLimiter(RATE_WINDOW_MS, RATE_MAX_PER_IP);
  let inflight = 0;

  // Single-flight: concurrent cold requests for the same key await one leader's
  // fetch instead of each opening their own. Resolves with the cached body, or
  // null when the leader's body turned out uncacheable (waiters then fall
  // through to their own fetch — same as today for videos).
  const inFlightLeaders = new Map<string, Promise<CachedResponse | null>>();

  // periodically drop stale buckets so the maps can't grow without bound
  const sweep = setInterval(() => {
    limiter.sweep();
    failures.sweep();
  }, RATE_WINDOW_MS);
  sweep.unref();

  app.get("/img", async (request, reply) => {
    if (limiter.limited(request.ip)) return reply.code(429).send("rate limited");

    const launcherId = (request.query as { nft?: string }).nft;
    const entry = launcherId ? media.get(launcherId) : undefined;
    if (!entry) return reply.code(404).send("unknown nft");

    const key = `img:${launcherId!}`;
    const hasRange = typeof request.headers.range === "string";
    if (!hasRange) {
      const cached = cache.get(key);
      if (cached) return serveCached(reply, cached);
      const pending = inFlightLeaders.get(key);
      if (pending) {
        const shared = await pending;
        if (shared) return serveCached(reply, shared);
        // leader's body was uncacheable → fall through to an independent fetch
      }
    }

    // a recently-failed target short-circuits here — before consuming an inflight
    // slot or re-incurring the upstream stall on every viewer / snapshot replay
    if (failures.has(launcherId!)) return reply.code(504).send("upstream recently failed");

    if (inflight >= MAX_INFLIGHT) return reply.code(503).send("proxy busy");

    // Try the primary URL, then any fallback (the original on-chain art URL kept
    // when ContentFilter upgrades `url` to the Archive CDN). A non-2xx response —
    // e.g. an intermittent Archive 404 — moves on to the next candidate so the
    // client gets real bytes instead of an error body it would mis-render.
    const candidates = [entry.url, entry.fallbackUrl]
      .filter((u): u is string => typeof u === "string")
      .map(validateProxyTarget)
      .filter((u): u is URL => u !== null);
    if (candidates.length === 0) return reply.code(400).send("disallowed nft url");

    // Become the single-flight leader for this key so concurrent cold requests
    // coalesce onto this fetch. Only non-ranged requests participate.
    const lead = !hasRange ? deferred<CachedResponse | null>() : null;
    if (lead) inFlightLeaders.set(key, lead.promise);
    let settled = false;
    const settle = (value: CachedResponse | null): void => {
      if (lead && !settled) {
        settled = true;
        // Only remove our own entry: a waiter that fell through (leader
        // resolved null) may have already re-registered as the new leader, so
        // deleting unconditionally would orphan its still-live promise.
        if (inFlightLeaders.get(key) === lead.promise) inFlightLeaders.delete(key);
        lead.resolve(value);
      }
    };

    inflight++;
    let released = false;
    const release = (): void => {
      if (!released) {
        released = true;
        inflight--;
      }
    };

    let upstream: IncomingMessage | null = null;
    let sawError = false;
    for (const target of candidates) {
      let res: IncomingMessage | null;
      try {
        res = await fetchUpstream(target, request.headers.range);
      } catch {
        sawError = true;
        continue;
      }
      if (!res) continue;
      // Only retry on availability failures a fallback URL could fix (a missing
      // Archive object → 404, or a transient 5xx). Other statuses — including
      // 416 Range Not Satisfiable, a valid answer to a range request — pass
      // through to the client unchanged rather than being masked as 502.
      const code = res.statusCode ?? 0;
      if (code === 404 || code >= 500) {
        drainAndDiscard(res); // drain and release the socket before trying the fallback
        continue;
      }
      upstream = res;
      break;
    }
    if (!upstream) {
      release();
      failures.mark(launcherId!);
      settle(null);
      return sawError
        ? reply.code(504).send("upstream fetch failed")
        : reply.code(502).send("upstream unavailable");
    }

    // reject obviously-oversized bodies before streaming a single byte
    const declared = Number(upstream.headers["content-length"]);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      upstream.destroy();
      release();
      failures.mark(launcherId!);
      settle(null);
      return reply.code(502).send("upstream too large");
    }

    const status = upstream.statusCode ?? 502;
    reply.code(status);
    reply.header("access-control-allow-origin", "*");
    // only cache successful media — don't pin upstream errors for a day
    if (status === 200 || status === 206) {
      reply.header("cache-control", "public, max-age=86400");
      failures.clear(launcherId!); // recovered → drop any prior backoff streak
    }
    const ct = safeContentType(upstream.headers["content-type"]);
    reply.header("content-type", ct);
    reply.header("x-content-type-options", "nosniff");
    reply.header("content-security-policy", "sandbox; default-src 'none'");
    for (const name of PASS_THROUGH) {
      const value = upstream.headers[name];
      if (typeof value === "string") reply.header(name, value);
    }

    // enforce the cap mid-stream too — content-length can lie or be absent.
    // Each stage's error tears down the others; the inflight slot is freed when
    // the delivered stream closes (the collector's close for a cached image, or
    // capped's close otherwise).
    const capped = byteCap(MAX_BODY_BYTES);
    upstream.on("error", () => capped.destroy());

    // Cache only a full 200 image with no range: tee the streamed bytes into a
    // collector that fills the cache on a clean end. Everything else (videos,
    // ranged/partial responses) streams through the hardened path unchanged.
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
        // A client abort destroys the sent stream directly, with no 'error'
        // event — tear down the rest of the chain too (idempotent if it
        // already ended cleanly) so an abandoned fetch doesn't keep streaming
        // untracked against MAX_INFLIGHT.
        capped.destroy();
        upstream.destroy();
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
    capped.on("close", () => {
      upstream.destroy(); // see the cacheable branch's close handler above
      release();
    });
    upstream.pipe(capped);
    return reply.send(capped);
  });

  const THUMB_MAX_BYTES = 4 * 1024 * 1024; // 4 MB ceiling for thumbnail images

  app.get("/thumbnail", async (request, reply) => {
    if (limiter.limited(request.ip)) return reply.code(429).send("rate limited");

    const launcherId = (request.query as { nft?: string }).nft;
    const entry = launcherId ? media.get(launcherId) : undefined;
    if (!entry?.thumbnailUrl) return reply.code(404).send("no thumbnail");

    const target = validateProxyTarget(entry.thumbnailUrl);
    if (!target) return reply.code(400).send("disallowed thumbnail url");

    const key = `thumb:${launcherId!}`;
    const cachedThumb = cache.get(key);
    if (cachedThumb) return serveCached(reply, cachedThumb);
    const pendingThumb = inFlightLeaders.get(key);
    if (pendingThumb) {
      const shared = await pendingThumb;
      if (shared) return serveCached(reply, shared);
      // leader uncacheable → fall through
    }

    // a recently-failed thumbnail short-circuits here too — before consuming
    // an inflight slot or re-incurring the upstream stall on every viewer and
    // every snapshot replay
    if (failures.has(launcherId!)) return reply.code(504).send("upstream recently failed");

    if (inflight >= MAX_INFLIGHT) return reply.code(503).send("proxy busy");

    const lead = deferred<CachedResponse | null>();
    inFlightLeaders.set(key, lead.promise);
    let settled = false;
    const settle = (value: CachedResponse | null): void => {
      if (!settled) {
        settled = true;
        // Only clear the map if it still holds OUR promise — a later leader may
        // have overwritten it; deleting their live entry would defeat coalescing.
        if (inFlightLeaders.get(key) === lead.promise) inFlightLeaders.delete(key);
        lead.resolve(value);
      }
    };

    inflight++;
    let released = false;
    const release = (): void => {
      if (!released) {
        released = true;
        inflight--;
      }
    };

    let upstream: IncomingMessage | null = null;
    try {
      upstream = await fetchUpstream(target, undefined);
    } catch {
      release();
      failures.mark(launcherId!);
      settle(null);
      return reply.code(504).send("upstream fetch failed");
    }

    if (!upstream || (upstream.statusCode ?? 0) >= 400) {
      if (upstream) drainAndDiscard(upstream);
      release();
      failures.mark(launcherId!);
      settle(null);
      return reply.code(502).send("upstream unavailable");
    }

    const declared = Number(upstream.headers["content-length"]);
    if (Number.isFinite(declared) && declared > THUMB_MAX_BYTES) {
      upstream.destroy();
      release();
      failures.mark(launcherId!);
      settle(null);
      return reply.code(502).send("upstream too large");
    }

    const status = upstream.statusCode ?? 502;
    reply.code(status);
    reply.header("access-control-allow-origin", "*");
    if (status === 200) {
      reply.header("cache-control", "public, max-age=86400");
      failures.clear(launcherId!); // recovered → drop any prior backoff streak
    }
    const ct = safeContentType(upstream.headers["content-type"]);
    reply.header("content-type", ct);
    reply.header("x-content-type-options", "nosniff");
    reply.header("content-security-policy", "sandbox; default-src 'none'");

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
        // see the /img handler's identical close handler above
        capped.destroy();
        upstream!.destroy();
        release();
        const body = collector.result();
        if (body) cache.set(key, { body, contentType: ct });
        settle(body ? { body, contentType: ct } : null);
      });
      upstream.pipe(capped).pipe(collector.stream);
      return reply.send(collector.stream);
    }

    settle(null);
    capped.on("error", () => upstream!.destroy());
    capped.on("close", () => {
      upstream!.destroy();
      release();
    });
    upstream.pipe(capped);
    return reply.send(capped);
  });
}
