# Content Filtering & Flagging — Design

How chia-grove decides whether an NFT's art is safe to render, blurs it, or
hides it entirely, and how that decision reaches connected clients. Written to
be replicable elsewhere, not as an API reference — see the source under
`server/src/content-filter/` for exact signatures.

## Goals / constraints

- NFT art comes from an untrusted, adversarial source (anyone can mint
  anything to the chain) and must be classified **before** it's rendered to
  users, including sensitive/adult content.
- Classification must not stall block ingestion — the chain doesn't wait for
  a slow third-party API.
- A paid, rate-limited classifier (Google Vision SafeSearch) is the ground
  truth, but calling it for every image is expensive at scale — cheap local
  signals should resolve the easy majority of cases first.
- Failures must be fail-open (never block ingestion or crash the pipeline) but
  bias toward permissive-with-retry, not silently-wrong-forever.

## The disposition model

Every NFT resolves to one of three dispositions, checked in order of
strength — a later signal can only escalate, never de-escalate:

```
ok  <  sensitive  <  blocked
```

- **ok** — render normally.
- **sensitive** — render blurred/labeled (client decides the exact UI).
- **blocked** — treat the art as unreachable. The server actively evicts the
  URL from its in-memory art index so a later request for it 404s — the
  disposition isn't just a client-side hint, the bytes are proactively made
  unreachable (defense in depth).

`combine()` over a list of per-signal results just takes the max by that
ranking. This lets every stage below contribute independently without needing
to know about each other.

## Two-tier pipeline

```
NFT spend observed during block ingest
    │
    ▼
Tier 1 — cheap signals (synchronous, inline, ~ms)
    │   lexicon match, on-chain CHIP-0007 flag, MintGarden collection/
    │   creator metadata, curated denylist, curated allow-list
    │   → stamps a disposition immediately, before the event ever reaches clients
    ▼
Tier 2 — async classifiers (out-of-band, seconds, only when Tier 1 said "ok")
    │   2a. local NSFW model (self-hosted, ~free) — optional pre-filter
    │   2b. Google Vision SafeSearch (paid) — ground truth
    ▼
Late verdict, if it changes anything → pushed to already-connected clients
as a separate flag event
```

The event already streamed to clients permissively while Tier 2 was still
running; if Tier 2 later escalates the disposition, that correction arrives
as its own event and the client patches its already-rendered state in place.

### Tier 1 — cheap signals

Runs synchronously in the block-ingest path, bounded by a time budget (a slow
signal source degrades to "permissive for now, corrected later" rather than
stalling the whole block). Checked and combined:

1. **Lexicon** — a curated adult-terms list matched (word-boundary, not
   substring) against the NFT's name, collection name, and metadata
   description. Sensitive on hit.
2. **On-chain CHIP-0007 `sensitive_content`** — the metadata standard has a
   field for this; a bare truthy value, non-empty array, or non-empty/non-
   "false" string all count as sensitive. Only explicit `false`/`""` clears it.
3. **MintGarden collection/creator metadata** — third-party indexer that
   layers moderation signals on top of raw chain data: `is_blocked`,
   `collection.blocked_content`, `creator.verification_state` → blocked;
   `collection.sensitive_content` → sensitive.
4. **Curated denylist** — a maintained map of collection-id → disposition,
   for cases the above don't catch (manual curation, e.g. after a user
   report). Checked independent of MintGarden's own opinion.
5. **Curated allow-list** — matched by creator DID _or_ collection id. Can
   only stamp a `whitelisted: true` flag on an otherwise-`ok` result; it can
   never downgrade a blocked/sensitive verdict from any of the above. Its
   only effect downstream is skipping Tier 2 entirely for known-safe,
   already-vetted collections (saving the paid API call).

Whichever of these determined the verdict, it's persisted per NFT (keyed by
its stable launcher id) so a re-spend of the same NFT doesn't redo the work.

**Gating for Tier 2:** only NFTs whose Tier 1 verdict was `ok` (not already
blocked/sensitive, and not whitelisted) get queued for the async tier at all.

### Tier 2a — local NSFW model (optional, cheap)

A self-hosted, small NSFW image classifier (this project uses a converted
open-source model run via a local ML runtime) that can run entirely offline,
with no per-call cost. Three operating modes, all controlled by two things:
whether a paid-API key is configured, and whether the operator has opted into
enforcement:

| Paid API key set? | Enforcement opted in? | Behavior                                                                                                                                                                                                                                                                                                                   |
| ----------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| no                | —                     | **Standalone**: runs, logs its score, never persisted or acted on. Lets you evaluate the model with zero ongoing cost.                                                                                                                                                                                                     |
| yes               | no                    | **Shadow**: runs alongside every paid-API call, logs a comparison between the two verdicts. Still never changes what gets persisted.                                                                                                                                                                                       |
| yes               | yes                   | **Enforcing**: a confidently-clean score skips the paid call entirely (persists ok directly from the local result). Anything _not_ confidently clean (uncertain or confidently-nsfw) still goes to the paid API — the local model is only ever trusted to say "definitely fine," never to say "definitely bad" on its own. |

