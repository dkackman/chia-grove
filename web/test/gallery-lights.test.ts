import { expect, test } from "vitest";
import { LAMP_RAMP_S, lampRamp } from "../src/themes/gallery/lights.js";

test("a lamp starts off and is fully lit once the ramp is over", () => {
  expect(lampRamp(0)).toBe(0);
  expect(lampRamp(LAMP_RAMP_S)).toBe(1);
  expect(lampRamp(5)).toBe(1);
});

test("the switch-on flickers, but reduced motion is a smooth monotonic fade", () => {
  let dipped = false;
  let prevFull = 0;
  let prevReduced = 0;
  for (let t = 0.01; t < LAMP_RAMP_S; t += 0.01) {
    const full = lampRamp(t);
    if (full < prevFull) dipped = true;
    prevFull = full;
    const reduced = lampRamp(t, true);
    expect(reduced).toBeGreaterThanOrEqual(prevReduced);
    expect(full).toBeLessThanOrEqual(reduced + 1e-9);
    prevReduced = reduced;
  }
  expect(dipped).toBe(true);
});
