import { expect, test } from "vitest";
import { ConcurrencyGate } from "../src/content-filter/concurrency-gate.js";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

test("runs at most `limit` jobs at once, releasing waiters FIFO", async () => {
  const gate = new ConcurrencyGate(2);
  const jobs = [deferred(), deferred(), deferred(), deferred()];
  const started: number[] = [];
  const runs = jobs.map((job, i) =>
    gate.run(async () => {
      started.push(i);
      await job.promise;
      return i;
    })
  );
  await Promise.resolve();
  expect(started).toEqual([0, 1]);
  jobs[1].resolve();
  await runs[1];
  await Promise.resolve();
  expect(started).toEqual([0, 1, 2]);
  jobs[0].resolve();
  jobs[2].resolve();
  jobs[3].resolve();
  expect(await Promise.all(runs)).toEqual([0, 1, 2, 3]);
});

test("a rejected job frees its slot and propagates the error", async () => {
  const gate = new ConcurrencyGate(1);
  const failing = gate.run(async () => {
    throw new Error("boom");
  });
  const next = gate.run(async () => "ok");
  await expect(failing).rejects.toThrow("boom");
  await expect(next).resolves.toBe("ok");
});
