import { expect, test } from "vitest";
import {
  WHITELIST,
  WHITELIST_SET,
  buildWhitelistSet,
  isWhitelisted,
  type WhitelistEntry,
} from "../src/content-filter/signals/whitelist.js";

test("WHITELIST ships empty and well-formed", () => {
  expect(Array.isArray(WHITELIST)).toBe(true);
  expect(WHITELIST.length).toBe(0);
  expect(WHITELIST_SET.size).toBe(0);
});

test("buildWhitelistSet indexes composite (creatorDid, collectionId) keys", () => {
  const entries: WhitelistEntry[] = [
    { creatorDid: "did:chia:aaa", collectionId: "col1aaa" },
    { creatorDid: "did:chia:bbb", collectionId: "col1bbb", note: "official mint" },
  ];
  const set = buildWhitelistSet(entries);
  expect(isWhitelisted(set, "did:chia:aaa", "col1aaa")).toBe(true);
  expect(isWhitelisted(set, "did:chia:bbb", "col1bbb")).toBe(true);
});

test("isWhitelisted requires both fields to match together (composite key)", () => {
  const set = buildWhitelistSet([{ creatorDid: "did:chia:aaa", collectionId: "col1aaa" }]);
  expect(isWhitelisted(set, "did:chia:aaa", "col1bbb")).toBe(false); // right DID, wrong collection
  expect(isWhitelisted(set, "did:chia:zzz", "col1aaa")).toBe(false); // right collection, wrong DID
});

test("isWhitelisted returns false when either field is missing", () => {
  const set = buildWhitelistSet([{ creatorDid: "did:chia:aaa", collectionId: "col1aaa" }]);
  expect(isWhitelisted(set, undefined, "col1aaa")).toBe(false);
  expect(isWhitelisted(set, "did:chia:aaa", undefined)).toBe(false);
  expect(isWhitelisted(set, undefined, undefined)).toBe(false);
});
