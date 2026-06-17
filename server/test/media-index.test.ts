import { expect, test } from "vitest";
import { MediaIndex } from "../src/web/media-index.js";

test("stores and resolves by coin id", () => {
  const m = new MediaIndex(3);
  m.set("a", { url: "https://h/a.png", kind: "image" });
  expect(m.get("a")).toEqual({ url: "https://h/a.png", kind: "image" });
  expect(m.get("missing")).toBeUndefined();
});

test("evicts oldest beyond capacity, keeps recent resolvable", () => {
  const m = new MediaIndex(2);
  m.set("a", { url: "u-a", kind: "image" });
  m.set("b", { url: "u-b", kind: "image" });
  m.set("c", { url: "u-c", kind: "image" }); // evicts "a"
  expect(m.get("a")).toBeUndefined();
  expect(m.get("b")?.url).toBe("u-b");
  expect(m.get("c")?.url).toBe("u-c");
});

test("re-inserting a key refreshes its recency so it survives eviction", () => {
  const m = new MediaIndex(2);
  m.set("a", { url: "u-a", kind: "image" });
  m.set("b", { url: "u-b", kind: "image" });
  m.set("a", { url: "u-a2", kind: "image" }); // a re-inserted → now newest
  m.set("c", { url: "u-c", kind: "image" }); // evicts oldest, which is now "b"
  expect(m.get("b")).toBeUndefined();
  expect(m.get("a")?.url).toBe("u-a2");
  expect(m.get("c")?.url).toBe("u-c");
});
