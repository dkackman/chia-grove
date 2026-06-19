import { expect, test } from "vitest";
import { DrainQueue, type FrameScheduler } from "../src/net/drain-queue.js";

function manualScheduler() {
  const frames: Array<() => void> = [];
  const scheduler: FrameScheduler = { schedule: (cb) => frames.push(cb) };
  return {
    scheduler,
    runFrame: () => frames.shift()?.(),
    pending: () => frames.length,
  };
}

test("drains at most budget items per frame, in order", () => {
  const out: number[] = [];
  const { scheduler, runFrame } = manualScheduler();
  const q = new DrainQueue<number>((n) => out.push(n), 3, scheduler);
  q.enqueue([1, 2, 3, 4, 5]);
  runFrame();
  expect(out).toEqual([1, 2, 3]);
  runFrame();
  expect(out).toEqual([1, 2, 3, 4, 5]);
});

test("preserves order across enqueues between frames", () => {
  const out: number[] = [];
  const { scheduler, runFrame } = manualScheduler();
  const q = new DrainQueue<number>((n) => out.push(n), 2, scheduler);
  q.enqueue([1, 2]);
  runFrame();
  q.enqueue([3, 4]);
  runFrame();
  expect(out).toEqual([1, 2, 3, 4]);
});

test("stops scheduling once fully drained", () => {
  const out: number[] = [];
  const { scheduler, runFrame, pending } = manualScheduler();
  const q = new DrainQueue<number>((n) => out.push(n), 10, scheduler);
  q.enqueue([1, 2]);
  runFrame();
  expect(out).toEqual([1, 2]);
  expect(pending()).toBe(0);
});
