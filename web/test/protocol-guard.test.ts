import { expect, test } from "vitest";
import { protocolAction } from "../src/net/protocol-guard.js";

test("matching versions clear the reload guard", () => {
  expect(protocolAction(1, 1, false)).toBe("clear");
  expect(protocolAction(1, 1, true)).toBe("clear");
});

test("mismatch triggers a reload when not yet reloaded", () => {
  expect(protocolAction(2, 1, false)).toBe("reload");
});

test("mismatch does nothing if already reloaded (no loop)", () => {
  expect(protocolAction(2, 1, true)).toBe("none");
});
