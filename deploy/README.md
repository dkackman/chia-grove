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
