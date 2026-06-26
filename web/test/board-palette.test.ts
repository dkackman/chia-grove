import { expect, test } from "vitest";
import { BOARD } from "../src/themes/board/palette.js";

test("BOARD palette has the colors the scene needs", () => {
  for (const key of ["backdrop", "housing", "flapFace", "flapText", "live"] as const) {
    expect(typeof BOARD[key]).toBe("number");
  }
});
