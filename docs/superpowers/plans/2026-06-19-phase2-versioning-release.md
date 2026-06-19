# Phase 2: Versioning + Tag-Triggered Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tagging `v<semver>` builds and deploys that exact commit to the droplet automatically, and the running server reports its version at `/healthz`.

**Architecture:** The git tag is the source of truth. A `release.yml` workflow runs the CI gates, then deploys via the existing SSH/rsync model (a `deploy.sh` adapted to stamp a `version.json` and use `npm ci`). The server reads `version.json` at startup (falling back to `"dev"` locally) and reports `appVersion`/`gitSha` at `/healthz`.

**Tech Stack:** GitHub Actions, SSH/rsync deploy, systemd + `tsx`, Fastify, Node 24, npm workspaces.

## Global Constraints

- Node ≥ 24 (`node-version: 24` in workflows).
- Use `npm ci`, never `npm install`, in CI and on the droplet (`--omit=dev` on the droplet to preserve the native `chia-wallet-sdk` binary resolution).
- `node_modules` stays excluded from rsync; prod deps install on the droplet.
- Server file paths resolve via `import.meta.url`, not `process.cwd()` (cwd differs between `npm run dev -w server` and the systemd unit).
- Secrets are referenced in workflows via `env:` blocks, never interpolated inline into `run:` scripts (injection-safety; matches repo security guidance).
- This phase adds **no** client-side version code and **no** protocol changes — those are Phase 3. `/healthz` reports `{ ok, appVersion, gitSha }`; `protocolVersion` is added in Phase 3.

## Verification model

- The version module and `/healthz` are unit-testable (TDD — Task 1).
- Shell and YAML are syntax/lint-checked locally (`bash -n`, Ruby YAML parse).
- The **authoritative** end-to-end check is operator-run (Task 6): after secrets are configured, push a test tag and confirm the deploy runs and `/healthz` reports the tag. The deploy steps cannot be verified locally.

## Prerequisite

PR #4 (Phase 1) is merged to `main`. Start this work on a fresh branch off `main`:
```bash
git checkout main && git pull && git checkout -b feat/phase2-versioning-release
```

---

### Task 1: Server version module + `/healthz` reporting

**Files:**
- Create: `server/src/version.ts`
- Create: `server/test/version.test.ts`
- Modify: `server/src/web/server.ts` (the `/healthz` handler)
- Modify: `server/test/server.test.ts` (existing healthz assertion)
- Modify: `server/src/index.ts` (startup log)
- Modify: `.gitignore` (ignore generated `version.json`)

