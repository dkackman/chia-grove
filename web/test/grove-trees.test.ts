import { describe, expect, it } from "vitest";
import { TREELINE_INNER, TREELINE_OUTER, treeSpecs } from "../src/themes/grove/trees.js";

describe("grove treeline", () => {
  it("is deterministic", () => {
    expect(treeSpecs()).toEqual(treeSpecs());
  });

  it("keeps every tree in the ring between the block spiral and the disc edge", () => {
    for (const tree of treeSpecs()) {
      const r = Math.hypot(tree.x, tree.z);
      expect(r).toBeGreaterThanOrEqual(TREELINE_INNER - 1e-6);
      expect(r).toBeLessThanOrEqual(TREELINE_OUTER + 1e-6);
      expect(tree.height).toBeGreaterThan(5);
    }
  });

  it("leaves no angular gap wide enough to show the bare disc edge", () => {
    const angles = treeSpecs()
      .map((t) => Math.atan2(t.z, t.x))
      .sort((a, b) => a - b);
    let widest = angles[0] + Math.PI * 2 - angles[angles.length - 1];
    for (let i = 1; i < angles.length; i++) widest = Math.max(widest, angles[i] - angles[i - 1]);
    expect(widest).toBeLessThan((Math.PI * 2 * 2) / angles.length);
  });
});
