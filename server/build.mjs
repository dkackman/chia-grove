// Transpile server/src/**/*.ts -> server/dist, one file per module (no
// bundling). Keeping the directory layout means the two import.meta.url path
// lookups (version.ts -> ../../version.json, web/server.ts -> ../../../web/dist)
// resolve identically from dist/ as from src/. @grove/shared stays an external
// import; Node >= 24 strips its types natively at load time.
import { build } from "esbuild";
import { globSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const entryPoints = globSync("src/**/*.ts", { cwd: here }).map((f) => path.join(here, f));

await build({
  entryPoints,
  outdir: path.join(here, "dist"),
  outbase: path.join(here, "src"),
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: true,
  logLevel: "info",
});
