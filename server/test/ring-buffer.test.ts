import { expect, test } from "vitest";
import { RingBuffer } from "../src/web/ring-buffer.js";

test("keeps insertion order", () => {
  const buffer = new RingBuffer<number>(5);
  buffer.push(1);
  buffer.push(2);
  buffer.push(3);
  expect(buffer.snapshot()).toEqual([1, 2, 3]);
});

test("drops oldest beyond capacity", () => {
  const buffer = new RingBuffer<number>(3);
  for (const n of [1, 2, 3, 4, 5]) buffer.push(n);
  expect(buffer.snapshot()).toEqual([3, 4, 5]);
});

test("snapshot is a copy", () => {
  const buffer = new RingBuffer<number>(3);
  buffer.push(1);
  const snap = buffer.snapshot();
  snap.push(99);
  expect(buffer.snapshot()).toEqual([1]);
});
