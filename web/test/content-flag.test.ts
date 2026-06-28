import { expect, test } from "vitest";
import { contentFlagTarget } from "../src/themes/shared/content-flag.js";
import type { ContentFlagEvent } from "@grove/shared";

test("contentFlagTarget returns the launcher for a sensitive flag", () => {
  const e: ContentFlagEvent = { type: "content-flag", launcherId: "L9", mediaFilter: "sensitive", signals: ["safesearch"] };
  expect(contentFlagTarget(e)).toBe("L9");
});

test("contentFlagTarget ignores a non-content-flag event", () => {
  expect(contentFlagTarget({ type: "block", height: 1, headerHash: "h", timestamp: 0, spendCount: 0, fees: "0" })).toBeNull();
});
