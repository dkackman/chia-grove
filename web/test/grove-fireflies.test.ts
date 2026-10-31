import { describe, expect, test } from "vitest";
import {
  DIVE_SECONDS,
  FlySwarm,
  MAX_DIVERS,
  MIN_VISIBLE,
  diveEnvelope,
  diversFor,
  visibleForMempool,
} from "../src/themes/grove/fireflies.js";

/** Deterministic PRNG for repeatable swarms. */
function lcg(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe("orbit angle", () => {
  test("accumulates speed × agitation × dt instead of jumping with agitation", () => {
    const swarm = new FlySwarm(4, lcg());
    swarm.setVisible(4);
    const fly = swarm.flies[0];
    const start = fly.angle;
    swarm.update(1, 0.5);
    expect(fly.angle).toBeCloseTo(start + fly.speed * 1 * 0.5);
    // a big agitation change only changes the rate from here on
    swarm.agitation = 3;
    const before = fly.angle;
    swarm.update(1.016, 0.016);
    expect(fly.angle - before).toBeCloseTo(fly.speed * 3 * 0.016);
  });

  test("positions stay continuous across an agitation change", () => {
    const swarm = new FlySwarm(1, lcg(7));
    swarm.setVisible(1);
    swarm.update(100, 1 / 60);
    const x0 = swarm.positions[0];
    swarm.agitation = 3;
    swarm.update(100 + 1 / 60, 1 / 60);
    // old formula (phase + t·speed·agitation) would leap ~200 rad here
    expect(Math.abs(swarm.positions[0] - x0)).toBeLessThan(0.5);
  });

  test("reduced motion slows the orbit", () => {
    const swarm = new FlySwarm(1, lcg());
    swarm.setVisible(1);
    swarm.motion = 0.3;
    const a = swarm.flies[0].angle;
    swarm.update(1, 1);
    expect(swarm.flies[0].angle - a).toBeCloseTo(swarm.flies[0].speed * 0.3);
  });
});

describe("dive envelope", () => {
  test("is zero at both ends, holds at 1 mid-dive, and is symmetric", () => {
    expect(diveEnvelope(0)).toBe(0);
    expect(diveEnvelope(1)).toBe(0);
    expect(diveEnvelope(0.5)).toBe(1);
    for (const p of [0.05, 0.2, 0.33, 0.7, 0.9]) {
      expect(diveEnvelope(p)).toBeCloseTo(diveEnvelope(1 - p));
    }
  });

  test("eases back out (no snap at the end of a dive)", () => {
    expect(diveEnvelope(0.99)).toBeLessThan(0.01);
    expect(diveEnvelope(0.9)).toBeLessThan(diveEnvelope(0.8));
  });

  test("a diving fly returns to its orbit position when the dive ends", () => {
    const swarm = new FlySwarm(1, lcg(3));
    swarm.setVisible(1);
    swarm.diveTo({ x: 30, z: 30 }, 0, 1, lcg(4));
    const dt = 1 / 60;
    let maxJump = 0;
    let prevX = NaN;
    for (let t = 0; t <= DIVE_SECONDS + 0.5; t += dt) {
      swarm.update(t, dt);
      const x = swarm.positions[0];
      if (!Number.isNaN(prevX)) maxJump = Math.max(maxJump, Math.abs(x - prevX));
      prevX = x;
    }
    expect(Number.isNaN(swarm.flies[0].diveStart)).toBe(true);
    // smooth every frame — no teleport back to the orbit
    expect(maxJump).toBeLessThan(1);
  });
});

describe("diveTo", () => {
  test("only picks visible flies, without repeats", () => {
    const swarm = new FlySwarm(100, lcg());
    swarm.setVisible(10);
    const sent = swarm.diveTo({ x: 0, z: 0 }, 5, 50, lcg(2));
    expect(sent).toBe(10);
    swarm.flies.forEach((fly, i) => {
      expect(Number.isNaN(fly.diveStart)).toBe(i >= 10);
    });
  });

  test("diversFor caps by inclusions, MAX_DIVERS and the visible swarm", () => {
    expect(diversFor(7, 100)).toBe(7);
    expect(diversFor(10_000, 400)).toBe(MAX_DIVERS);
    expect(diversFor(10_000, 30)).toBe(30);
    expect(diversFor(undefined, 400)).toBe(50);
    expect(diversFor(0, 400)).toBe(0);
  });

  test("visibleForMempool clamps to [MIN_VISIBLE, max]", () => {
    expect(visibleForMempool(0, 400)).toBe(MIN_VISIBLE);
    expect(visibleForMempool(50, 400)).toBe(MIN_VISIBLE + 50);
    expect(visibleForMempool(10_000, 400)).toBe(400);
  });
});

describe("visible count", () => {
  test("fades flies in and out instead of popping", () => {
    const swarm = new FlySwarm(100, lcg());
    swarm.setVisible(80);
    swarm.update(0, 0.1);
    // newly visible flies start dim and brighten over time
    expect(swarm.brightness[70]).toBeGreaterThan(0);
    expect(swarm.brightness[70]).toBeLessThan(0.2);
    for (let i = 0; i < 30; i++) swarm.update(0, 0.1);
    expect(swarm.brightness[70]).toBe(1);
    expect(swarm.drawCount).toBe(80);

    swarm.setVisible(20);
    swarm.update(0, 0.1);
    expect(swarm.brightness[70]).toBeGreaterThan(0.8);
    expect(swarm.drawCount).toBe(80); // still drawn while fading out
    for (let i = 0; i < 30; i++) swarm.update(0, 0.1);
    expect(swarm.brightness[70]).toBe(0);
    expect(swarm.drawCount).toBe(20);
  });
});

test("scatter mirrors an incoming dive into its out-phase at the same pull", () => {
  const swarm = new FlySwarm(1, lcg());
  swarm.setVisible(1);
  swarm.diveTo({ x: 10, z: 10 }, 0, 1, lcg(9));
  const t = DIVE_SECONDS * 0.2;
  const pullBefore = diveEnvelope(0.2);
  swarm.scatter(t);
  const p = (t - swarm.flies[0].diveStart) / DIVE_SECONDS;
  expect(p).toBeCloseTo(0.8);
  expect(diveEnvelope(p)).toBeCloseTo(pullBefore);
});
