import { expect, test } from "vitest";
import type { SproutEvent } from "@grove/shared";
import { resolveMedia, mediaSrc } from "../src/ui/media.js";

const nft = (over: Partial<SproutEvent> = {}): SproutEvent => ({
  type: "sprout",
  kind: "nft",
  height: 1,
  coinId: "ab".repeat(32),
  amount: "1",
  launcherId: "cd".repeat(32),
  mediaKind: "image",
  ...over,
});

test("blocked → placeholder and no src", () => {
  const e = nft({ mediaFilter: "blocked" });
  expect(resolveMedia(e)).toEqual({ render: "placeholder" });
  expect(mediaSrc(e)).toBeNull();
});

test("sensitive → blur with proxied src", () => {
  const e = nft({ mediaFilter: "sensitive" });
  expect(resolveMedia(e)).toEqual({
    render: "blur",
    src: `/img?nft=${"cd".repeat(32)}`,
    kind: "image",
  });
});

test("normal NFT with art → art", () => {
  const e = nft();
  expect(resolveMedia(e)).toEqual({
    render: "art",
    src: `/img?nft=${"cd".repeat(32)}`,
    kind: "image",
  });
});

test("no usable media → none", () => {
  expect(resolveMedia(nft({ mediaKind: undefined, launcherId: undefined }))).toEqual({
    render: "none",
  });
});

test("demo dataUri is honored, but blocked still wins", () => {
  expect(resolveMedia(nft({ dataUri: "data:image/png;base64,AAAA" }))).toMatchObject({
    render: "art",
    src: "data:image/png;base64,AAAA",
  });
  expect(
    resolveMedia(nft({ dataUri: "data:image/png;base64,AAAA", mediaFilter: "blocked" }))
  ).toEqual({ render: "placeholder" });
});
