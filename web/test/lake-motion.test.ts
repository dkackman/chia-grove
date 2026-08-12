import { expect, test } from "vitest";
import { seatOffset, BAND_RADIUS_MIN, BAND_RADIUS_MAX } from "../src/themes/lake/layout.js";
import {
  wanderedRadius,
  wanderedAngle,
  bankRoll,
  turtleStroke,
  jellyPulse,
} from "../src/themes/lake/motion.js";

const seat = seatOffset("a1b2c3d4" + "00".repeat(28));

test("wander is deterministic and keeps the circuit inside the column", () => {
  for (let t = 0; t < 120; t += 0.7) {
    expect(wanderedRadius(seat, t)).toBe(wanderedRadius(seat, t));
    expect(wanderedRadius(seat, t)).toBeGreaterThanOrEqual(BAND_RADIUS_MIN - 2);
    expect(wanderedRadius(seat, t)).toBeLessThanOrEqual(BAND_RADIUS_MAX + 2);
  }
});

test("a wandered path is not a perfect circle", () => {
  const radii = new Set<number>();
  for (let t = 0; t < 60; t += 1) radii.add(Math.round(wanderedRadius(seat, t) * 100));
  expect(radii.size).toBeGreaterThan(3);
});

test("the angle still advances monotonically on average", () => {
  // wander sways the heading but must never stall the circuit for long
  expect(wanderedAngle(seat, 100) - wanderedAngle(seat, 0)).toBeGreaterThan(
    seat.speed * 100 * 0.5
  );
});

test("banking stays subtle and finite", () => {
  for (let t = 0; t < 60; t += 0.3) {
    const roll = bankRoll(seat, t);
    expect(Number.isFinite(roll)).toBe(true);
    expect(Math.abs(roll)).toBeLessThanOrEqual(0.5);
  }
});

test("the turtle stroke surges but never reverses", () => {
  let min = Infinity;
  let max = -Infinity;
  for (let p = 0; p < Math.PI * 2; p += 0.05) {
    const s = turtleStroke(p);
    expect(s.surge).toBeGreaterThan(0);
    min = Math.min(min, s.surge);
    max = Math.max(max, s.surge);
  }
  expect(max).toBeGreaterThan(min * 2); // a real surge, not a constant
});

test("the stroke cycle is periodic", () => {
  const a = turtleStroke(1.3);
  const b = turtleStroke(1.3 + Math.PI * 2);
  expect(a.sweep).toBeCloseTo(b.sweep, 10);
  expect(a.surge).toBeCloseTo(b.surge, 10);
});

test("the jelly pulse rises fast and falls slow", () => {
  // finite-difference slope at the rise (p=0) vs the fall (p=π)
  const d = 1e-4;
  const rise = (jellyPulse(d).lift - jellyPulse(-d).lift) / (2 * d);
  const fall = (jellyPulse(Math.PI + d).lift - jellyPulse(Math.PI - d).lift) / (2 * d);
  expect(rise).toBeGreaterThan(Math.abs(fall) * 2);
});

test("squeeze is a normalized contraction", () => {
  for (let p = 0; p < Math.PI * 2; p += 0.05) {
    const { squeeze } = jellyPulse(p);
    expect(squeeze).toBeGreaterThanOrEqual(0);
    expect(squeeze).toBeLessThanOrEqual(1);
  }
});
