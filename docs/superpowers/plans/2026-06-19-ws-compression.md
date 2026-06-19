# WebSocket Compression (permessage-deflate) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable `permessage-deflate` on the WebSocket so the (now batched) JSON wire traffic is compressed 5–10×, cutting bandwidth for every client — especially the connect-snapshot burst and mobile/slow links.

**Architecture:** A server-only change: pass tuned `perMessageDeflate` options through `@fastify/websocket` to the underlying `ws` server. Compression is negotiated transparently at the WebSocket handshake; browsers support it natively, so **no client code changes**. No wire-format change → **no `PROTOCOL_VERSION` bump**, no reload-guard interaction.

**Tech Stack:** Fastify, `@fastify/websocket` (wraps `ws`), Node 24.

## Global Constraints

- Node ≥ 24.
- No protocol/wire-format change: `PROTOCOL_VERSION` stays at its current value; this ships as a **patch** release.
- Memory discipline: `permessage-deflate` keeps a zlib context per connection (~tens–hundreds of KB each); use no-context-takeover + a size threshold to bound it.

## Prerequisite

Ships **after** event batching (#6 / `v0.3.0`) is merged and deployed, as `v0.3.1`. The change is independent of the batching code, so branch off `main` once #6 is merged:

```bash
git checkout main && git pull && git checkout -b feat/ws-compression
```

## Why color-coalesce was dropped

The original assessment's "coalesce `setColorAt`/`needsUpdate`" item is a **no-op** and is intentionally not in this plan: `needsUpdate = true` only bumps the attribute version; Three.js uploads the buffer once at draw time regardless of how many times it was flagged that frame. Coalescing would add a flag + early-return-path bug risk for zero observable gain.

## Verification model

A config-only change to the `ws` layer can't be meaningfully red-green unit-tested with the existing `FakeSocket` harness (compression lives below our code, negotiated at the real handshake). Verification is:

1. **No regression** — the full suite + typecheck + build stay green (the `ws`/Hub/img-proxy tests use `FakeSocket`, unaffected).
2. **Live handshake check** — a real `ws` client reports `permessage-deflate` in its negotiated extensions (manual, post-deploy command below).
3. **CPU/memory watch** — observe the droplet under load after deploy; back out (one-line revert) if memory regresses.

---

### Task 1: Enable tuned `permessage-deflate`

**Files:**

- Modify: `server/src/web/server.ts`

**Interfaces:** none (server config only).

- [ ] **Step 1: Confirm the current registration**

Run: `grep -n "register(websocket" server/src/web/server.ts`
Expected: `await app.register(websocket);` (no options today).

- [ ] **Step 2: Pass tuned compression options**

In `server/src/web/server.ts`, replace:

```ts
await app.register(websocket);
```

with:

```ts
await app.register(websocket, {
  options: {
    // Compress the (batched) JSON wire traffic. Negotiated at the handshake;
    // browsers support it natively, so no client change. no-context-takeover
    // bounds per-connection zlib memory; threshold skips tiny frames
    // (hello/ambient) where framing + a deflate context aren't worth it.
    perMessageDeflate: {
      threshold: 1024,
      serverNoContextTakeover: true,
      clientNoContextTakeover: true,
    },
  },
});
```

- [ ] **Step 3: Confirm no regression**

Run: `npm run typecheck && npx vitest run server/ && npm run build`
Expected: typecheck clean; all server tests pass; build succeeds. (The `ws`/Hub/img-proxy tests use `FakeSocket`, so they neither exercise nor break on compression.)

- [ ] **Step 4: Commit**

```bash
git add server/src/web/server.ts
git commit -m "perf: enable permessage-deflate on the websocket

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Verify + checkpoint

- [ ] **Step 1: Full gate suite**

Run: `npm run lint && npm run typecheck && npx vitest run && npm run build`
Expected: all green.

- [ ] **Step 2: Local handshake smoke check (optional, pre-push)**

With a local dev server running (`npm run dev:server`), confirm a real client negotiates compression (`ws` is available transitively via `@fastify/websocket`):

```bash
node -e "const {WebSocket}=require('ws'); const w=new WebSocket('ws://127.0.0.1:8080/ws',{perMessageDeflate:true}); w.on('open',()=>{console.log('extensions:',w.extensions||'(none)'); w.close();}); w.on('error',e=>{console.error(e.message);process.exit(1);});"
```

Expected: prints `extensions: permessage-deflate` (a non-empty extensions string). If it prints `(none)`, the option didn't take effect.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/ws-compression
gh pr create --base main --fill
```

Confirm the `build` check is green. PR note: server-only, no protocol change; deploy as `v0.3.1` after `v0.3.0`.

- [ ] **Step 4: Post-deploy verification (operator)**

After `v0.3.1` deploys:

```bash
node -e "const {WebSocket}=require('ws'); const w=new WebSocket('wss://chia-grove.com/ws',{perMessageDeflate:true}); w.on('open',()=>{console.log('extensions:',w.extensions); w.close();});"
```

Expected: `extensions: permessage-deflate`. Then watch the droplet's memory/CPU under live load for a bit (`journalctl -u chia-grove`, `systemctl status chia-grove`); if memory climbs unacceptably, revert is the single-line change from Task 1.

---

## Self-Review

**Coverage:** Enables compression (Task 1) with the memory mitigations the assessment called for (threshold + no-context-takeover); verifies no regression + live negotiation (Task 2). ✓

**Placeholder scan:** No TBD/TODO; full config shown; commands have expected output. ✓

**Scope:** Server-only, no protocol/client change, no `PROTOCOL_VERSION` bump — ships as a patch. Color-coalesce deliberately excluded (no-op, explained above). ✓
