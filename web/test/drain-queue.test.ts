import { afterEach, expect, test, vi } from "vitest";
import { DrainQueue, rafScheduler, type FrameScheduler } from "../src/net/drain-queue.js";

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

test("clear() drops undrained items so a later enqueue doesn't replay them", () => {
  const out: number[] = [];
  const { scheduler, runFrame } = manualScheduler();
  const q = new DrainQueue<number>((n) => out.push(n), 10, scheduler);
  q.enqueue([1, 2, 3]); // schedules a frame, nothing drained yet
  q.clear();
  q.enqueue([4, 5]); // schedules its own frame; the pre-clear one is dead
  runFrame(); // stale pre-clear frame: no-op
  runFrame();
  expect(out).toEqual([4, 5]); // 1, 2, 3 never dispatched
});

test("a frame scheduled before clear() is cancelled and can't double-drain", () => {
  const out: number[] = [];
  const { scheduler, runFrame, pending } = manualScheduler();
  const q = new DrainQueue<number>((n) => out.push(n), 2, scheduler);
  q.enqueue([1, 2, 3, 4]); // schedules frame A
  q.clear();
  q.enqueue([5, 6, 7, 8]); // schedules frame B
  expect(pending()).toBe(2);
  runFrame(); // stale frame A (e.g. the 1s hidden-tab fallback racing a reconnect)
  expect(out).toEqual([]); // belongs to the cleared generation — must not drain
  runFrame(); // frame B
  expect(out).toEqual([5, 6]); // exactly one budget's worth this frame
});

test("clear() on an empty queue is a no-op", () => {
  const out: number[] = [];
  const { scheduler, runFrame, pending } = manualScheduler();
  const q = new DrainQueue<number>((n) => out.push(n), 10, scheduler);
  q.clear();
  q.enqueue([1]);
  runFrame();
  expect(out).toEqual([1]);
  expect(pending()).toBe(0);
});

// rafScheduler backs the live feed's queue. Browsers throttle or fully
// suspend requestAnimationFrame in a hidden/backgrounded tab, which would
// otherwise let the queue grow unbounded while the socket keeps receiving
// batches — it needs a timer fallback so draining never fully stalls.

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("rafScheduler falls back to a timer when requestAnimationFrame never fires", () => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", () => 0); // simulates a frozen/hidden tab: never invoked

  let called = false;
  rafScheduler.schedule(() => (called = true));
  expect(called).toBe(false);
  vi.runOnlyPendingTimers();
  expect(called).toBe(true);
});

test("rafScheduler only fires once when both requestAnimationFrame and the fallback timer are live", () => {
  vi.useFakeTimers();
  let rafCb: (() => void) | undefined;
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
    rafCb = cb;
    return 0;
  });

  let calls = 0;
  rafScheduler.schedule(() => calls++);
  rafCb?.(); // the real rAF fires first, as it normally would in a visible tab
  vi.runOnlyPendingTimers(); // the fallback timer still fires later — must be a no-op
  expect(calls).toBe(1);
});
