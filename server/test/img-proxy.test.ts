import { expect, test } from "vitest";
import { PassThrough } from "node:stream";
import type { IncomingMessage } from "node:http";
import fastify from "fastify";
import pino from "pino";
import {
  isPrivateAddress,
  registerImageProxy,
  safeContentType,
  validateProxyTarget,
} from "../src/web/img-proxy.js";
import { buildServer } from "../src/web/server.js";
import { Hub } from "../src/web/hub.js";
import { RingBuffer } from "../src/web/ring-buffer.js";
import { MediaIndex } from "../src/web/media-index.js";
import { FailureCache } from "../src/web/failure-cache.js";
import { MediaCache } from "../src/web/media-cache.js";
import type { GroveEvent } from "@grove/shared";

const silent = pino({ level: "silent" });

test("accepts public http(s) urls", () => {
  expect(validateProxyTarget("https://example.com/a.jpg")?.href).toBe("https://example.com/a.jpg");
  expect(validateProxyTarget("http://cdn.test/x.mp4")).not.toBeNull();
});

test("rejects non-http protocols", () => {
  for (const u of [
    "data:image/png;base64,xxx",
    "ftp://h/x",
    "file:///etc/passwd",
    "javascript:alert(1)",
  ]) {
    expect(validateProxyTarget(u)).toBeNull();
  }
});

test("rejects literal private / loopback hosts", () => {
  for (const u of [
    "http://localhost/x",
    "http://127.0.0.1/x",
    "http://10.0.0.5/x",
    "http://192.168.1.1/x",
    "http://169.254.169.254/latest/meta-data", // cloud metadata
    "http://172.16.0.1/x",
    "http://[::1]/x",
  ]) {
    expect(validateProxyTarget(u)).toBeNull();
  }
});

test("rejects unparseable input", () => {
  expect(validateProxyTarget("not a url")).toBeNull();
});

test("allows only default web ports, rejecting other ports", () => {
  expect(validateProxyTarget("https://example.com/a.jpg")).not.toBeNull(); // default
  expect(validateProxyTarget("http://example.com:80/a.jpg")).not.toBeNull();
  expect(validateProxyTarget("https://example.com:443/a.jpg")).not.toBeNull();
  expect(validateProxyTarget("http://example.com:22/a.jpg")).toBeNull(); // ssh
  expect(validateProxyTarget("http://example.com:8080/a.jpg")).toBeNull();
  expect(validateProxyTarget("http://example.com:6379/a.jpg")).toBeNull(); // redis
});

test("isPrivateAddress flags loopback/private/link-local/CGNAT/mapped (v4 + v6)", () => {
  for (const ip of [
    "0.0.0.0",
    "127.0.0.1",
    "10.1.2.3",
    "192.168.0.1",
    "169.254.169.254",
    "172.16.5.5",
    "172.31.0.1",
    "100.64.0.1",
    "::1",
    "::",
    "fc00::1",
    "fd12::3",
    "fe80::1",
    "::ffff:127.0.0.1",
  ]) {
    expect(isPrivateAddress(ip)).toBe(true);
  }
});

test("isPrivateAddress allows genuinely public addresses", () => {
  for (const ip of [
    "8.8.8.8",
    "1.1.1.1",
    "172.15.0.1", // just below the private 172.16/12 block
    "172.32.0.1", // just above it
    "100.63.0.1", // below CGNAT
    "100.128.0.1", // above CGNAT
    "2606:4700:4700::1111",
    "::ffff:8.8.8.8",
  ]) {
    expect(isPrivateAddress(ip)).toBe(false);
  }
});

test("safeContentType serves only media types, neutralizing html and svg", () => {
  expect(safeContentType("image/jpeg")).toBe("image/jpeg");
  expect(safeContentType("video/mp4")).toBe("video/mp4");
  expect(safeContentType("audio/mpeg")).toBe("audio/mpeg");
  expect(safeContentType("text/html")).toBe("application/octet-stream");
  expect(safeContentType("image/svg+xml")).toBe("application/octet-stream"); // scriptable
  expect(safeContentType(undefined)).toBe("application/octet-stream");
});

// Resolution-path behavioral tests — use inject so no real network calls are made.
// The rejection branches (404/400) return before any upstream fetch.

