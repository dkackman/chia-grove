import { expect, test } from "vitest";
import {
  DENYLIST,
  DENYLIST_MAP,
  buildDenylistMap,
  dispositionForCollection,
  type DenylistEntry,
} from "../src/content-filter/signals/denylist.js";

test("DENYLIST ships empty and well-formed", () => {
  expect(Array.isArray(DENYLIST)).toBe(true);
  expect(DENYLIST.length).toBe(0);
  expect(DENYLIST_MAP.size).toBe(0);
});

test("buildDenylistMap maps collectionId → disposition", () => {
  const entries: DenylistEntry[] = [
    { collectionId: "col_blocked", disposition: "blocked" },
    { collectionId: "col_sensitive", disposition: "sensitive", note: "nsfw art" },
  ];
  const map = buildDenylistMap(entries);
  expect(map.get("col_blocked")).toBe("blocked");
  expect(map.get("col_sensitive")).toBe("sensitive");
});

test("dispositionForCollection returns undefined for unknown / missing id", () => {
  const map = buildDenylistMap([{ collectionId: "col1", disposition: "blocked" }]);
  expect(dispositionForCollection(map, "col1")).toBe("blocked");
  expect(dispositionForCollection(map, "nope")).toBeUndefined();
  expect(dispositionForCollection(map, undefined)).toBeUndefined();
});
