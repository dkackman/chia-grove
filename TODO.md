# Code review follow-ups

From the 2026-07-13 GitNexus-assisted quality/correctness review. The critical
SSRF bug (IPv6-mapped/compatible IPv4 literals bypassing `isPrivateV6` in
`server/src/web/img-proxy.ts`) and the ingest error-isolation bug below have
been fixed and tested. Everything else is still open.

## High

- [x] **Live ingest has no per-block error isolation.** ~~`server/src/index.ts:80-95`
      calls `classifyBlock`/`contentFilter.enrich` with no try/catch.~~ Fixed:
      `onBlock` now wraps classify+enrich in try/catch and falls back to a
      bare `blockEvent(block)` (new export from `classify.ts`, shared with the
      `classifyBlock` first-event construction) on failure, matching
      `block-lookup.ts`'s existing degrade-gracefully pattern. Confirmed via
      `gitnexus impact` that `enrich()` never rejects on its own (network
      failures are already swallowed to a permissive verdict internally), so
      this only catches genuine bugs, not transient RPC trouble — real RPC
      retries still happen upstream in `applyBlock`/`fastForward`/`walkTo`,
      unaffected. Regression test: `blockEvent() matches classifyBlock()'s own
      first event` in `classify.test.ts`.
- [ ] **`LOCAL_NSFW_ENFORCE_CLEAN` — needs your confirmation, not a code fix.**
      Investigated: this repo has no `.env` committed for production and the
      droplet's actual value is set via an untracked `systemctl edit`
      drop-in (`deploy/README.md:101` only documents it as an *optional* step
      an operator may apply — its presence in the doc isn't evidence it's
      live). I can't check the running droplet's systemd environment from
      here without SSHing into production, which I won't do unprompted. If
      it's enabled: a self-hosted opennsfw2 "clean" verdict is persisted
      permanently and Vision is never consulted again for that NFT — no
      second check, no re-review path
      (`server/src/content-filter/safesearch-worker.ts:299-321`). This is a
      deliberate, documented trust escalation (CLAUDE.md frames it as "once
      you trust the local classifier's agreement with Vision"), not a hidden
      bug — so the action item is just: confirm whether it's actually set on
      `chia-grove.com`'s host today, and if so, decide if that tradeoff is
      still the one you want.

## Medium

- [ ] **Farm theme has no reorg cleanup.** `web/src/themes/farm/index.ts:111-118`
      only does a cosmetic wilt/crow-sweep on reorg; it never removes crops
      planted in reorged blocks, unlike Mine (`clearAbove` on
      island/cats/villagers/paintings) and Gallery. Scene state can
      permanently diverge from chain state after a real reorg.
- [ ] **Content-filter fails open by design** — every timeout/error (MintGarden
      outage, Vision failure) defaults content to unflagged rather than
      blocking. Documented and likely intentional, but worth a deliberate
      sign-off given it's the single most safety-relevant property of the
      moderation pipeline.
- [ ] **Demo mode bypasses `DrainQueue`.** `web/src/net/demo.ts:108-119` invokes
      `dispatch` directly with ad-hoc `setTimeout` staggering instead of
      routing through `web/src/net/feed.ts:70`'s `queue.enqueue`. `?demo=1`
      never exercises the real snapshot-pacing path, so a pacing regression
      would be invisible in offline testing.
- [ ] **No test file for `GroveFeed`** (`web/src/net/feed.ts`). Reconnect/backoff,
      handshake timeout, and stale-timer logic are untested, unlike the pure
      helpers it delegates to (`protocol-guard.test.ts`, `drain-queue.test.ts`).
- [ ] **Gallery's duplicated detail-card logic.** `web/src/ui/detail-card.ts`
      (used by grove/board) and `web/src/themes/gallery/label.ts`
      (`placardModel`/`Placard$`) independently reimplement the same
      spacescan/mintgarden-link and media-rendering logic. Concrete, fixable
      driver of Gallery's low (72%) cohesion score; a future `CardMeta` field
      change risks updating one and not the other.
- [ ] **Untested fallback path in `classifySpend`.** `server/src/classify/classify.ts:113-119`
      (catch block for an unexpected `parseNft`/`parseCat`/`parseDid` throw,
      falls back to base `xch` sprout) has no covering test — only the
      "parse returns null" miss path is exercised.

## Low

- [ ] `DrainQueue.clear()` (`web/src/net/drain-queue.ts:53-57`) can't cancel an
      already-scheduled callback. Narrow window (backgrounded tab + reconnect
      racing the 1s fallback timer) where a stale drain fires alongside a
      fresh one, briefly delivering up to 2× the 120/frame budget.
- [ ] `CatRegistry.refresh()` (`server/src/classify/cats.ts:42-58`) — unbounded
      pagination loop, no fetch timeout/AbortController, no in-flight guard
      against overlapping refreshes if one hangs past the next hourly tick.
- [ ] `fastForward()` docstring (`server/src/ingest/coinset-poller.ts:78-103`)
      overstates its own error handling — claims all errors fall back to
      `resync()`, but only `tryGetBlockInfo` errors are caught; errors from
      `applyBlock` propagate straight to `loop()`'s backoff handler instead.
- [ ] Doc drift: `web/CLAUDE.md:39` still lists old Farm crop caps;
      `web/src/themes/farm/crops.ts:96` doubled them in the "Farm landscape"
      commit (34023c2).
- [ ] Orphaned placeholder texture leak in `web/src/themes/gallery/pieces.ts:291-298`
      if art load fails after a sensitivity flag arrives early for that
      launcher (JS-heap only, session-lifetime, not GPU).
- [ ] `web/src/themes/farm/field.ts` bundles unrelated barn/silo/fence
      construction into what's nominally field/furrow logic — mild
      contributor to Farm's 75% cohesion score; consider splitting into a
      `structures.ts` alongside `scenery.ts`/`terrain.ts`/`props.ts`.
- [ ] `server/src/content-filter/signals/mintgarden.ts:54` hard-blocks on
      `creator.verification_state === 2`, a magic number with no named
      constant/enum and no type-fuzz test (unlike `sensitive_content`, which
      is thoroughly fuzzed).
- [ ] `server/src/content-filter/safesearch-worker.ts:90` — `GOOGLE_UNREACHABLE_HOSTS`
      hardcodes only `ipfs.mintgarden.io`; other common IPFS gateways
      (ipfs.io, nftstorage.link, dweb.link) aren't covered. Consider making
      this config-driven.
- [ ] No `ws.onerror` handler in `web/src/net/feed.ts:51-87` — harmless
      (reconnect is driven by `onclose`), but connection-error diagnostics are
      silently dropped.
- [ ] `web/src/ui/legend.ts:69-83` (`buildTipJar`) unconditionally injects a
      remote third-party script with no integrity check or error handler.
- [ ] Dead code: `web/src/themes/gallery/dust.ts:92` (`activeCount()`), unused
      `dispose()` methods in `gallery/label.ts:153` and `gallery/play-button.ts:84`,
      unused per-row tint infra in `web/src/themes/board/flapgrid.ts:67,116,173,178`.
- [ ] `server/src/web/img-proxy.ts` `isPrivateV4`/`isPrivateV4Octets` accepts
      `Number()`-parsed octets, which permits `0x`-prefixed hex segments
      (`Number("0x7f") === 127`); currently unreachable via the literal-IP path
      since `net.isIP` is strict decimal-only, but add an explicit test/assert
      rather than relying on that Node behavior.

## Informational (no action needed)

- Farm's low cohesion (75%) is a legitimate hub-and-spoke shape across 14
  single-purpose files, not a god-file — only the `field.ts` item above is a
  real nit.
- Gallery's low cohesion (72%) is substantive: the detail-card duplication
  above plus genuinely broader scope (custom input pipeline, camera state
  machine, async load pool) than the other themes.
