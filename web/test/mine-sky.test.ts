import { expect, test } from "vitest";
import { cyclePhase, sunHeight, daylight, netspaceSun } from "../src/themes/mine/sky.js";

test("cyclePhase wraps within [0,1)", () => {
  expect(cyclePhase(0, 100)).toBeCloseTo(0);
  expect(cyclePhase(50, 100)).toBeCloseTo(0.5);
  expect(cyclePhase(150, 100)).toBeCloseTo(0.5);
});

test("sunHeight peaks at midday and dips at night", () => {
  expect(sunHeight(0.25)).toBeCloseTo(1); // noon
  expect(sunHeight(0.75)).toBeCloseTo(-1); // midnight
});

test("daylight is ~1 at noon and ~0 at night", () => {
  expect(daylight(0.25)).toBeGreaterThan(0.9);
  expect(daylight(0.75)).toBeLessThan(0.05);
});

test("netspaceSun grows with netspace and stays bounded", () => {
  const small = netspaceSun("0");
  const big = netspaceSun((100n * 1024n ** 6n).toString()); // ~100 EiB
  expect(big).toBeGreaterThan(small);
  expect(big).toBeLessThanOrEqual(1.3);
});
