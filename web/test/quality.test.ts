import { expect, test } from "vitest";
import { QUALITY_LEVELS, QualityGovernor } from "../src/themes/shared/quality.js";

/** Feed `ms`-long frames for `durationMs`, starting at `start`; returns the end time and changes. */
function run(g: QualityGovernor, ms: number, durationMs: number, start = 0) {
  const changes: number[] = [];
  let now = start;
  while (now < start + durationMs) {
    now += ms;
    if (g.sample(ms, now)) changes.push(g.index);
  }
  return { now, changes };
}

test("a device holding 60 fps stays at full quality", () => {
  const g = new QualityGovernor();
  run(g, 16.7, 60_000);
  expect(g.index).toBe(0);
  expect(g.level).toEqual(QUALITY_LEVELS[0]);
});

test("sustained slow frames step down one level at a time, ending with bloom off", () => {
  const g = new QualityGovernor();
  const { now, changes } = run(g, 33, 2_500);
  expect(changes).toEqual([1]); // one step after ~2s, not all at once
  expect(g.level.maxPixelRatio).toBe(1.25);
  run(g, 33, 20_000, now);
  expect(g.index).toBe(QUALITY_LEVELS.length - 1);
  expect(g.level).toEqual({ maxPixelRatio: 1, bloom: false });
});

test("a brief hitch does not degrade", () => {
  const g = new QualityGovernor();
  let { now } = run(g, 16.7, 5_000);
  ({ now } = run(g, 40, 500, now));
  run(g, 16.7, 5_000, now);
  expect(g.index).toBe(0);
});

test("long gaps (hidden tab) are ignored", () => {
  const g = new QualityGovernor();
  for (let i = 0; i < 50; i++) g.sample(5_000, i * 5_000);
  expect(g.index).toBe(0);
});

test("recovers slowly once frames are fast again, and waits longer after a relapse", () => {
  const g = new QualityGovernor();
  const { now } = run(g, 33, 2_500);
  expect(g.index).toBe(1);
  let r = run(g, 16.7, 15_000, now); // not yet: recovery takes 20s
  expect(g.index).toBe(1);
  r = run(g, 16.7, 10_000, r.now);
  expect(g.index).toBe(0);
  // relapse: the next recovery waits 40s
  r = run(g, 33, 2_500, r.now);
  expect(g.index).toBe(1);
  r = run(g, 16.7, 30_000, r.now);
  expect(g.index).toBe(1);
  run(g, 16.7, 15_000, r.now);
  expect(g.index).toBe(0);
});
