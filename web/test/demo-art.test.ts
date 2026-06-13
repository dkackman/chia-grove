import { expect, test } from "vitest";
import { demoNftImage } from "../src/net/demo-art.js";

test("returns a deterministic inline SVG data URI", () => {
  const a = demoNftImage("nft1abc");
  expect(a.startsWith("data:image/svg+xml,")).toBe(true);
  expect(demoNftImage("nft1abc")).toBe(a);
});

test("different seeds yield different art", () => {
  expect(demoNftImage("nft1abc")).not.toBe(demoNftImage("nft1xyz"));
});