test("GET /img with no nft param → 404", async () => {
  const app = await buildServer(
    new Hub(new RingBuffer<GroveEvent>(10), "test"),
    new MediaIndex(10),
    silent
  );
  const res = await app.inject({ method: "GET", url: "/img" });
  expect(res.statusCode).toBe(404);
  await app.close();
});

test("GET /img?nft=deadbeef with no matching entry → 404", async () => {
  const app = await buildServer(
    new Hub(new RingBuffer<GroveEvent>(10), "test"),
    new MediaIndex(10),
    silent
  );
  const res = await app.inject({ method: "GET", url: "/img?nft=deadbeef" });
  expect(res.statusCode).toBe(404);
  await app.close();
});

test("GET /img?nft=abc with a disallowed (loopback) URL → 400", async () => {
  const media = new MediaIndex(10);
  media.set("abc", { url: "http://127.0.0.1/x.png", kind: "image" });
  const app = await buildServer(new Hub(new RingBuffer<GroveEvent>(10), "test"), media, silent);
  const res = await app.inject({ method: "GET", url: "/img?nft=abc" });
  expect(res.statusCode).toBe(400);
  await app.close();
});

// Negative-cache behavior. The `.invalid` TLD (RFC 6761) is guaranteed never to
// resolve, so the upstream fetch fails fast and offline — no real network host.

test("a recently-failed nft short-circuits without re-fetching", async () => {
  const media = new MediaIndex(10);
  media.set("abc", { url: "http://nonexistent.invalid/x.png", kind: "image" });
  const failures = new FailureCache(60_000, 10);
  failures.mark("abc"); // stand in for a prior fetch that already failed
  const app = fastify();
  registerImageProxy(app, media, failures);
  const res = await app.inject({ method: "GET", url: "/img?nft=abc" });
  expect(res.statusCode).toBe(504);
  expect(res.body).toContain("recently failed"); // cached message, not a fresh fetch
  await app.close();
});

test("marks an nft as failed after its upstream fetch fails", async () => {
  const media = new MediaIndex(10);
  media.set("fail1", { url: "http://nonexistent.invalid/y.png", kind: "image" });
  const failures = new FailureCache(60_000, 10);
  const app = fastify();
  registerImageProxy(app, media, failures);
  const res = await app.inject({ method: "GET", url: "/img?nft=fail1" });
  expect(res.statusCode).toBe(504);
  expect(failures.has("fail1")).toBe(true); // future requests will short-circuit
  await app.close();
});

// Fallback path: when the Archive CDN URL the ContentFilter stamps in is
// intermittently unreachable (404), the proxy must serve the original IPFS URL
// instead of a non-image error body — otherwise the browser <img> errors and the
// detail card escalates the kind, rendering a still PNG as a black <video>.
// A PassThrough stands in for an http(s) IncomingMessage (it streams + exposes
// statusCode/headers), so no real network/SSRF-blocked host is involved.

function fakeUpstream(status: number, contentType: string, body = "x"): IncomingMessage {
  const s = new PassThrough() as unknown as IncomingMessage & PassThrough;
  s.statusCode = status;
  s.headers = { "content-type": contentType };
  process.nextTick(() => s.end(body));
  return s;
}

test("falls back to the original url when the primary (Archive) 404s", async () => {
  const media = new MediaIndex(10);
  media.set("abc", {
    url: "https://archive.test/content/h",
    kind: "image",
    fallbackUrl: "https://ipfs.test/41.png",
  });
  const calls: string[] = [];
  const fetcher = async (url: URL): Promise<IncomingMessage | null> => {
    calls.push(url.href);
    return url.href.includes("archive.test")
      ? fakeUpstream(404, "application/json", "{}")
      : fakeUpstream(200, "image/png", "PNGDATA");
  };
  const app = fastify();
  registerImageProxy(app, media, new FailureCache(60_000, 10), fetcher);
  const res = await app.inject({ method: "GET", url: "/img?nft=abc" });
  expect(res.statusCode).toBe(200);
  expect(res.headers["content-type"]).toBe("image/png");
  expect(res.body).toBe("PNGDATA");
  expect(calls).toEqual(["https://archive.test/content/h", "https://ipfs.test/41.png"]);
  await app.close();
});

