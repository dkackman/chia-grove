import { expect, test } from "vitest";
import { catHue } from "../src/scene/palette.js";
import { mojosToXch } from "../src/ui/format.js";

test("catHue is deterministic and in range", () => {
  const assetId = "a1b2c3d4" + "00".repeat(28);
  expect(catHue(assetId)).toBe(catHue(assetId));
  expect(catHue(assetId)).toBeGreaterThanOrEqual(0);
  expect(catHue(assetId)).toBeLessThan(360);
  expect(catHue(assetId)).not.toBe(catHue("ffeeddcc" + "00".repeat(28)));
});

test("mojosToXch formats correctly", () => {
  expect(mojosToXch("1000000000000")).toBe("1");
  expect(mojosToXch("1500000000000")).toBe("1.5");
  expect(mojosToXch("1")).toBe("0.000000000001");
  expect(mojosToXch("123450000000000")).toBe("123.45");
  expect(mojosToXch("0")).toBe("0");
});
