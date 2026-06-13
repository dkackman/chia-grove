import { expect, test } from "vitest";
import { mediaKind } from "../src/ui/media.js";

test("classifies video extensions", () => {
  expect(mediaKind("https://x.test/a.mp4")).toBe("video");
  expect(mediaKind("https://x.test/a.webm")).toBe("video");
  expect(mediaKind("https://x.test/a.MOV")).toBe("video");
});

test("classifies audio extensions", () => {
  expect(mediaKind("https://x.test/a.mp3")).toBe("audio");
  expect(mediaKind("https://x.test/a.flac")).toBe("audio");
});

test("defaults to image for image extensions and unknown/none", () => {
  expect(mediaKind("https://x.test/a.png")).toBe("image");
  expect(mediaKind("https://x.test/a.jpg")).toBe("image");
  expect(mediaKind("https://x.test/a")).toBe("image");
});

test("ignores query strings and fragments when reading the extension", () => {
  expect(mediaKind("https://x.test/a.mp4?token=1")).toBe("video");
  expect(mediaKind("https://x.test/a.png#frag")).toBe("image");
});
