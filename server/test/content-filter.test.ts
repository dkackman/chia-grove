import { expect, test } from "vitest";
import { mapMintgarden } from "../src/classify/content-filter.js";

test("is_blocked true → blocked", () => {
  expect(mapMintgarden({ is_blocked: true })).toBe("blocked");
});

test("collection.blocked_content true → blocked", () => {
  expect(mapMintgarden({ collection: { blocked_content: true } })).toBe("blocked");
});

test("creator.verification_state 2 → blocked", () => {
  expect(mapMintgarden({ creator: { verification_state: 2 } })).toBe("blocked");
});

test("collection.sensitive_content true → sensitive", () => {
  expect(mapMintgarden({ collection: { sensitive_content: true } })).toBe("sensitive");
});

test("metadata_json.sensitive_content boolean true → sensitive", () => {
  expect(mapMintgarden({ data: { metadata_json: { sensitive_content: true } } })).toBe("sensitive");
});

test('metadata_json.sensitive_content string "true" → sensitive', () => {
  expect(mapMintgarden({ data: { metadata_json: { sensitive_content: "true" } } })).toBe(
    "sensitive"
  );
});

test("metadata_json.sensitive_content non-empty array → sensitive", () => {
  expect(mapMintgarden({ data: { metadata_json: { sensitive_content: ["nudity"] } } })).toBe(
    "sensitive"
  );
});

test("blocked takes precedence over sensitive", () => {
  expect(
    mapMintgarden({ is_blocked: true, collection: { sensitive_content: true } })
  ).toBe("blocked");
});

test("benign NFT → ok", () => {
  expect(
    mapMintgarden({
      is_blocked: false,
      collection: { blocked_content: false, sensitive_content: false },
      creator: { verification_state: 1 },
      data: { metadata_json: { sensitive_content: false } },
    })
  ).toBe("ok");
});

test("missing fields / non-object → ok", () => {
  expect(mapMintgarden({})).toBe("ok");
  expect(mapMintgarden(null)).toBe("ok");
  expect(mapMintgarden("nope")).toBe("ok");
  expect(mapMintgarden({ collection: null, data: null, creator: null })).toBe("ok");
});
