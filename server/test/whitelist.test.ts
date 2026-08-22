import { expect, test } from "vitest";
import {
  DEFAULT_WHITELIST,
  WHITELIST_SET,
  buildWhitelistSet,
  isWhitelisted,
  type WhitelistEntry,
} from "../src/content-filter/signals/whitelist.js";

test("DEFAULT_WHITELIST is well-formed and its entries are indexed", () => {
  expect(Array.isArray(DEFAULT_WHITELIST)).toBe(true);
  // every entry must carry at least one identifier, and each identifier lands in the set
  for (const entry of DEFAULT_WHITELIST) {
    expect(entry.creatorDid ?? entry.collectionId).toBeDefined();
    if (entry.creatorDid) expect(WHITELIST_SET.has(entry.creatorDid)).toBe(true);
    if (entry.collectionId) expect(WHITELIST_SET.has(entry.collectionId)).toBe(true);
  }
});

test("buildWhitelistSet indexes creator DIDs and collection ids independently", () => {
  const entries: WhitelistEntry[] = [
    { creatorDid: "did:chia:aaa" },
    { collectionId: "col1bbb", note: "official mint" },
    { creatorDid: "did:chia:ccc", collectionId: "col1ccc" },
  ];
  const set = buildWhitelistSet(entries);
  expect(set.has("did:chia:aaa")).toBe(true);
  expect(set.has("col1bbb")).toBe(true);
  expect(set.has("did:chia:ccc")).toBe(true);
  expect(set.has("col1ccc")).toBe(true);
});

test("isWhitelisted matches on creator DID alone (OR semantics)", () => {
  const set = buildWhitelistSet([{ creatorDid: "did:chia:aaa" }]);
  expect(isWhitelisted(set, "did:chia:aaa", "col1anything")).toBe(true);
  expect(isWhitelisted(set, "did:chia:aaa", undefined)).toBe(true);
});

test("isWhitelisted matches on collection id alone (OR semantics)", () => {
  const set = buildWhitelistSet([{ collectionId: "col1bbb" }]);
  expect(isWhitelisted(set, "did:chia:other", "col1bbb")).toBe(true);
  expect(isWhitelisted(set, undefined, "col1bbb")).toBe(true);
});

test("isWhitelisted returns false when neither identifier is on the list", () => {
  const set = buildWhitelistSet([{ creatorDid: "did:chia:aaa", collectionId: "col1aaa" }]);
  expect(isWhitelisted(set, "did:chia:zzz", "col1zzz")).toBe(false);
  expect(isWhitelisted(set, undefined, undefined)).toBe(false);
});

test("the two shipped collections are on the allow-list", () => {
  expect(
    isWhitelisted(
      WHITELIST_SET,
      undefined,
      "col1s8fwfqdl3x77h7rn40m0mzhkgp7kajdwu56me36glv0ez8w79heqst90mh"
    )
  ).toBe(true);
  expect(
    isWhitelisted(
      WHITELIST_SET,
      undefined,
      "col1apvkk4tz48l9qfj5znygzrugfhzjmfu8lykalvzeqn6au38g7mcs4gwxx6"
    )
  ).toBe(true);
});
