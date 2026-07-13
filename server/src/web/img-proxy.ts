import http from "node:http";
import https from "node:https";
import { Transform } from "node:stream";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { isIP, type LookupFunction } from "node:net";
import type { IncomingMessage } from "node:http";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { MediaIndex } from "./media-index.js";
import { FailureCache } from "./failure-cache.js";
import { RateLimiter } from "./rate-limiter.js";
import { MediaCache, type CachedResponse } from "./media-cache.js";

const MAX_REDIRECTS = 4;
// Short idle timeout: art that hangs (unpinned IPFS CID, slow gateway) frees the
// painting slot fast instead of stalling a viewer. Resets on socket activity, so
// a steadily-streaming large video isn't cut off mid-download.
const REQUEST_TIMEOUT_MS = 6_000;
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

// hostnames refused outright; IP-literal and DNS-resolved addresses are checked
// against private ranges separately (isPrivateAddress / safeLookup)
const BLOCKED_HOSTNAME = [/^localhost$/i, /\.local$/i];

/** Validate an image-proxy target: only public http(s) URLs are allowed. */
export function validateProxyTarget(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // only the default web ports — stops the proxy being used to probe arbitrary
  // services/ports on public hosts (an SSRF-relay port scanner)
  if (url.port !== "" && url.port !== "80" && url.port !== "443") return null;
  if (BLOCKED_HOSTNAME.some((re) => re.test(url.hostname))) return null;
  // reject literal private IPs up front; hostnames are validated at connect time
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && isPrivateAddress(host)) return null;
  return url;
}

/** True if an IP literal is loopback/private/link-local/CGNAT/unspecified (v4 or v6). */
export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isPrivateV4(ip);
  if (kind === 6) return isPrivateV6(ip);
  return true; // not a valid IP → treat as unsafe
}

function isPrivateV4Octets(o: number[]): boolean {
  if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = o;
  return (
    a === 0 || // 0.0.0.0/8
    a === 127 || // loopback
    a === 10 || // private
    (a === 192 && b === 168) || // private
    (a === 169 && b === 254) || // link-local (incl. cloud metadata 169.254.169.254)
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 100 && b >= 64 && b <= 127) // CGNAT 100.64/10
  );
}

function isPrivateV4(ip: string): boolean {
  return isPrivateV4Octets(ip.split(".").map(Number));
}

/**
 * Parse an IPv6 literal into its eight 16-bit groups, expanding "::" and
 * folding an embedded dotted-decimal IPv4 tail into two hex groups first.
 * `new URL()` normalizes bracketed hosts (e.g. "[::ffff:127.0.0.1]") to
 * compressed hex form ("::ffff:7f00:1") before validateProxyTarget ever sees
 * them, so matching against dotted-decimal text alone (the previous approach)
 * missed that normalized form entirely — this parses the actual bits instead.
 */
function parseV6Hextets(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, "");
  const pct = s.indexOf("%");
  if (pct !== -1) s = s.slice(0, pct); // strip zone id (e.g. fe80::1%eth0)

  const lastColon = s.lastIndexOf(":");
  if (lastColon !== -1) {
    const tail = s.slice(lastColon + 1);
    if (tail.includes(".")) {
      const octets = tail.split(".");
      const nums = octets.map((o) => Number(o));
      if (
        octets.length !== 4 ||
        nums.some((n, i) => !/^\d{1,3}$/.test(octets[i]) || n < 0 || n > 255)
      ) {
        return null;
      }
      const hi = ((nums[0] << 8) | nums[1]).toString(16);
      const lo = ((nums[2] << 8) | nums[3]).toString(16);
      s = `${s.slice(0, lastColon + 1)}${hi}:${lo}`;
    }
  }

  let groups: string[];
  if (s.includes("::")) {
    const parts = s.split("::");
    if (parts.length !== 2) return null; // "::" may appear at most once
    const left = parts[0] === "" ? [] : parts[0].split(":");
    const right = parts[1] === "" ? [] : parts[1].split(":");
    const missing = 8 - (left.length + right.length);
    if (missing < 0) return null;
    groups = [...left, ...Array(missing).fill("0"), ...right];
  } else {
    groups = s.split(":");
  }
  if (groups.length !== 8) return null;

  const nums = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return nums.some(Number.isNaN) ? null : nums;
}

