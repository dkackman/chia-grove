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
