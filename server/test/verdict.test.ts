import { expect, test } from "vitest";
import { strongest, combine } from "../src/content-filter/verdict.js";

test("strongest picks blocked over sensitive over ok", () => {
  expect(strongest("ok", "sensitive", "blocked")).toBe("blocked");
  expect(strongest("ok", "sensitive")).toBe("sensitive");
  expect(strongest("ok", "ok")).toBe("ok");
  expect(strongest()).toBe("ok");
});

test("combine reports disposition and only the signals that fired", () => {
  const v = combine([
    { disposition: "ok", signal: "chip7" },
    { disposition: "sensitive", signal: "lexicon" },
    { disposition: "blocked", signal: "denylist" },
  ]);
  expect(v.disposition).toBe("blocked");
  expect(v.signals).toEqual(["lexicon", "denylist"]);
});
