import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { FastifyInstance } from "fastify";

// hostnames/IPs we refuse to proxy to, so the proxy can't be used to reach the
// host's own network (basic SSRF guard — literal-host check, not DNS rebinding)
const BLOCKED_HOST = [
  /^localhost$/i,
  /\.local$/i,
  /^0\./,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^\[?::1\]?$/,
];

/** Validate an image-proxy target: only public http(s) URLs are allowed. */
export function validateProxyTarget(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (BLOCKED_HOST.some((re) => re.test(url.hostname))) return null;
  return url;
}

const PASS_THROUGH = ["content-type", "content-length", "content-range", "accept-ranges"];

/**
 * GET /img?url=… — fetch NFT media server-side and stream it back with
 * permissive CORS, so the WebGL gallery can texture media from hosts that don't
 * send CORS headers themselves. Range requests are forwarded for video seeking.
 */
export function registerImageProxy(app: FastifyInstance): void {
  app.get("/img", async (request, reply) => {
    const raw = (request.query as { url?: string }).url;
    const target = raw ? validateProxyTarget(raw) : null;
    if (!target) return reply.code(400).send("bad or disallowed url");

    const range = request.headers.range;
    try {
      const upstream = await fetch(target, {
        headers: range ? { range } : {},
        signal: AbortSignal.timeout(12_000),
      });
      if (!upstream.body) return reply.code(502).send("empty upstream");

      reply.code(upstream.status);
      reply.header("access-control-allow-origin", "*");
      reply.header("cache-control", "public, max-age=86400");
      for (const name of PASS_THROUGH) {
        const value = upstream.headers.get(name);
        if (value) reply.header(name, value);
      }
      return reply.send(Readable.fromWeb(upstream.body as NodeReadableStream<Uint8Array>));
    } catch {
      return reply.code(504).send("upstream fetch failed");
    }
  });
}
