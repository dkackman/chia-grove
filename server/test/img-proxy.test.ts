import { expect, test } from "vitest";
import { isPrivateAddress, safeContentType, validateProxyTarget } from "../src/web/img-proxy.js";

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
