import { describe, expect, test } from "vitest";
import {
  BLOCKS_PER_TURN,
  HELIX_RADIUS,
  PITCH,
  blockPosition,
  cardPosition,
  coinColor,
  coinSize,
  crystalScale,
  feeHeat,
  helixAngle,
  includedMotes,
  mempoolParticles,
  orbitFor,
  orbitPoint,
  reachAt,
  scaleAt,
  starFraction,
} from "../src/themes/timelord/layout.js";
import { mulberry32 } from "../src/themes/shared/util.js";

describe("helix", () => {
  test("blocks sit on the helix radius and rise by PITCH", () => {
    for (const seq of [0, 1, 7, 123, 99_999]) {
      const p = blockPosition(seq);
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(HELIX_RADIUS, 6);
      expect(p.y).toBeCloseTo(seq * PITCH, 6);
    }
  });

  test("one full turn returns to the same angle", () => {
    const a = blockPosition(3);
    const b = blockPosition(3 + BLOCKS_PER_TURN);
    expect(b.x).toBeCloseTo(a.x, 6);
    expect(b.z).toBeCloseTo(a.z, 6);
  });

  test("helixAngle stays in [0, 2π) even for huge sequence numbers", () => {
    for (const seq of [0, 1, 1e6, 123_456_789, -3]) {
      const a = helixAngle(seq);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(Math.PI * 2);
    }
  });

  test("NFT cards float outside the helix, near their block's height", () => {
    for (let k = 0; k < 15; k++) {
      const c = cardPosition(40, k);
      expect(Math.hypot(c.x, c.z)).toBeGreaterThan(HELIX_RADIUS + 4);
      expect(Math.abs(c.y - 40 * PITCH)).toBeLessThan(3);
    }
  });
});

describe("orbits", () => {
  test("orbit radius grows with spend index and speed is Keplerian", () => {
    const inner = orbitFor(0, () => 0.5);
    const outer = orbitFor(300, () => 0.5);
    expect(outer.radius).toBeGreaterThan(inner.radius);
    expect(outer.speed).toBeLessThan(inner.speed);
    expect(inner.speed * inner.radius ** 1.5).toBeCloseTo(outer.speed * outer.radius ** 1.5, 6);
  });

  test("orbitPoint stays on the orbit sphere once fully out", () => {
    const center = { x: 5, y: 10, z: -3 };
    const o = orbitFor(12, mulberry32(42));
    for (const t of [0, 1.3, 50]) {
      const p = orbitPoint(center, o, t, 1);
      const d = Math.hypot(p.x - center.x, p.y - center.y, p.z - center.z);
      expect(d).toBeCloseTo(Math.hypot(o.radius, o.yOff), 6);
    }
  });

  test("orbitPoint at reach 0 is the crystal itself", () => {
    const center = { x: 1, y: 2, z: 3 };
    const p = orbitPoint(center, orbitFor(5, mulberry32(7)), 9, 0);
    expect(p).toEqual({ x: 1, y: 2, z: 3 });
  });

  test("reach erupts to 1 and implodes back to 0", () => {
    expect(reachAt(10, 10, 0)).toBe(0);
    expect(reachAt(20, 10, 0)).toBe(1);
    expect(reachAt(30, 10, 25)).toBe(0);
    expect(scaleAt(9, 10, 0)).toBe(0);
    expect(scaleAt(20, 10, 0)).toBeCloseTo(1, 6);
    expect(scaleAt(30, 10, 25)).toBe(0);
  });
});

describe("scales", () => {
  test("coins grow with amount and stay bounded", () => {
    expect(coinSize("1000")).toBeLessThan(coinSize("1000000000000"));
    expect(coinSize("100000000000000000")).toBeLessThanOrEqual(0.8);
    expect(coinSize("garbage")).toBeGreaterThan(0);
  });

  test("coin metal runs silver → green → gold", () => {
    const [dustR, , dustB] = coinColor("1000");
    const [, greenG] = coinColor("1000000000000");
    const [goldR, , goldB] = coinColor("100000000000000");
    expect(dustB).toBeGreaterThan(0.7); // pale silver
    expect(greenG).toBeGreaterThan(0.7);
    expect(goldR).toBeGreaterThan(goldB); // warm
    expect(goldR).toBeGreaterThan(dustR);
  });

  test("crystal scale grows with spends, bounded", () => {
    expect(crystalScale(0)).toBeLessThan(crystalScale(50));
    expect(crystalScale(1e9)).toBeLessThanOrEqual(1.35);
  });

  test("fee heat is 0 for feeless blocks and saturates at 1", () => {
    expect(feeHeat("0")).toBe(0);
    expect(feeHeat("nope")).toBe(0);
    expect(feeHeat("1000000000000000")).toBe(1);
    const mid = feeHeat("100000000");
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  test("mempool particles scale sublinearly and respect the cap", () => {
    expect(mempoolParticles(0, 1000)).toBe(40);
    expect(mempoolParticles(100, 1000)).toBeLessThan(mempoolParticles(400, 1000));
    expect(mempoolParticles(1e9, 1000)).toBe(1000);
  });

  test("star fraction tracks netspace with a floor", () => {
    expect(starFraction("0")).toBe(0.35);
    expect(starFraction(String(2 ** 60 * 80))).toBe(1);
  });
});

describe("includedMotes", () => {
  test("nothing included, or nothing swirling, pulls no motes", () => {
    expect(includedMotes(0, 50, 200)).toBe(0);
    expect(includedMotes(10, 50, 0)).toBe(0);
  });
  test("pulls the included share of the swirl", () => {
    expect(includedMotes(50, 50, 200)).toBe(100);
    expect(includedMotes(100, 0, 200)).toBe(200);
  });
  test("a light block still takes a few motes, but never more than it included", () => {
    expect(includedMotes(3, 997, 200)).toBe(3);
    expect(includedMotes(20, 980, 200)).toBe(8);
  });
  test("never more than are swirling", () => {
    expect(includedMotes(5, 0, 2)).toBe(2);
  });
});
