# Phase 1: CI Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GitHub Actions workflow that gates every PR and push to `main` with lint, typecheck, test, and build.

**Architecture:** A single declarative workflow file (`.github/workflows/ci.yml`) runs the four existing npm scripts on `ubuntu-latest` with Node 24. No application code changes. A short deploy doc records the (manual) branch-protection setup that makes the gate enforced.

**Tech Stack:** GitHub Actions, `actions/checkout@v4`, `actions/setup-node@v4`, npm workspaces, Node 24.

## Global Constraints

- Node ≥ 24 (workflow pins `node-version: 24`; local is 24.13.0).
- Use `npm ci` (deterministic, lockfile-pinned) — never `npm install` in CI. Root `package-lock.json` exists (lockfileVersion 3).
- The gate runs exactly these four scripts, in order: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`. (Matches the approved spec; do not add `format:check` or other gates here.)
- This phase changes **no** application code. Only `.github/workflows/ci.yml` and `deploy/README.md` are created.

## Verification model (read first)

A declarative CI workflow has no red-green unit test. Its verification is three-part:

1. **YAML validity** — the file parses (local check below).
2. **Gate commands pass locally** — the same four scripts the workflow runs are already green on this branch; if they pass locally they pass in CI.
3. **Live run** — the authoritative check: push the branch, open a PR, and confirm the `CI / build` check goes green. This step requires pushing to GitHub and is performed by the executor/user.

---

### Task 1: CI workflow file

**Files:**

- Create: `.github/workflows/ci.yml`

**Interfaces:**

- Consumes: existing root npm scripts `lint`, `typecheck`, `test`, `build`; root `package-lock.json`.
- Produces: a GitHub Actions workflow named `CI` with a single job `build`. The branch-protection status-check name will surface as `CI / build` (used by Task 2).

- [ ] **Step 1: Confirm the four gate commands are green locally (baseline)**

Run:

```bash
npm ci && npm run lint && npm run typecheck && npm test && npm run build
```

Expected: all succeed. Notably `npm test` ends with `Tests  162 passed (162)` and `npm run build` exits 0 (it prints a non-fatal "Some chunks are larger than 500 kB" warning — that is expected and does **not** fail the build).

- [ ] **Step 2: Create the workflow file**

Create `.github/workflows/ci.yml` with exactly this content:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm

      - run: npm ci

      - run: npm run lint

      - run: npm run typecheck

      - run: npm test

      - run: npm run build
```

- [ ] **Step 3: Validate the YAML parses**

Run (Ruby ships with macOS; its stdlib `psych` parses YAML):

```bash
ruby -ryaml -e "YAML.load_file('.github/workflows/ci.yml'); puts 'valid yaml'"
```

Expected: prints `valid yaml` with exit 0. (If `actionlint` happens to be installed, `actionlint .github/workflows/ci.yml` is a stronger check and should report no issues.)

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: gate PRs and main with lint, typecheck, test, build

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 5: Push and observe the live run (authoritative verification)**

```bash
git push -u origin feat/cicd-versioning-foundation
```

Then open a PR for the branch (`gh pr create --fill` or via the GitHub UI) and confirm the **CI / build** check runs and goes green. This is the real proof the gate works; it cannot be verified locally. If the run fails, read the failing step's log, fix, and re-push (the workflow re-runs on every push to the PR).

---

### Task 2: Document the CI gate and branch-protection setup

**Files:**

- Create: `deploy/README.md`

**Interfaces:**

- Consumes: the `CI / build` status-check name produced by Task 1.
- Produces: deploy documentation that Phases 2–3 will extend (release workflow, secrets, Caddy apply step).

- [ ] **Step 1: Create the deploy README with the CI section**

Create `deploy/README.md` with exactly this content:

```markdown
# Deployment & CI

## Continuous Integration

`.github/workflows/ci.yml` runs on every pull request and every push to `main`.
It executes the project's four gates in order on Node 24:

1. `npm run lint`
2. `npm run typecheck`
3. `npm test`
4. `npm run build`

A red gate means the change is not mergeable.

### Enforcing the gate (one-time, manual — requires repo admin)

The workflow runs automatically, but it is only _enforced_ once branch
protection requires it:

1. GitHub → repository **Settings** → **Branches** → **Add branch ruleset**
   (or "Add rule" on the classic UI).
2. Target branch: `main`.
3. Enable **Require status checks to pass before merging**.
4. Add the required check: **CI / build**. (The check name only appears in
   this list after the workflow has run at least once, so open a PR first.)
5. Save.

After this, PRs cannot merge into `main` until `CI / build` is green.
```

- [ ] **Step 2: Verify the README renders without broken markdown**

Run:

```bash
npx --yes prettier --check deploy/README.md
```

Expected: `deploy/README.md` reported as already formatted (exit 0). If prettier reports it would reformat, run `npx --yes prettier --write deploy/README.md` and re-check.

- [ ] **Step 3: Commit**

```bash
git add deploy/README.md
git commit -m "docs: document CI gate and branch-protection setup

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (Phase 1 section of the foundation spec):**

- "Triggers: pull_request + push to main" → Task 1 Step 2 (`on:` block). ✓
- "Job: ubuntu-latest, setup-node@v4 node 24, npm cache, npm ci → lint → typecheck → test → build" → Task 1 Step 2. ✓
- "Branch protection: require this check before merging, documented (cannot be set from code)" → Task 2. ✓

**Placeholder scan:** No TBD/TODO; every step has exact file content and exact commands with expected output. ✓

**Type/name consistency:** Workflow `name: CI` + job `build` → branch-protection check name `CI / build` is used consistently in Task 1 (Interfaces/Step 5) and Task 2 (Step 1). ✓

**Out of scope (correctly deferred to later phases):** `release.yml`, `version.json`, `/healthz` changes, protocol `hello`, Caddyfile reconciliation — none belong in Phase 1.
