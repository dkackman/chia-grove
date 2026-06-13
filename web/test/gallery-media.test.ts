import { expect, test } from "vitest";
import { proxied } from "../src/themes/gallery/media.js";

test("routes remote urls through the image proxy", () => {
  const url = "https://h.test/a.jpg?x=1";
  expect(proxied(url)).toBe("/img?url=" + encodeURIComponent(url));
});

test("passes inline data URIs through unchanged", () => {
  const data = "data:image/svg+xml,%3Csvg%3E%3C/svg%3E";
  expect(proxied(data)).toBe(data);
});
