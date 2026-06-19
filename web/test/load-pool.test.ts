import { expect, test } from "vitest";
import { LoadPool } from "../src/themes/shared/load-pool.js";

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
