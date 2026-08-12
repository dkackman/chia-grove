import { expect, test } from "vitest";
import { stripText } from "../src/themes/lake/strip.js";

test("the strip shows both gauges on one line", () => {
  expect(stripText(2500, String(1024 ** 6 * 25))).toBe(
    "MEMPOOL ▮▮▮▮▮····· 2500   NETSPACE 25.0 EIB"
  );
});

test("an empty mempool and unknown netspace still render", () => {
  expect(stripText(0, "0")).toBe("MEMPOOL ·········· 0   NETSPACE 0.0 B");
  expect(stripText(NaN, "")).toBe("MEMPOOL ·········· —   NETSPACE 0.0 B");
});
