import { expect, test } from "vitest";
import { validateProxyTarget } from "../src/web/img-proxy.js";

test("accepts public http(s) urls", () => {
  expect(validateProxyTarget("https://example.com/a.jpg")?.href).toBe("https://example.com/a.jpg");
  expect(validateProxyTarget("http://cdn.test/x.mp4")).not.toBeNull();
});

test("rejects non-http protocols", () => {
  for (const u of ["data:image/png;base64,xxx", "ftp://h/x", "file:///etc/passwd", "javascript:alert(1)"]) {
    expect(validateProxyTarget(u)).toBeNull();
  }
});

test("rejects private / loopback hosts (SSRF guard)", () => {
  for (const u of [
    "http://localhost/x",
    "http://127.0.0.1/x",
    "http://10.0.0.5/x",
    "http://192.168.1.1/x",
    "http://169.254.1.1/x",
    "http://172.16.0.1/x",
    "http://[::1]/x",
  ]) {
    expect(validateProxyTarget(u)).toBeNull();
  }
});

test("rejects unparseable input", () => {
  expect(validateProxyTarget("not a url")).toBeNull();
});
