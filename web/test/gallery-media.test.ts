import { expect, test } from "vitest";
import type { SproutEvent } from "@grove/shared";
import { mediaSrc } from "../src/ui/media.js";

const base: SproutEvent = { type: "sprout", kind: "nft", height: 1, coinId: "ab12", amount: "0" };

test("addresses live art by coin id through the proxy", () => {
  expect(mediaSrc({ ...base, mediaKind: "image" })).toBe("/img?coin=ab12");
});

test("passes inline data URIs through unchanged (demo)", () => {
  const data = "data:image/svg+xml,%3Csvg%3E%3C/svg%3E";
  expect(mediaSrc({ ...base, imageUrl: data, mediaKind: "image" })).toBe(data);
});

test("returns null when there is no art", () => {
  expect(mediaSrc(base)).toBeNull();
});
