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

test("preserves order across many wraps", () => {
  // exercises the head-pointer reorder logic well past one full wrap:
  // 23 pushes on a cap-4 buffer wraps the head five times and lands it
  // mid-array, so a naive snapshot would return the items rotated.
  const cap = 4;
  const buffer = new RingBuffer<number>(cap);
  const total = 23;
  for (let n = 0; n < total; n++) buffer.push(n);
  expect(buffer.snapshot()).toEqual([19, 20, 21, 22]);
});

test("snapshot of a partially filled buffer omits empty slots", () => {
  const buffer = new RingBuffer<number>(5);
  buffer.push(1);
  buffer.push(2);
  expect(buffer.snapshot()).toEqual([1, 2]);
});