test("does not fetch the fallback when the primary succeeds", async () => {
  const media = new MediaIndex(10);
  media.set("ok1", {
    url: "https://archive.test/content/h",
    kind: "image",
    fallbackUrl: "https://ipfs.test/41.png",
  });
  const calls: string[] = [];
  const fetcher = async (url: URL): Promise<IncomingMessage | null> => {
    calls.push(url.href);
    return fakeUpstream(200, "image/png", "PNGDATA");
  };
  const app = fastify();
  registerImageProxy(app, media, new FailureCache(60_000, 10), fetcher);
  const res = await app.inject({ method: "GET", url: "/img?nft=ok1" });
  expect(res.statusCode).toBe(200);
  expect(calls).toEqual(["https://archive.test/content/h"]); // fallback untouched
  await app.close();
});

// The fallback loop must only retry on availability failures (404 / 5xx) that a
// fallback URL could fix. A 416 Range Not Satisfiable is a valid answer to a
// range request, not a dead upstream — it must reach the client unchanged and
// must not poison the negative cache (which would 504 even plain requests).

test("passes a 416 Range Not Satisfiable through to the client instead of masking it as 502", async () => {
  const media = new MediaIndex(10);
  media.set("rng", { url: "https://cdn.test/clip.mp4", kind: "video" });
  const failures = new FailureCache(60_000, 10);
  const fetcher = async (): Promise<IncomingMessage | null> =>
    fakeUpstream(416, "text/plain", "range not satisfiable");
  const app = fastify();
  registerImageProxy(app, media, failures, fetcher);
  const res = await app.inject({
    method: "GET",
    url: "/img?nft=rng",
    headers: { range: "bytes=999999999-" },
  });
  expect(res.statusCode).toBe(416); // forwarded, not synthesized into 502
  expect(failures.has("rng")).toBe(false); // a range answer must not mark the nft failed
  await app.close();
});

test("falls back to the original url when the primary 5xx-es", async () => {
  const media = new MediaIndex(10);
  media.set("svc", {
    url: "https://archive.test/content/h",
    kind: "image",
    fallbackUrl: "https://ipfs.test/41.png",
  });
  const calls: string[] = [];
  const fetcher = async (url: URL): Promise<IncomingMessage | null> => {
    calls.push(url.href);
    return url.href.includes("archive.test")
      ? fakeUpstream(503, "text/plain", "busy")
      : fakeUpstream(200, "image/png", "PNGDATA");
  };
  const app = fastify();
  registerImageProxy(app, media, new FailureCache(60_000, 10), fetcher);
  const res = await app.inject({ method: "GET", url: "/img?nft=svc" });
  expect(res.statusCode).toBe(200);
  expect(res.body).toBe("PNGDATA");
  expect(calls).toEqual(["https://archive.test/content/h", "https://ipfs.test/41.png"]);
  await app.close();
});

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

test("an upstream error mid-stream on a cacheable image aborts cleanly, no hang, partial not cached", async () => {
  const media = new MediaIndex(10);
  media.set("errimg", { url: "https://cdn.test/e.png", kind: "image" });
  let calls = 0;
  const fetcher = async (): Promise<IncomingMessage | null> => {
    calls++;
    if (calls === 1) {
      const s = new PassThrough() as unknown as IncomingMessage & PassThrough;
      s.statusCode = 200;
      s.headers = { "content-type": "image/png" };
      process.nextTick(() => {
        s.write("PART");
        s.destroy(new Error("upstream reset")); // reset after some bytes
      });
      return s;
    }
    return fakeUpstream(200, "image/png", "PNGDATA"); // a later request succeeds
  };
  const cache = new MediaCache(1_000_000);
  const app = fastify();
  registerImageProxy(app, media, new FailureCache(60_000, 10), fetcher, cache);

  // The reset aborts the response, so inject rejects — but it must SETTLE, not
  // hang. If the collector weren't torn down, this await never returns and the
  // test times out. The .catch swallows the expected abort rejection.
  await app.inject({ method: "GET", url: "/img?nft=errimg" }).catch(() => {});
  expect(cache.get("img:errimg")).toBeUndefined(); // a partial body is never cached

  // The endpoint still serves after an aborted stream.
  const ok = await app.inject({ method: "GET", url: "/img?nft=errimg" });
  expect(ok.statusCode).toBe(200);
  expect(ok.body).toBe("PNGDATA");
  expect(calls).toBe(2);
  await app.close();
});
