import { expect, test } from "vitest";
import {
  IMPLODE_SECONDS,
  deathTime,
  orbitFor,
  orbitPoint,
  orbitPointInto,
  reachAt,
  scaleAt,
  smoothstep,
} from "../src/themes/timelord/layout.js";
import { readHeightParam, withHeightParam } from "../src/themes/timelord/deep-link.js";
import { blockSummaryText } from "../src/themes/timelord/hud.js";
import { mulberry32 } from "../src/themes/shared/util.js";

test("a death stamp is always positive, so it never reads as 'alive'", () => {
  // an instant kill early in the session backdates past zero
  expect(deathTime(0.5 - IMPLODE_SECONDS - 1)).toBeGreaterThan(0);
  expect(deathTime(0)).toBeGreaterThan(0);
  expect(deathTime(-5)).toBeGreaterThan(0);
  expect(deathTime(12)).toBe(12);
});

test("a body killed at t ≈ 0 still implodes", () => {
  const dieAt = deathTime(0.2 - IMPLODE_SECONDS - 1);
  expect(reachAt(0.2 + IMPLODE_SECONDS + 0.1, 0, dieAt)).toBe(0);
  expect(scaleAt(0.2 + IMPLODE_SECONDS + 0.1, 0, dieAt)).toBe(0);
});

test("orbitPointInto matches orbitPoint and reuses its output", () => {
  const o = orbitFor(17, mulberry32(42));
  const center = { x: 3, y: 9, z: -2 };
  const out = { x: 0, y: 0, z: 0 };
  const r = orbitPointInto(out, center, o, 12.5, 0.8);
  expect(r).toBe(out);
  expect(out).toEqual(orbitPoint(center, o, 12.5, 0.8));
});

test("the widest drawn orbit fits the raycast prefilter sphere (5.5)", () => {
  const rand = mulberry32(7);
  for (let j = 0; j < 320; j++) {
    const o = orbitFor(j, rand);
    // halos sit 0.4 further out; pick sphere ≤ 0.8 · 0.75
    const p = orbitPoint({ x: 0, y: 0, z: 0 }, { ...o, radius: o.radius + 0.4 }, j, 1);
    expect(Math.hypot(p.x, p.y, p.z) + 0.6).toBeLessThan(5.5);
  }
});

test("smoothstep", () => {
  expect(smoothstep(0, 1, -1)).toBe(0);
  expect(smoothstep(0, 1, 0.5)).toBe(0.5);
  expect(smoothstep(0, 1, 2)).toBe(1);
});

test("height deep-link param", () => {
  expect(readHeightParam("?height=123")).toBe(123);
  expect(readHeightParam("?theme=timelord")).toBeNull();
  expect(readHeightParam("?height=")).toBeNull();
  expect(readHeightParam("?height=-4")).toBeNull();
  expect(readHeightParam("?height=1.5")).toBeNull();
  const href = withHeightParam("https://x.test/?theme=timelord", 77);
  expect(new URL(href).searchParams.get("height")).toBe("77");
  expect(new URL(href).searchParams.get("theme")).toBe("timelord");
  expect(new URL(withHeightParam(href, null)).searchParams.has("height")).toBe(false);
});

test("block summary", () => {
  const base = {
    height: 5000000,
    spendCount: 412,
    fees: "1500000000",
    timestamp: 1000,
    skipped: 0,
  };
  const text = blockSummaryText(base, 1000 + 180);
  expect(text).toContain("412 spends");
  expect(text).toContain("0.0015 XCH fees");
  expect(text).toContain("3 min ago");
  expect(text).not.toContain("not drawn");
  expect(blockSummaryText({ ...base, skipped: 92 }, 1000)).toContain("+92 not drawn");
  expect(blockSummaryText({ ...base, spendCount: 1 }, 1000)).toContain("1 spend ·");
});
