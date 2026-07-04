import { expect, test } from "vitest";
import { BoundedMap } from "../src/util/bounded-map.js";

test("stores and retrieves values; missing key is undefined", () => {
  const m = new BoundedMap<string, number>(3);
  m.set("a", 1);
  expect(m.get("a")).toBe(1);
  expect(m.get("missing")).toBeUndefined();
});

test("evicts the oldest key once capacity is exceeded", () => {
  const m = new BoundedMap<string, string>(2);
  m.set("a", "u-a");
  m.set("b", "u-b");
  m.set("c", "u-c"); // evicts "a"
  expect(m.get("a")).toBeUndefined();
  expect(m.get("b")).toBe("u-b");
  expect(m.get("c")).toBe("u-c");
});

test("re-inserting a key refreshes its recency so it survives eviction", () => {
  const m = new BoundedMap<string, string>(2);
  m.set("a", "u-a");
  m.set("b", "u-b");
  m.set("a", "u-a2"); // a re-inserted → now newest, value updated
  m.set("c", "u-c"); // evicts oldest, which is now "b"
  expect(m.get("b")).toBeUndefined();
  expect(m.get("a")).toBe("u-a2");
  expect(m.get("c")).toBe("u-c");
});

test("get does NOT bump recency (insertion-order, not access-order)", () => {
  const m = new BoundedMap<string, string>(2);
  m.set("a", "u-a");
  m.set("b", "u-b");
  m.get("a"); // reading must not protect "a" from eviction
  m.set("c", "u-c"); // "a" is still the oldest → evicted
  expect(m.get("a")).toBeUndefined();
  expect(m.get("b")).toBe("u-b");
  expect(m.get("c")).toBe("u-c");
});

test("delete removes an entry; deleting an absent key is a no-op", () => {
  const m = new BoundedMap<string, number>(10);
  m.set("a", 1);
  m.delete("a");
  expect(m.get("a")).toBeUndefined();
  expect(() => m.delete("nope")).not.toThrow();
});

test("has reflects presence", () => {
  const m = new BoundedMap<string, number>(10);
  m.set("a", 1);
  expect(m.has("a")).toBe(true);
  expect(m.has("b")).toBe(false);
});

test("size reflects the number of live entries and never exceeds capacity", () => {
  const m = new BoundedMap<string, number>(2);
  expect(m.size).toBe(0);
  m.set("a", 1);
  m.set("b", 2);
  m.set("c", 3);
  expect(m.size).toBe(2);
});

test("entries() iterates insertion order and reflects eviction", () => {
  const m = new BoundedMap<string, number>(2);
  m.set("a", 1);
  m.set("b", 2);
  m.set("c", 3); // evicts "a"
  expect([...m.entries()]).toEqual([
    ["b", 2],
    ["c", 3],
  ]);
});
