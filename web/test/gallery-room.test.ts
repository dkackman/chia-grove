import { describe, expect, it } from "vitest";
import type { SproutEvent } from "@grove/shared";
import {
  BENCH_FIRST_X,
  BENCH_STEP,
  CORNER_X,
  benchXs,
  firstCanColumn,
} from "../src/themes/gallery/room.js";
import { hangTag } from "../src/themes/gallery/select.js";

describe("gallery room furniture", () => {
  it("lays the benches nearest the camera, evenly spaced", () => {
    const xs = benchXs(BENCH_FIRST_X + BENCH_STEP * 5 + 1);
    expect(xs).toEqual([4, 5, 6].map((k) => BENCH_FIRST_X + k * BENCH_STEP));
  });

  it("never puts a bench left of the first one (or into the corner)", () => {
    for (const cameraX of [-50, -5, 0, 3]) {
      const xs = benchXs(cameraX);
      expect(xs[0]).toBe(BENCH_FIRST_X);
      expect(Math.min(...xs)).toBeGreaterThan(CORNER_X);
    }
  });

  it("keeps the same benches while the camera stays within one bay", () => {
    expect(benchXs(100)).toEqual(benchXs(101));
  });

  it("centres the ceiling spots on the camera and never starts before column 0", () => {
    expect(firstCanColumn(-20, 24)).toBe(0);
    expect(firstCanColumn(0, 24)).toBe(0);
    expect(firstCanColumn(300, 24)).toBe(100 - 12);
  });
});

describe("hangTag", () => {
  const nft = (mint?: boolean): SproutEvent => ({
    type: "sprout",
    kind: "nft",
    height: 1,
    coinId: "ab".repeat(32),
    amount: "1",
    mint,
  });

  it("labels permanent-collection pieces as such, whatever the spend was", () => {
    expect(hangTag(nft(true), true)).toBe("collection");
    expect(hangTag(nft(false), true)).toBe("collection");
  });

  it("keeps acquisition / sold for live pieces", () => {
    expect(hangTag(nft(true))).toBe("acquisition");
    expect(hangTag(nft())).toBe("sold");
  });
});
