# Open follow-ups

Pruned 2026-11-07. Everything from the 2026-07-13 quality/correctness review is
either fixed (see git history; most landed with #69 or the follow-up branch)
or closed below. Only genuinely open items stay here.

## Open

- [ ] **Per-theme browser smoke test.** Only `web/e2e/board-hover.spec.ts`
      exists. A Playwright spec that opens each `?theme=<id>&demo=1`, waits a
      few seconds and asserts no console/WebGL errors plus a non-blank canvas
      would catch what unit tests can't (shader compile failures, color-space
      regressions, an empty scene). Demo mode now goes through the real
      `DrainQueue`/`SeenBlocks` path and emits a periodic reorg, so such a test
      exercises snapshot pacing, replay detection and reorg handling too.
- [ ] **`LOCAL_NSFW_ENFORCE_CLEAN` — standing caution, not a bug.** Not set in
      production (confirmed 2026-07-13). If it is ever enabled, a confident-clean
      local verdict is permanent and propagates to every NFT sharing identical
      bytes via the content-hash dedup in `SafeSearchWorker.run()`; there is no
      periodic re-audit. Revisit before flipping it on.

## Notes

- Three.js is ~620 KB of the ~670 KB first load now that themes are split
  into per-scene chunks. Further shrinking means trimming Three imports (e.g.
  the shared `render-loop`/postfx chunk), not more splitting.
- Closed: the content filter failing open is a deliberate, signed-off policy
  for a visualizer (see `server/CLAUDE.md` and the header of
  `server/src/content-filter/index.ts`).
