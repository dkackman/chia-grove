import { expect, test } from "vitest";
import { HoldQueue } from "../src/themes/timelord/held.js";

const never = () => false;

test("events pass straight through when nothing holds", () => {
  const q = new HoldQueue<number>(1.8);
  const out: number[] = [];
  q.push(1);
  q.push(2);
  expect(q.release(0, Infinity, (e) => out.push(e), never)).toBe(2);
  expect(out).toEqual([1, 2]);
  expect(q.length).toBe(0);
});

test("a hold keeps the starting event and everything behind it until it expires", () => {
  const q = new HoldQueue<string>(1.8);
  const out: string[] = [];
  for (const e of ["a", "B", "c", "d"]) q.push(e);
  const startsHold = (e: string) => e === "B";
  q.release(10, Infinity, (e) => out.push(e), startsHold);
  expect(out).toEqual(["a"]);
  expect(q.holding(11)).toBe(true);
  q.release(11, Infinity, (e) => out.push(e), startsHold);
  expect(out).toEqual(["a"]);
  // the held event is not held a second time once the hold expires
  q.release(11.8, Infinity, (e) => out.push(e), startsHold);
  expect(out).toEqual(["a", "B", "c", "d"]);
});

test("release is budgeted: a backlog behind a hold drains over several frames", () => {
  const q = new HoldQueue<number>(1.8);
  const out: number[] = [];
  q.push(0);
  q.release(
    0,
    100,
    (e) => out.push(e),
    (e) => e === 0
  );
  for (let i = 1; i <= 500; i++) q.push(i);
  expect(q.length).toBe(501);
  expect(q.release(2, 240, (e) => out.push(e), never)).toBe(240);
  expect(q.length).toBe(261);
  expect(q.release(2.02, 240, (e) => out.push(e), never)).toBe(240);
  expect(q.release(2.04, 240, (e) => out.push(e), never)).toBe(21);
  expect(out).toEqual(Array.from({ length: 501 }, (_, i) => i));
});

test("an infinite clock breaks a hold (hidden tab: frames are frozen)", () => {
  const q = new HoldQueue<number>(1.8);
  const out: number[] = [];
  q.push(1);
  q.release(
    5,
    Infinity,
    (e) => out.push(e),
    () => true
  );
  expect(out).toEqual([]);
  q.push(2);
  q.release(Infinity, Infinity, (e) => out.push(e), never);
  expect(out).toEqual([1, 2]);
});

test("the head index compacts so a long session doesn't grow the backing array", () => {
  const q = new HoldQueue<number>(1.8);
  let n = 0;
  for (let i = 0; i < 5000; i++) {
    q.push(i);
    q.push(i);
    q.release(i, 1, () => n++, never);
  }
  expect(n).toBe(5000);
  expect(q.length).toBe(5000);
  q.release(0, Infinity, () => n++, never);
  expect(q.length).toBe(0);
  expect(n).toBe(10000);
});
