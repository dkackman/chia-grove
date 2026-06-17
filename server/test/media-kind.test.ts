import { expect, test } from "vitest";
import { mediaKind } from "@grove/shared";

test("classifies video, audio, and defaults to image", () => {
  expect(mediaKind("https://x.test/a.mp4")).toBe("video");
  expect(mediaKind("https://x.test/a.MOV")).toBe("video");
  expect(mediaKind("https://x.test/a.mp3")).toBe("audio");
  expect(mediaKind("https://x.test/a.flac")).toBe("audio");
  expect(mediaKind("https://x.test/a.png")).toBe("image");
  expect(mediaKind("https://x.test/a")).toBe("image");
});

test("ignores query strings and fragments", () => {
  expect(mediaKind("https://x.test/a.mp4?token=1")).toBe("video");
  expect(mediaKind("https://x.test/a.png#frag")).toBe("image");
});
