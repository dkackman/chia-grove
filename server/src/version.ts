import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface VersionInfo {
  appVersion: string;
  gitSha: string;
  builtAt: string;
}

// version.json is written at deploy time (deploy.sh / release.yml) at the repo
// root; it is git-ignored and absent in local dev, where we report "dev".
const DEFAULT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../version.json"
);

export function readVersion(file: string = DEFAULT_PATH): VersionInfo {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<VersionInfo>;
    return {
      appVersion: parsed.appVersion ?? "dev",
      gitSha: parsed.gitSha ?? "",
      builtAt: parsed.builtAt ?? "",
    };
  } catch {
    return { appVersion: "dev", gitSha: "", builtAt: "" };
  }
}
