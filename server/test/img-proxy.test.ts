import { expect, test } from "vitest";
import { isPrivateAddress, safeContentType, validateProxyTarget } from "../src/web/img-proxy.js";
import { buildServer } from "../src/web/server.js";
import { Hub } from "../src/web/hub.js";
import { RingBuffer } from "../src/web/ring-buffer.js";
import { MediaIndex } from "../src/web/media-index.js";
import type { GroveEvent } from "@grove/shared";

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

test("GET /img with no coin param → 404", async () => {
  const app = await buildServer(new Hub(new RingBuffer<GroveEvent>(10)), new MediaIndex(10));
  const res = await app.inject({ method: "GET", url: "/img" });
  expect(res.statusCode).toBe(404);
  await app.close();
});

test("GET /img?coin=deadbeef with no matching entry → 404", async () => {
  const app = await buildServer(new Hub(new RingBuffer<GroveEvent>(10)), new MediaIndex(10));
  const res = await app.inject({ method: "GET", url: "/img?coin=deadbeef" });
  expect(res.statusCode).toBe(404);
  await app.close();
});

test("GET /img?coin=abc with a disallowed (loopback) URL → 400", async () => {
  const media = new MediaIndex(10);
  media.set("abc", { url: "http://127.0.0.1/x.png", kind: "image" });
  const app = await buildServer(new Hub(new RingBuffer<GroveEvent>(10)), media);
  const res = await app.inject({ method: "GET", url: "/img?coin=abc" });
  expect(res.statusCode).toBe(400);
  await app.close();
});