The score is banded against two thresholds (`cleanBelow` / `nsfwAbove`) into
`clean | uncertain | nsfw`; only `clean` is ever actionable, which bounds the
damage a false result can do (a false-negative "clean" verdict on real nsfw
content is the only failure mode enforcement introduces, and it's the same
one a lexicon/denylist miss already has — everything else still gets the
paid API's opinion).

Rolling this out safely means: ship in standalone/shadow mode first, watch
the logged agreement between local and paid verdicts over real traffic, only
then flip on enforcement once you trust the threshold.

**Preprocessing parity matters more than it sounds.** If your local classifier
reimplements a model's expected input preprocessing (resize/crop/normalize) in
a different language/library than the one it was trained and validated in,
resizing-kernel differences between implementations are real and need to be
measured — generate a reference input tensor from the original toolchain,
compare your port's output against it on a fixed test image, and set your
tolerance from the observed drift rather than assuming parity.

### Tier 2b — paid SafeSearch API (ground truth)

An out-of-band worker, decoupled from the block-ingest path entirely (a
queue, not a blocking call):

- **What gets classified**: the image's own art for image NFTs; a static
  poster frame for video NFTs (the API can't decode video, and a video with
  no resolvable poster is simply skipped — best-effort, not a hard
  requirement).
- **Content-addressed dedup**: the real win at scale. Distinct NFTs (e.g. an
  edition drop) often share identical underlying bytes. Classification
  results are cached keyed by a content hash (or, before a hash is known yet,
  by the exact URL about to be checked) — so the paid call runs once per
  unique image, not once per NFT. A concurrent request for content already
  mid-check joins the in-flight call instead of independently paying for a
  second lookup.
- **Readiness probing + fallback**: if art is served through an
  ingestion-lagged CDN, a cheap `HEAD` probe checks the exact URL is actually
  fetchable before spending the paid call on it; if it never becomes ready,
  fall back to one attempt against the original on-chain URL instead of
  giving up outright (skipping hosts known to be unreachable from the
  classifier's own network).
- **Concurrency is gated, polling is not** — the paid call sits behind a
  small concurrency limit (respecting the API's rate limits); the readiness
  probe's wait does _not_ share that gate, or throughput would collapse to
  `concurrency / probe_wait` for no reason (the probe is cheap, unrelated
  contention).
- **Failure backoff, per content not per NFT** — a failure suppresses retries
  for that exact content for a TTL that **doubles on repeated failure** (capped),
  so a permanently-dead asset settles into a few attempts/day forever instead
  of hammering it every retry cycle.
- **A periodic sweep** re-attempts anything still unchecked, so content that
  lagged CDN ingestion at mint time eventually gets classified without
  needing a re-spend to trigger it.
- **A bounded total-in-flight cap** protects against an airdrop-sized mint
  burst opening unbounded concurrent probes/sockets.

Everything here is fail-open: any classification failure leaves the NFT
`ok` for now, backed off for retry, never persisted as a false verdict.

## Persistence

One row per NFT (keyed by its stable identifier), holding: the resolved
disposition, a "was this ever checked by the paid API" flag, the content
hash (once known), the exact URL actually classified, and the raw paid-API
response for audit. The "checked" flag is what makes the whole async tier
idempotent — a launcher already checked is never re-queued, whether by a new
spend or the periodic sweep.

## Delivering the (possibly late) verdict

The block-ingest path publishes every event immediately, permissively, without
waiting on Tier 2. When Tier 2 later escalates a disposition, that's pushed
to already-connected clients as its own small "flag" event carrying just the
NFT's id and the new disposition. Clients hold a live index of
already-rendered NFTs by that id and patch the one matching event in place
(reblur, or drop it from view if now blocked) — no re-fetch or full reload
needed.

## Replicating this elsewhere — the load-bearing ideas

1. **Rank, don't branch** — model dispositions as a totally ordered scale and
   `max()` over every signal's opinion. Every new signal (a new denylist, a
   new classifier) just becomes another input to that same reduction, not a
   new conditional.
2. **Gate the expensive tier behind the cheap one** — only pay for the paid
   API on content the cheap signals couldn't already resolve.
3. **Dedup by content, not by identity** — many distinct records can point at
   identical bytes; cache by a content hash so you pay once per unique asset.
4. **Never let classification block ingestion** — publish permissively,
   correct later via a separate, small "flag changed" event the client can
   apply in place.
5. **Every failure mode is fail-open with backoff**, and the backoff key is
   the content, not the record — so one dead asset doesn't cost you a retry
   per record referencing it, forever.
6. **A local pre-filter should only ever be trusted for its confident-easy
   answer** (here: "definitely clean") **and always deferred to the paid
   ground truth for anything it's unsure about** — that bounds what a wrong
   local answer can cost you to the same class of risk you already accept
   from any other cheap signal.
