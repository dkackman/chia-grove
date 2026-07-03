import { expect, test } from "vitest";
import { readBlockParam } from "../src/themes/board/url-state.js";

test("reads a valid block height from the query string", () => {
  expect(readBlockParam("?theme=board&block=1234567")).toBe(1234567);
});

test("returns null when block is absent", () => {
  expect(readBlockParam("?theme=board")).toBeNull();
  expect(readBlockParam("")).toBeNull();
});

test("returns null for a non-integer or negative value", () => {
  expect(readBlockParam("?block=abc")).toBeNull();
  expect(readBlockParam("?block=-5")).toBeNull();
  expect(readBlockParam("?block=1.5")).toBeNull();
});

test("block=0 is a valid height", () => {
  expect(readBlockParam("?block=0")).toBe(0);
});

test("returns null for a value beyond Number.MAX_SAFE_INTEGER", () => {
  expect(readBlockParam("?block=99999999999999999999")).toBeNull();
});
