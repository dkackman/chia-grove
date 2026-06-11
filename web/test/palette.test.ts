import { expect, test } from "vitest";
import { catColor } from "../src/themes/shared/cat-color.js";
import { mojosToXch } from "../src/ui/format.js";

test("catColor is deterministic and palette-matched", () => {
  const assetId = "a1b2c3d4" + "00".repeat(28);
  const color = catColor(assetId);
  expect(color).toEqual(catColor(assetId));
  expect(color.h).toBeGreaterThanOrEqual(0);
  expect(color.h).toBeLessThan(1);
  expect(color.s).toBeGreaterThan(0);
  expect(color.l).toBeGreaterThan(0);
  // different assets get different colors
  expect(catColor(assetId).h).not.toBe(catColor("ffeeddcc" + "00".repeat(28)).h);
});

test("mojosToXch formats correctly", () => {
  expect(mojosToXch("1000000000000")).toBe("1");
  expect(mojosToXch("1500000000000")).toBe("1.5");
  expect(mojosToXch("1")).toBe("0.000000000001");
  expect(mojosToXch("123450000000000")).toBe("123.45");
  expect(mojosToXch("0")).toBe("0");
});
