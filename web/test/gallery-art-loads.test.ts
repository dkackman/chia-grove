import { expect, test } from "vitest";
import { InFlightArt, shouldHangLoaded } from "../src/themes/gallery/art-loads.js";

test("a job guards its launcher until it settles", () => {
  const f = new InFlightArt();
  const job = f.begin("a", 10);
  expect(f.has("a")).toBe(true);
  expect(f.settle(job)).toBe(true); // landed while live → may hang
  expect(f.has("a")).toBe(false);
});

test("a load landing after its timeout settled the job is not hung", () => {
  const f = new InFlightArt();
  const job = f.begin("a", 10);
  f.settle(job); // onTimeout
  const live = f.settle(job); // the late onReady
  expect(live).toBe(false);
  expect(shouldHangLoaded(live, false)).toBe(false);
});

test("a late load for an NFT already on the wall is deduped", () => {
  expect(shouldHangLoaded(true, true)).toBe(false);
  expect(shouldHangLoaded(true, false)).toBe(true);
});

test("settling a stale job leaves a newer job for the same launcher in place", () => {
  const f = new InFlightArt();
  const old = f.begin("a", 10);
  f.settle(old); // timed out
  const fresh = f.begin("a", 12); // a later event retries
  expect(f.settle(old)).toBe(false); // old's late load lands
  expect(f.has("a")).toBe(true); // fresh is still guarding
  expect(f.settle(fresh)).toBe(true);
});

test("a reorg cancels in-flight loads from orphaned heights only", () => {
  const f = new InFlightArt();
  const keep = f.begin("a", 9);
  const gone1 = f.begin("b", 10);
  const gone2 = f.begin("c", 11);
  const cancelled = f.cancelFrom(10);
  expect(cancelled.map((j) => j.launcher).sort()).toEqual(["b", "c"]);
  expect(gone1.live).toBe(false);
  expect(gone2.live).toBe(false);
  expect(f.settle(gone1)).toBe(false); // its load lands afterwards → discarded
  expect(keep.live).toBe(true);
  expect(f.has("a")).toBe(true);
  expect(f.size).toBe(1);
});
