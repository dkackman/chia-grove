/**
 * SSRF-hardened upstream fetching for the media proxy: target validation
 * (http(s) only, no localhost/.local, no private IP literals), connect-time DNS
 * validation via `safeLookup` (so a rebinding answer can't slip past a
 * pre-check), and manual redirect following that re-validates every hop.
 * Kept apart from the route handlers in img-proxy.ts so the security boundary
 * can be read — and tested — on its own.
 */
import http from "node:http";
import https from "node:https";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { isIP, type LookupFunction } from "node:net";
import type { IncomingMessage } from "node:http";

const MAX_REDIRECTS = 4;
// Short idle timeout: art that hangs (unpinned IPFS CID, slow gateway) frees the
// painting slot fast instead of stalling a viewer. Resets on socket activity, so
// a steadily-streaming large video isn't cut off mid-download.
const REQUEST_TIMEOUT_MS = 6_000;

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
  // strict decimal only: Number() would accept legacy hex/octal segments
  // ("0x7f" → 127), so anything else becomes NaN and reads as unsafe
  return isPrivateV4Octets(ip.split(".").map((s) => (/^\d{1,3}$/.test(s) ? Number(s) : NaN)));
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
  if (
    g0 === 0 &&
    g1 === 0 &&
    g2 === 0 &&
    g3 === 0 &&
    g4 === 0 &&
    g5 === 0 &&
    g6 === 0 &&
    g7 === 1
  ) {
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
export async function fetchFollowingSafeRedirects(
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
