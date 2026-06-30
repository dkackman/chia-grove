import { expect, test } from "vitest";
import { strongest, combine } from "../src/content-filter/verdict.js";

test("strongest picks blocked over sensitive over ok", () => {
  expect(strongest("ok", "sensitive", "blocked")).toBe("blocked");
  expect(strongest("ok", "sensitive")).toBe("sensitive");
  expect(strongest("ok", "ok")).toBe("ok");
  expect(strongest()).toBe("ok");
});

test("combine returns the strongest disposition", () => {
  const v = combine([
    { disposition: "ok" },
    { disposition: "sensitive" },
    { disposition: "blocked" },
  ]);
  expect(v.disposition).toBe("blocked");
});