**Interfaces:**
- Produces: `readVersion(file?: string): VersionInfo` where `interface VersionInfo { appVersion: string; gitSha: string; builtAt: string }`. Default `file` resolves to the repo-root `version.json`; missing/invalid file returns `{ appVersion: "dev", gitSha: "", builtAt: "" }`. Consumed by `server.ts` (and by Phase 3's `hello`).

- [ ] **Step 1: Write the failing tests**

Create `server/test/version.test.ts`:
```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run server/test/version.test.ts`
Expected: FAIL — cannot resolve `../src/version.js` (module does not exist yet).

- [ ] **Step 3: Implement the version module**

Create `server/src/version.ts`:
```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run server/test/version.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 5: Wire version into `/healthz` (update its existing test first)**

In `server/test/server.test.ts`, change the assertion (line 12) from:
```ts
  expect(res.json()).toEqual({ ok: true });
```
to:
```ts
  expect(res.json()).toEqual({ ok: true, appVersion: "dev", gitSha: "" });
```

Run: `npx vitest run server/test/server.test.ts`
Expected: FAIL — handler still returns `{ ok: true }`.

- [ ] **Step 6: Update the `/healthz` handler**

In `server/src/web/server.ts`, add the import near the other imports:
```ts
import { readVersion } from "../version.js";
```
Then replace the healthz line (currently `app.get("/healthz", async () => ({ ok: true }));`) with:
```ts
  const version = readVersion();
  app.get("/healthz", async () => ({
    ok: true,
    appVersion: version.appVersion,
    gitSha: version.gitSha,
  }));
```

Run: `npx vitest run server/test/server.test.ts`
Expected: PASS.

- [ ] **Step 7: Log the version at startup**

In `server/src/index.ts`, add the import near the top:
```ts
import { readVersion } from "./version.js";
```
Replace the final startup log line (`console.log(\`chia-grove server on :${PORT}\`);`) with:
```ts
console.log(`chia-grove ${readVersion().appVersion} server on :${PORT}`);
```

- [ ] **Step 8: Ignore the generated version.json**

In `.gitignore`, add a line after `dist/`:
```
version.json
```

- [ ] **Step 9: Run the full server suite + typecheck**

Run: `npx vitest run server/ && npm run typecheck`
Expected: all pass (existing 162 + 2 new = 164 tests), typecheck clean.

- [ ] **Step 10: Commit**

```bash
git add server/src/version.ts server/test/version.test.ts server/src/web/server.ts server/test/server.test.ts server/src/index.ts .gitignore
git commit -m "feat: report deploy version at /healthz from version.json

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Stamp `version.json` and switch to `npm ci` in deploy.sh

**Files:**
- Modify: `deploy/deploy.sh`

**Interfaces:**
- Produces: `deploy/deploy.sh <user@host> [version]` — writes repo-root `version.json` (`appVersion` = the `[version]` arg, defaulting to `git describe`), builds, rsyncs, and on the droplet runs `npm ci --omit=dev` + restart. Consumed by `release.yml` (Task 3), which passes the tag as `[version]`.

- [ ] **Step 1: Replace deploy.sh with the version-stamping form**

Overwrite `deploy/deploy.sh` with:
```bash
#!/usr/bin/env bash
# Build locally, stamp version.json, sync to the droplet, install prod deps, restart.
# Usage: deploy/deploy.sh user@host [version]
set -euo pipefail

HOST="${1:?usage: deploy/deploy.sh user@host [version]}"
VERSION="${2:-$(git describe --tags --always --dirty)}"
TARGET=/opt/chia-grove

printf '{"appVersion":"%s","gitSha":"%s","builtAt":"%s"}\n' \
  "$VERSION" "$(git rev-parse HEAD)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > version.json

npm run build

rsync -az --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude .superpowers \
  ./ "$HOST:$TARGET/"

ssh "$HOST" "cd $TARGET && npm ci --omit=dev && sudo systemctl restart chia-grove"
echo "deployed $VERSION to $HOST"
```

- [ ] **Step 2: Syntax-check the script**

Run: `bash -n deploy/deploy.sh && echo "syntax ok"`
Expected: prints `syntax ok`. (If `shellcheck` is installed, `shellcheck deploy/deploy.sh` should also be clean.)

- [ ] **Step 3: Verify version.json is git-ignored (no accidental tracking)**

Run: `printf '{"appVersion":"x","gitSha":"y","builtAt":"z"}' > version.json && git status --porcelain version.json; rm version.json`
Expected: **no output** (git ignores it). If it prints `?? version.json`, the `.gitignore` entry from Task 1 Step 8 is missing — add it.

- [ ] **Step 4: Commit**

```bash
git add deploy/deploy.sh
git commit -m "build: stamp version.json and use npm ci in deploy.sh

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Tag-triggered release workflow

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: `deploy/deploy.sh` (Task 2); GitHub secrets `SSH_PRIVATE_KEY`, `SSH_KNOWN_HOSTS`, `DEPLOY_HOST` (configured in Task 5).
- Produces: a `Release` workflow that, on a `v*` tag, gates + deploys + verifies `/healthz`.

- [ ] **Step 1: Create the workflow**

Create `.github/workflows/release.yml`:
```yaml
name: Release

on:
  push:
    tags: ["v*"]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: npm

      - name: Validate tag is v<semver>
        run: |
          if [[ ! "$GITHUB_REF_NAME" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            echo "Tag $GITHUB_REF_NAME is not v<major>.<minor>.<patch>"
            exit 1
          fi

      - run: npm ci

      - run: npm run lint

      - run: npm run typecheck

      - run: npm test

      - name: Set up SSH
        env:
          SSH_PRIVATE_KEY: ${{ secrets.SSH_PRIVATE_KEY }}
          SSH_KNOWN_HOSTS: ${{ secrets.SSH_KNOWN_HOSTS }}
        run: |
          mkdir -p ~/.ssh
          printf '%s\n' "$SSH_PRIVATE_KEY" > ~/.ssh/id_ed25519
          chmod 600 ~/.ssh/id_ed25519
          printf '%s\n' "$SSH_KNOWN_HOSTS" > ~/.ssh/known_hosts
          chmod 644 ~/.ssh/known_hosts

      - name: Deploy
        env:
          DEPLOY_HOST: ${{ secrets.DEPLOY_HOST }}
        run: deploy/deploy.sh "$DEPLOY_HOST" "$GITHUB_REF_NAME"

      - name: Verify deployed version
        run: |
          sleep 10
          got="$(curl -fsS https://chia-grove.com/healthz \
            | node -e 'process.stdin.on("data", d => console.log(JSON.parse(d).appVersion))')"
          echo "healthz reports: $got (expected $GITHUB_REF_NAME)"
          [ "$got" = "$GITHUB_REF_NAME" ]
```

Notes for the implementer:
- `$GITHUB_REF_NAME` is the auto-provided env var (the tag, e.g. `v0.1.0`); using it avoids untrusted `${{ }}` interpolation in `run:`.
- Secrets are passed through `env:` blocks, not inlined into the scripts.
- The verify step fails the run if the live `/healthz` `appVersion` doesn't match the tag.

- [ ] **Step 2: Validate the YAML parses**

Run: `ruby -ryaml -e "YAML.load_file('.github/workflows/release.yml'); puts 'valid yaml'"`
Expected: prints `valid yaml`. (If `actionlint` is installed, run it too.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: tag-triggered deploy to droplet with /healthz verification

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Clear the Node 20 deprecation in ci.yml

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:** none (CI behavior unchanged; only action major versions bump).

- [ ] **Step 1: Bump the actions to v5**

In `.github/workflows/ci.yml`, change:
```yaml
      - uses: actions/checkout@v4
```
to `actions/checkout@v5`, and:
```yaml
      - uses: actions/setup-node@v4
```
to `actions/setup-node@v5`.

- [ ] **Step 2: Validate the YAML parses**

Run: `ruby -ryaml -e "YAML.load_file('.github/workflows/ci.yml'); puts 'valid yaml'"`
Expected: prints `valid yaml`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: bump checkout/setup-node to v5 (Node 20 runtime deprecation)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Document SSH deploy key + GitHub secrets setup

**Files:**
- Modify: `deploy/README.md`

**Interfaces:** none (documentation). These are **operator steps** run by a human with droplet + repo-admin access; the plan records exact commands.

- [ ] **Step 1: Append the release/secrets section to deploy/README.md**

Add the following to the end of `deploy/README.md`:
```markdown
## Automated release (tag-triggered deploy)

Pushing a tag `v<major>.<minor>.<patch>` triggers `.github/workflows/release.yml`,
which runs the CI gates and then deploys to the droplet via `deploy/deploy.sh`.
The droplet stays on the manual SSH/rsync model; CI just runs the same script.

### One-time setup (operator, requires droplet + repo admin)

1. **Generate a dedicated deploy keypair** (do not reuse a personal key):

   ```bash
   ssh-keygen -t ed25519 -C "gh-actions-deploy" -f deploy_key -N ""
   ```

2. **Trust the public key on the droplet** (the `grove` user receives deploys):

   ```bash
   ssh-copy-id -i deploy_key.pub grove@157.230.15.201
   # or append deploy_key.pub to /home/grove/.ssh/authorized_keys manually
   ```

3. **Capture the droplet host key** for the runner's known_hosts:

   ```bash
   ssh-keyscan 157.230.15.201
   ```

4. **Add GitHub repository secrets** (Settings → Secrets and variables → Actions):
   - `SSH_PRIVATE_KEY` — the full contents of the private `deploy_key`.
   - `SSH_KNOWN_HOSTS` — the output of the `ssh-keyscan` above.
   - `DEPLOY_HOST` — `grove@157.230.15.201`.

5. **Delete the local private key** once stored as a secret (`rm deploy_key`).

The firewall already permits this: `ufw allow OpenSSH` opens port 22 to any
source, so the runner's dynamic IPs can connect. Revoke access any time by
removing the key's line from `/home/grove/.ssh/authorized_keys`. The `grove`
user's sudo is scoped to only `systemctl restart chia-grove`.

### Cutting a release

```bash
git tag v0.1.0 && git push origin v0.1.0
```

Verify after the run: `curl -s https://chia-grove.com/healthz` should report
`"appVersion":"v0.1.0"`.
```

- [ ] **Step 2: Check markdown formatting**

Run: `npx --yes prettier --check deploy/README.md`
Expected: already formatted (exit 0). If not, `npx --yes prettier --write deploy/README.md` then re-check.

- [ ] **Step 3: Commit**

```bash
git add deploy/README.md
git commit -m "docs: SSH deploy key and release secrets setup

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: End-to-end verification (operator-run)

**This task is run by a human after Task 5's secrets are configured.** It cannot be done locally.

- [ ] **Step 1: Open a PR for the branch and confirm CI is green**

```bash
git push -u origin feat/phase2-versioning-release
gh pr create --fill
```
Expected: the `CI / build` check passes (release.yml does not run on PRs, only on tags).

- [ ] **Step 2: Merge the PR, then cut a test tag**

After merge to `main`:
```bash
git checkout main && git pull
git tag v0.1.0 && git push origin v0.1.0
```

- [ ] **Step 3: Watch the release run**

```bash
gh run watch "$(gh run list --workflow=release.yml --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status
```
Expected: all steps pass, including **Verify deployed version**.

- [ ] **Step 4: Confirm the live server**

```bash
curl -s https://chia-grove.com/healthz
```
Expected: `{"ok":true,"appVersion":"v0.1.0","gitSha":"..."}`.

---

## Self-Review

**Spec coverage (Phase 2 section of the foundation spec):**
- "Source of truth: the git tag; validate v<semver>" → Task 3 validate step. ✓
- "Build stamping: version.json (appVersion, gitSha, builtAt)" → Task 2 (deploy.sh writes it). ✓
- "Server reads version.json at startup; dev fallback" → Task 1 (`readVersion`, dev fallback tested). ✓
- "/healthz reports appVersion, gitSha" → Task 1 Steps 5–6. ✓
- "Deploy on tag: gates → build → SSH/rsync → npm ci --omit=dev → restart" → Task 3 + Task 2. ✓
- "Secrets: SSH_PRIVATE_KEY, DEPLOY_HOST, SSH_KNOWN_HOSTS; scoped sudo" → Task 5. ✓
- "npm ci not npm install; node_modules excluded; native binary on droplet" → Task 2. ✓
- "deploy.sh usable manually" → Task 2 (default version via git describe). ✓
- Node 20 deprecation noted in Phase 1 review → Task 4. ✓

**Placeholder scan:** No TBD/TODO; every code/config step shows full content; every command has expected output. ✓

**Type/name consistency:** `readVersion(file?)`/`VersionInfo` defined in Task 1 and consumed consistently; `/healthz` shape `{ ok, appVersion, gitSha }` matches between handler (Task 1 Step 6) and its test (Task 1 Step 5) and the verify step (Task 3 reads `appVersion`); `deploy.sh <host> [version]` signature defined in Task 2 and called that way in Task 3. ✓

**Deferred to Phase 3 (correctly out of scope):** client `__APP_VERSION__` Vite define, `PROTOCOL_VERSION`, the `hello` message, and `protocolVersion` in `/healthz` — none appear here.
