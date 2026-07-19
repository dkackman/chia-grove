import { afterEach, expect, test, vi } from "vitest";
import { LoadPool } from "../src/themes/shared/load-pool.js";

afterEach(() => {
  vi.useRealTimers();
});

test("skips a job whose slot was recycled before it reached the front", () => {
  const started: string[] = [];
  const dones = new Map<string, () => void>();
  // a job that records when it starts and parks `done` for us to fire later
  const job = (id: string, stillWanted: () => boolean) => ({
    stillWanted,
    start: (done: () => void) => {
      started.push(id);
      dones.set(id, done);
    },
  });

  const pool = new LoadPool(1);
  let bWanted = true;
  pool.submit(job("A", () => true));
  pool.submit(job("B", () => bWanted));
  pool.submit(job("C", () => true));

  // only A can run at concurrency 1; B and C wait behind it
  expect(started).toEqual(["A"]);

  // B's slot gets recycled while A is still loading
  bWanted = false;
  dones.get("A")!(); // A settles → pool advances

  // B is dropped without ever loading; C (still wanted) runs next
  expect(started).toEqual(["A", "C"]);
});

test("invokes onDrop, not start, for a job that is no longer wanted", () => {
  const started: string[] = [];
  const dropped: string[] = [];
  const pool = new LoadPool(1);

  // A holds the only slot so B has to wait behind it
  let releaseA!: () => void;
  pool.submit({
    stillWanted: () => true,
    start: (done) => {
      started.push("A");
      releaseA = done;
    },
  });
  pool.submit({
    stillWanted: () => false, // B's slot was recycled before it ran
    start: (done) => {
      started.push("B");
      done();
    },
    onDrop: () => dropped.push("B"),
  });

  expect(started).toEqual(["A"]);
  releaseA(); // A settles → pool reaches B, finds it unwanted

  expect(started).toEqual(["A"]); // B's loader never ran
  expect(dropped).toEqual(["B"]); // B got a chance to clean up instead
});

test("never runs more jobs at once than the concurrency limit", () => {
  const dones: Array<() => void> = [];
  const job = () => ({
    stillWanted: () => true,
    start: (done: () => void) => dones.push(done),
  });

  const pool = new LoadPool(2);
  for (let i = 0; i < 5; i++) pool.submit(job());

  const inflight = () => dones.length; // started-but-not-completed proxy
  expect(inflight()).toBe(2); // only 2 of 5 may be active

  // completing one frees exactly one slot for the next queued job
  const finished: number[] = [];
  const complete = () => {
    const done = dones.find((_, i) => !finished.includes(i));
    const idx = dones.indexOf(done!);
    finished.push(idx);
    done!();
  };
  complete();
  expect(dones.length - finished.length).toBe(2); // still ≤ 2 active
  complete();
  expect(dones.length - finished.length).toBe(2);
  complete();
  expect(dones.length - finished.length).toBe(2);
  complete();
  expect(dones.length - finished.length).toBe(1); // queue drained, last one finishing
});

// A job whose start() never calls done() (a stalled fetch, a video whose
// loadedmetadata/seeked/error never fires) would otherwise hold its
// concurrency slot forever with no recourse. timeoutMs is an opt-in safety
// net that reclaims it.

test("reclaims a stalled job's slot via timeout so queued work behind it can proceed", () => {
  vi.useFakeTimers();
  const started: string[] = [];
  const pool = new LoadPool(1, 5000);
  pool.submit({
    stillWanted: () => true,
    start: () => started.push("stalled"), // never calls done()
  });
  pool.submit({
    stillWanted: () => true,
    start: (done) => {
      started.push("B");
      done();
    },
  });

  expect(started).toEqual(["stalled"]); // B stuck behind the stalled job
  vi.advanceTimersByTime(5000);
  expect(started).toEqual(["stalled", "B"]); // timeout reclaimed the slot
});

test("without a timeoutMs, a stalled job holds its slot forever (opt-in only)", () => {
  const started: string[] = [];
  const pool = new LoadPool(1); // no timeout configured — matches prior behavior
  pool.submit({ stillWanted: () => true, start: () => started.push("stalled") });
  pool.submit({
    stillWanted: () => true,
    start: (done) => {
      started.push("B");
      done();
    },
  });
  expect(started).toEqual(["stalled"]); // B never gets a turn
});

test("calls onTimeout so the caller can release its own state when a stalled job is reclaimed", () => {
  vi.useFakeTimers();
  const timedOut: string[] = [];
  const pool = new LoadPool(1, 5000);
  pool.submit({
    stillWanted: () => true,
    start: () => {}, // never calls done()
    onTimeout: () => timedOut.push("stalled"),
  });

  vi.advanceTimersByTime(5000);
  expect(timedOut).toEqual(["stalled"]);
});

test("does not call onTimeout for a job that completes normally before its timeout fires", () => {
  vi.useFakeTimers();
  const timedOut: string[] = [];
  const pool = new LoadPool(1, 1000);
  let releaseA!: () => void;
  pool.submit({
    stillWanted: () => true,
    start: (done) => {
      releaseA = done;
    },
    onTimeout: () => timedOut.push("A"),
  });

  releaseA();
  vi.advanceTimersByTime(10_000);
  expect(timedOut).toEqual([]);
});

test("a job that completes normally doesn't get double-reclaimed when its timeout later fires", () => {
  vi.useFakeTimers();
  const pool = new LoadPool(1, 1000);
  let releaseA!: () => void;
  const started: string[] = [];
  pool.submit({
    stillWanted: () => true,
    start: (done) => {
      started.push("A");
      releaseA = done;
    },
  });
  pool.submit({ stillWanted: () => true, start: () => started.push("B") });

  releaseA(); // A finishes normally, well before its timeout
  expect(started).toEqual(["A", "B"]);

  vi.advanceTimersByTime(10_000); // A's (already-cleared) timer would have fired by now
  expect(started).toEqual(["A", "B"]); // no extra effect — no double pump / crash
});
