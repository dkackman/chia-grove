import { expect, test } from "vitest";
import type { SproutEvent } from "@grove/shared";
import { escalateMediaKind, mediaSrc } from "../src/ui/media.js";

const base: SproutEvent = {
  type: "sprout",
  kind: "nft",
  height: 1,
  coinId: "ab12",
  amount: "0",
  launcherId: "lnch01",
};

test("addresses live art by launcher id through the proxy", () => {
  expect(mediaSrc({ ...base, mediaKind: "image" })).toBe("/img?nft=lnch01");
});

test("passes inline data URIs through unchanged (demo)", () => {
  const data = "data:image/svg+xml,%3Csvg%3E%3C/svg%3E";
  expect(mediaSrc({ ...base, dataUri: data, mediaKind: "image" })).toBe(data);
});

test("returns null when there is no art", () => {
  expect(mediaSrc(base)).toBeNull();
});

// When a mediaKind hint is wrong (e.g. an extensionless IPFS video guessed as
// "image"), the render paths retry the next element type on load failure.

test("escalateMediaKind walks image → video → audio", () => {
  expect(escalateMediaKind("image")).toBe("video");
  expect(escalateMediaKind("video")).toBe("audio");
});

test("escalateMediaKind returns null once the chain is exhausted", () => {
  expect(escalateMediaKind("audio")).toBeNull();
});
