import { expect, test } from "vitest";
import {
  DOCENT_DWELL_S,
  DOCENT_QUIET_S,
  DOCENT_SPEED,
  docentX,
  shouldStartDocent,
} from "../src/themes/gallery/docent.js";

test("a tour starts only after a quiet spell with wall to walk", () => {
  expect(shouldStartDocent(DOCENT_QUIET_S - 1, 0, 60, 0)).toBe(false);
  expect(shouldStartDocent(DOCENT_QUIET_S, 0, 60, 0)).toBe(true);
  expect(shouldStartDocent(DOCENT_QUIET_S, 0, 0.5, 0)).toBe(false); // nowhere to go
});

test("the tour strolls from the live view back to the oldest piece, dwells, then ends", () => {
  const tour = { fromX: 60, toX: 0, startedAt: 100 };
  const travel = 60 / DOCENT_SPEED;
  expect(docentX(tour, 100)).toBe(60);
  const mid = docentX(tour, 100 + travel / 2)!;
  expect(mid).toBeLessThan(60);
  expect(mid).toBeGreaterThan(0);
  expect(docentX(tour, 100 + travel)).toBeCloseTo(0);
  expect(docentX(tour, 100 + travel + DOCENT_DWELL_S - 0.1)).toBeCloseTo(0); // lingers
  expect(docentX(tour, 100 + travel + DOCENT_DWELL_S)).toBeNull(); // hands back
});

test("the stroll never moves away from its destination", () => {
  const tour = { fromX: 30, toX: 0, startedAt: 0 };
  let prev = Infinity;
  for (let t = 0; t < 80; t += 0.5) {
    const x = docentX(tour, t);
    if (x === null) break;
    expect(x).toBeLessThanOrEqual(prev);
    prev = x;
  }
});
