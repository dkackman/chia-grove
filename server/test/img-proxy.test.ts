import { expect, test } from "vitest";
import { PassThrough } from "node:stream";
import http from "node:http";
import type { IncomingMessage } from "node:http";
import fastify from "fastify";
import pino from "pino";
import {
  drainAndDiscard,
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

// `new URL()` normalizes bracketed IPv6-literal hosts to compressed hex form
// (e.g. "[::ffff:127.0.0.1]" -> "::ffff:7f00:1") before validateProxyTarget
// ever sees them. isPrivateV6 previously only matched the dotted-decimal
// textual form and missed this normalized form entirely — SSRF bypass.
test("isPrivateAddress flags IPv4-mapped/compatible v6 in compressed hex form", () => {
  for (const ip of [
    "::ffff:7f00:1", // ::ffff:127.0.0.1, post-URL-normalization form
    "::ffff:a9fe:a9fe", // ::ffff:169.254.169.254 (cloud metadata), post-normalization
    "::ffff:a00:1", // ::ffff:10.0.0.1
    "::7f00:1", // deprecated IPv4-compatible ::127.0.0.1
    "64:ff9b::a9fe:a9fe", // NAT64 well-known prefix wrapping cloud metadata
  ]) {
    expect(isPrivateAddress(ip)).toBe(true);
  }
});

test("validateProxyTarget rejects bracketed IPv4-mapped v6 literals end to end", () => {
  for (const u of [
    "http://[::ffff:169.254.169.254]/latest/meta-data",
    "http://[::ffff:127.0.0.1]/x",
    "http://[::127.0.0.1]/x",
  ]) {
    expect(validateProxyTarget(u)).toBeNull();
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

// drainAndDiscard is used to drain a response body we're throwing away (a
// redirect hop, a 404/5xx fallback candidate). Without an 'error' listener, a
// socket reset while draining is an unhandled EventEmitter error that crashes
// the whole process — not just the one request.

test("drainAndDiscard swallows a late socket error instead of throwing", () => {
  const res = new PassThrough() as unknown as IncomingMessage & PassThrough;
  drainAndDiscard(res);
  expect(() => res.emit("error", new Error("upstream socket reset"))).not.toThrow();
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

// Client-abort (as opposed to an upstream-side error, covered above) tears
// down only the response-side stream today: Fastify destroys the stream it
// was sent with no error argument, so 'close' fires but 'error' never does,
// and nothing tells the upstream fetch to stop. These use a real listening
// server + a real client socket, since a client abort can't be simulated
// through fastify's inject().

async function listenOn(app: ReturnType<typeof fastify>): Promise<number> {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (typeof address !== "object" || address === null) throw new Error("no address");
  return address.port;
}

test("a client that aborts mid-image doesn't leave the upstream fetch running", async () => {
  const media = new MediaIndex(10);
  media.set("abortimg", { url: "https://cdn.test/big.png", kind: "image" });
  const upstream = new PassThrough() as unknown as IncomingMessage & PassThrough;
  upstream.statusCode = 200;
  upstream.headers = { "content-type": "image/png" };
  upstream.write("first-chunk"); // never ends — simulates a still-streaming body
  const fetcher = async (): Promise<IncomingMessage | null> => upstream;
  const app = fastify();
  registerImageProxy(app, media, new FailureCache(60_000, 10), fetcher);
  const port = await listenOn(app);

  await new Promise<void>((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/img?nft=abortimg`, (res) => {
      res.once("data", () => req.destroy());
    });
    req.on("close", resolve);
    req.on("error", () => resolve());
  });
  await new Promise((r) => setTimeout(r, 50)); // let the server's teardown handlers run

  expect(upstream.destroyed).toBe(true);
  await app.close();
});

test("a client that aborts mid-video doesn't leave the upstream fetch running", async () => {
  const media = new MediaIndex(10);
  media.set("abortvid", { url: "https://cdn.test/big.mp4", kind: "video" });
  const upstream = new PassThrough() as unknown as IncomingMessage & PassThrough;
  upstream.statusCode = 200;
  upstream.headers = { "content-type": "video/mp4" };
  upstream.write("first-chunk-of-video");
  const fetcher = async (): Promise<IncomingMessage | null> => upstream;
  const app = fastify();
  registerImageProxy(app, media, new FailureCache(60_000, 10), fetcher);
  const port = await listenOn(app);

  await new Promise<void>((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/img?nft=abortvid`, (res) => {
      res.once("data", () => req.destroy());
    });
    req.on("close", resolve);
    req.on("error", () => resolve());
  });
  await new Promise((r) => setTimeout(r, 50));

  expect(upstream.destroyed).toBe(true);
  await app.close();
});

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

test("a recently-failed thumbnail short-circuits without re-fetching", async () => {
  const media = new MediaIndex(10);
  media.set("tfail1", {
    url: "https://cdn.test/x.mp4",
    kind: "video",
    thumbnailUrl: "https://cdn.test/x_512.webp",
  });
  const failures = new FailureCache(60_000, 10);
  failures.mark("tfail1"); // stand in for a prior fetch that already failed
  let calls = 0;
  const fetcher = async (): Promise<IncomingMessage | null> => {
    calls++;
    return fakeUpstream(200, "image/webp", "WEBPDATA");
  };
  const app = fastify();
  registerImageProxy(app, media, failures, fetcher);
  const res = await app.inject({ method: "GET", url: "/thumbnail?nft=tfail1" });
  expect(res.statusCode).toBe(504);
  expect(calls).toBe(0); // short-circuited, no upstream fetch
  await app.close();
});

test("marks a thumbnail as failed after its upstream fetch fails", async () => {
  const media = new MediaIndex(10);
  media.set("tfail2", {
    url: "https://cdn.test/y.mp4",
    kind: "video",
    thumbnailUrl: "http://nonexistent.invalid/y_512.webp",
  });
  const failures = new FailureCache(60_000, 10);
  const app = fastify();
  registerImageProxy(app, media, failures);
  const res = await app.inject({ method: "GET", url: "/thumbnail?nft=tfail2" });
  expect(res.statusCode).toBe(504);
  expect(failures.has("tfail2")).toBe(true); // future requests will short-circuit
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
