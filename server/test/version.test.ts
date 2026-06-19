import { expect, test } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readVersion } from "../src/version.js";

test("falls back to dev when version.json is absent", () => {
  const missing = path.join(tmpdir(), "grove-absent-version.json");
  expect(readVersion(missing)).toEqual({ appVersion: "dev", gitSha: "", builtAt: "" });
});

test("reads appVersion, gitSha, builtAt from a present version.json", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "grove-ver-"));
  const file = path.join(dir, "version.json");
  writeFileSync(
    file,
    JSON.stringify({ appVersion: "v1.2.3", gitSha: "abc123", builtAt: "2026-06-19T00:00:00Z" })
  );
  expect(readVersion(file)).toEqual({
    appVersion: "v1.2.3",
    gitSha: "abc123",
    builtAt: "2026-06-19T00:00:00Z",
  });
});