function isPrivateV6(ip: string): boolean {
  const g = parseV6Hextets(ip);
  if (!g) return true; // unparseable → treat as unsafe
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g;

  if (g.every((n) => n === 0)) return true; // :: unspecified
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 1) {
    return true; // ::1 loopback
  }
  // IPv4-mapped (::ffff:a.b.c.d) and deprecated IPv4-compatible (::a.b.c.d)
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0 || g5 === 0xffff)) {
    return isPrivateV4Octets([g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff]);
  }
  // NAT64 well-known prefix 64:ff9b::/96
  if (g0 === 0x0064 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isPrivateV4Octets([g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff]);
  }
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  return false;
}

/**
 * A DNS lookup that connects only to public addresses. Because the connection
 * uses exactly the address this returns, validating here closes the DNS-rebinding
 * gap a separate pre-check would leave open.
 */
const safeLookup = ((hostname, options, callback) => {
  dnsLookup(
    hostname,
    { all: true, family: options.family, hints: options.hints },
    (err, addresses) => {
      if (err) return callback(err, "", 0);
      const safe = addresses.filter((a) => !isPrivateAddress(a.address));
      if (safe.length === 0) {
        callback(new Error(`blocked non-public address for ${hostname}`), "", 0);
        return;
      }
      // Node's autoSelectFamily calls lookup with all:true and expects the array
      // form; otherwise it wants a single (address, family)
      if (options.all) (callback as (e: Error | null, a: LookupAddress[]) => void)(null, safe);
      else callback(null, safe[0].address, safe[0].family);
    }
  );
}) as LookupFunction;

/** Only serve media types back; anything else (html, svg, …) is made non-renderable. */
export function safeContentType(raw: string | undefined): string {
  const v = (raw ?? "").toLowerCase();
  if (v.startsWith("image/svg")) return "application/octet-stream"; // SVG can carry script
  if (v.startsWith("image/") || v.startsWith("video/") || v.startsWith("audio/")) return raw!;
  return "application/octet-stream";
}

/** Drain and discard a response we're throwing away (a redirect hop, a 404/5xx
 * fallback candidate). Without an 'error' listener, a socket reset while
 * draining — no active reader — is an unhandled EventEmitter error that
 * crashes the whole process, not just this request. */
export function drainAndDiscard(res: IncomingMessage): void {
  res.on("error", () => {});
  res.resume();
}

function requestOnce(url: URL, range: string | undefined): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === "https:" ? https : http;
    const headers: Record<string, string> = { "user-agent": "chia-grove-img-proxy" };
    if (range) headers.range = range;
    const req = mod.request(
      url,
      { method: "GET", lookup: safeLookup, headers, timeout: REQUEST_TIMEOUT_MS },
      resolve
    );
    req.on("timeout", () => req.destroy(new Error("upstream timeout")));
    req.on("error", reject);
    req.end();
  });
}

/** Fetch following redirects manually, re-validating every hop against SSRF. */
async function fetchFollowingSafeRedirects(
  start: URL,
  range: string | undefined
): Promise<IncomingMessage | null> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await requestOnce(url, range);
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      drainAndDiscard(res); // drain and release the socket before the next hop
      const next = validateProxyTarget(new URL(res.headers.location, url).href);
      if (!next) return null; // unparseable or disallowed redirect target
      url = next;
      continue;
    }
    return res;
  }
  return null; // too many redirects
}

const PASS_THROUGH = ["content-length", "content-range", "accept-ranges"] as const;

/** A pass-through that aborts (errors) once more than `max` bytes have flowed. */
function byteCap(max: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      seen += chunk.length;
      if (seen > max) cb(new Error("upstream body exceeded size cap"));
      else cb(null, chunk);
    },
  });
}

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
