# Code review follow-ups

From the 2026-07-13 quality/correctness review. The critical
SSRF bug (IPv6-mapped/compatible IPv4 literals bypassing `isPrivateV6` in
`server/src/web/img-proxy.ts`) and the ingest error-isolation bug below have
been fixed and tested. Everything else is still open.

## High

- [x] **Live ingest has no per-block error isolation.** ~~`server/src/index.ts:80-95`
      calls `classifyBlock`/`contentFilter.enrich` with no try/catch.~~ Fixed:
      `onBlock` now wraps classify+enrich in try/catch and falls back to a
      bare `blockEvent(block)` (new export from `classify.ts`, shared with the
      `classifyBlock` first-event construction) on failure, matching
      `block-lookup.ts`'s existing degrade-gracefully pattern. Confirmed
      that `enrich()` never rejects on its own (network
      failures are already swallowed to a permissive verdict internally), so
      this only catches genuine bugs, not transient RPC trouble — real RPC
      retries still happen upstream in `applyBlock`/`fastForward`/`walkTo`,
      unaffected. Regression test: `blockEvent() matches classifyBlock()'s own
first event` in `classify.test.ts`.
- [ ] **`LOCAL_NSFW_ENFORCE_CLEAN` — confirmed NOT set in production (2026-07-13).**
      Left open intentionally: not a bug, just a documented trust escalation
      (CLAUDE.md: "once you trust the local classifier's agreement with
      Vision"). If ever enabled, be aware a confident-clean local verdict is
      permanent and propagates to every NFT sharing identical on-chain bytes
      via the content-hash dedup in `run()` — no periodic re-audit exists
      (`server/src/content-filter/safesearch-worker.ts:299-321`). Revisit if
      this ever gets flipped on.

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
- [x] **No test file for `GroveFeed`** (`web/src/net/feed.ts`). Fixed: added
      `web/test/feed.test.ts` (12 tests) covering ws/wss URL selection,
      handshake timeout (closes + cancels-on-message), status transitions
      (connecting → live, malformed-frame drop), reconnect backoff (doubling,
      30s cap, reset-on-message), the stale timer, hello/protocol-mismatch
      reload guard behavior, and `queue.clear()` on close. Stubs `WebSocket`/
      `location`/`sessionStorage`/`requestAnimationFrame` via `vi.stubGlobal`,
      matching the pattern `drain-queue.test.ts` already used.
- [x] **Gallery's duplicated detail-card logic.** Fixed: extracted the
      identical spacescan/mintgarden link construction into
      `web/src/ui/links.ts` (`spacescanLink`, `mintgardenLink`), consumed by
      both `web/src/ui/detail-card.ts`'s `showCard` and
      `web/src/themes/gallery/label.ts`'s `placardModel` — the part that was
      byte-for-byte identical and the actual risk the finding called out. Left
      the aggregate/cat-icon handling in `detail-card.ts` and the DOM-free
      `Placard` model in `label.ts` alone (legitimately different per theme,
      not duplication). New `web/test/links.test.ts`; existing
      `gallery-label.test.ts` passes unchanged, confirming `placardModel`'s
      output is unaffected.
- [x] **Untested fallback path in `classifySpend`.** Fixed: added a test that
      empirically forces the throw (corrupting a spend's `solution` bytes so
      `deserializeWithBackrefs` throws `"Eval error: bad encoding"` inside the
      try block, confirmed by direct probe against the real SDK — not just the
      "parse returns null" miss path the rest of the suite already covered).

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
