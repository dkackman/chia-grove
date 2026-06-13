import http from "node:http";
import https from "node:https";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { isIP, type LookupFunction } from "node:net";
import type { IncomingMessage } from "node:http";
import type { FastifyInstance } from "fastify";

const MAX_REDIRECTS = 4;
const REQUEST_TIMEOUT_MS = 12_000;

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

function isPrivateV4(ip: string): boolean {
  const o = ip.split(".").map(Number);
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

function isPrivateV6(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (v === "::1" || v === "::") return true; // loopback / unspecified
  const mapped = v.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/); // IPv4-mapped
  if (mapped) return isPrivateV4(mapped[1]);
  const head = v.split(":")[0];
  if (/^f[cd]/.test(head)) return true; // fc00::/7 unique-local
  if (/^fe[89ab]/.test(head)) return true; // fe80::/10 link-local
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
      res.resume(); // drain and release the socket before the next hop
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

/**
 * GET /img?url=… — fetch NFT media server-side and stream it back with permissive
 * CORS so the WebGL gallery can texture media from hosts that don't send CORS
 * headers. Hardened against SSRF (protocol allowlist; private-range blocking with
 * connect-time DNS validation that also closes rebinding; manual redirect
 * re-validation) and against open-proxy HTML/script injection (media-only
 * content-type + nosniff + sandbox CSP).
 */
export function registerImageProxy(app: FastifyInstance): void {
  app.get("/img", async (request, reply) => {
    const raw = (request.query as { url?: string }).url;
    const target = raw ? validateProxyTarget(raw) : null;
    if (!target) return reply.code(400).send("bad or disallowed url");

    let upstream: IncomingMessage | null;
    try {
      upstream = await fetchFollowingSafeRedirects(target, request.headers.range);
    } catch {
      return reply.code(504).send("upstream fetch failed");
    }
    if (!upstream) return reply.code(502).send("upstream unavailable");

    reply.code(upstream.statusCode ?? 502);
    reply.header("access-control-allow-origin", "*");
    reply.header("cache-control", "public, max-age=86400");
    reply.header("content-type", safeContentType(upstream.headers["content-type"]));
    reply.header("x-content-type-options", "nosniff");
    reply.header("content-security-policy", "sandbox; default-src 'none'");
    for (const name of PASS_THROUGH) {
      const value = upstream.headers[name];
      if (typeof value === "string") reply.header(name, value);
    }
    return reply.send(upstream);
  });
}
