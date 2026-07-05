# NFT Collection Whitelist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a curated (creator DID, collection id) allow-list that skips the Google Vision SafeSearch check for known-safe NFT collections, without ever weakening any existing block/sensitive signal.

**Architecture:** A new `signals/whitelist.ts` module (mirroring the existing `denylist.ts`) is consulted last inside `mapMintgardenSignals`, only when every other cheap signal has already resolved to `"ok"`. A match stamps `whitelisted: true` on the `Verdict`, which `ContentFilter.apply()` threads into `ContentStore.putCheap()` as a new `skipSafesearch` flag. That flag stamps `safesearch_checked_at` at insert time, which the existing `SafeSearchWorker.tryEnqueue()` guard (`stored?.safesearchChecked`) already respects on the initial spend, every future re-spend, and the periodic sweep — so no new logic is needed in the worker itself.

**Tech Stack:** TypeScript, vitest, `node:sqlite` (via `ContentStore`).

## Global Constraints

- The allow-list must never override a `blocked` or `sensitive` result from any other signal (MintGarden moderation, `sensitive_content` flags, curated denylist, lexicon). It is strictly an optimization to skip Vision, never a safety override.
- No new network calls: the allow-list check reuses `creator.encoded_id` and `collection.id`, fields already present in the MintGarden `GET /nfts/:id` response that `mapMintgardenSignals` already receives.
- A match requires **both** the creator DID and the collection id together (composite key) — matching either field alone is not sufficient.
- Full design spec: `docs/superpowers/specs/2026-07-04-nft-collection-whitelist-design.md`.

---

### Task 1: Whitelist data module

**Files:**

- Create: `server/src/content-filter/signals/whitelist.ts`
- Test: `server/test/whitelist.test.ts`

**Interfaces:**

- Produces: `WhitelistEntry { creatorDid: string; collectionId: string; note?: string }`, `WHITELIST: WhitelistEntry[]` (ships empty), `buildWhitelistSet(entries: WhitelistEntry[]): Set<string>`, `WHITELIST_SET: Set<string>`, `isWhitelisted(set: Set<string>, creatorDid: string | undefined, collectionId: string | undefined): boolean`.

- [ ] **Step 1: Write the failing test**

Create `server/test/whitelist.test.ts`:

```ts
import { expect, test } from "vitest";
import {
  WHITELIST,
  WHITELIST_SET,
  buildWhitelistSet,
  isWhitelisted,
  type WhitelistEntry,
} from "../src/content-filter/signals/whitelist.js";

test("WHITELIST ships empty and well-formed", () => {
  expect(Array.isArray(WHITELIST)).toBe(true);
  expect(WHITELIST.length).toBe(0);
  expect(WHITELIST_SET.size).toBe(0);
});

test("buildWhitelistSet indexes composite (creatorDid, collectionId) keys", () => {
  const entries: WhitelistEntry[] = [
    { creatorDid: "did:chia:aaa", collectionId: "col1aaa" },
    { creatorDid: "did:chia:bbb", collectionId: "col1bbb", note: "official mint" },
  ];
  const set = buildWhitelistSet(entries);
  expect(isWhitelisted(set, "did:chia:aaa", "col1aaa")).toBe(true);
  expect(isWhitelisted(set, "did:chia:bbb", "col1bbb")).toBe(true);
});

test("isWhitelisted requires both fields to match together (composite key)", () => {
  const set = buildWhitelistSet([{ creatorDid: "did:chia:aaa", collectionId: "col1aaa" }]);
  expect(isWhitelisted(set, "did:chia:aaa", "col1bbb")).toBe(false); // right DID, wrong collection
  expect(isWhitelisted(set, "did:chia:zzz", "col1aaa")).toBe(false); // right collection, wrong DID
});

test("isWhitelisted returns false when either field is missing", () => {
  const set = buildWhitelistSet([{ creatorDid: "did:chia:aaa", collectionId: "col1aaa" }]);
  expect(isWhitelisted(set, undefined, "col1aaa")).toBe(false);
  expect(isWhitelisted(set, "did:chia:aaa", undefined)).toBe(false);
  expect(isWhitelisted(set, undefined, undefined)).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/test/whitelist.test.ts`
Expected: FAIL — `Cannot find module '../src/content-filter/signals/whitelist.js'`

- [ ] **Step 3: Write minimal implementation**

Create `server/src/content-filter/signals/whitelist.ts`:

```ts
/** One curated allow-list entry, keyed by (creator DID, collection id). */
export interface WhitelistEntry {
  creatorDid: string;
  collectionId: string;
  note?: string;
}

/**
 * Curated allow-list of known-safe collections. Ships empty; populated via PR.
 * A match never overrides a negative cheap-signal result (lexicon, denylist,
 * sensitive_content, MintGarden moderation) — see mapMintgardenSignals. Its
 * only effect is to skip the Google Vision SafeSearch check for a collection
 * whose cheap verdict is already "ok", saving Vision calls on large,
 * well-known, unambiguously safe mints.
 */
export const WHITELIST: WhitelistEntry[] = [];

/** Composite key: collection ids are unique on MintGarden, but keying on the
 *  creator DID too guards against acting on a bare collection id alone. */
function key(creatorDid: string, collectionId: string): string {
  return `${creatorDid}::${collectionId}`;
}

/** Index entries into a Set of composite keys for O(1) lookup. */
export function buildWhitelistSet(entries: WhitelistEntry[]): Set<string> {
  const set = new Set<string>();
  for (const entry of entries) set.add(key(entry.creatorDid, entry.collectionId));
  return set;
}

export const WHITELIST_SET: Set<string> = buildWhitelistSet(WHITELIST);

/** True when both the creator DID and collection id are present and match a
 *  whitelist entry together. */
export function isWhitelisted(
  set: Set<string>,
  creatorDid: string | undefined,
  collectionId: string | undefined
): boolean {
  if (creatorDid === undefined || collectionId === undefined) return false;
  return set.has(key(creatorDid, collectionId));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/test/whitelist.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/content-filter/signals/whitelist.ts server/test/whitelist.test.ts
git commit -m "Add curated NFT collection whitelist data module"
```

---

### Task 2: Wire the allow-list into `mapMintgardenSignals` precedence

**Files:**

- Modify: `server/src/content-filter/types.ts`
- Modify: `server/src/content-filter/signals/mintgarden.ts`
- Test: `server/test/content-filter.test.ts`

**Interfaces:**

- Consumes: `buildWhitelistSet`, `isWhitelisted`, `WHITELIST_SET` from Task 1 (`../src/content-filter/signals/whitelist.js`).
- Produces: `Verdict { disposition: Disposition; whitelisted?: boolean }`; `MapMintgardenOpts` gains `whitelist?: Set<string>`; `mapMintgardenSignals` consults the allow-list last, only when the combined disposition from every other signal is already `"ok"`.

- [ ] **Step 1: Write the failing tests**

Add to `server/test/content-filter.test.ts`, near the existing `mapMintgardenSignals` tests (after the "mapMintgardenSignals clean json returns ok" test around line 304), and add `buildWhitelistSet` to the existing import block at the top of the file:

```ts
import { buildWhitelistSet } from "../src/content-filter/signals/whitelist.js";
```

```ts
test("mapMintgardenSignals: allow-list match on an otherwise-clean NFT sets whitelisted", () => {
  const whitelist = buildWhitelistSet([{ creatorDid: "did:chia:good", collectionId: "col_good" }]);
  const v = mapMintgardenSignals(
    { creator: { encoded_id: "did:chia:good" }, collection: { id: "col_good" } },
    { whitelist }
  );
  expect(v).toEqual({ disposition: "ok", whitelisted: true });
});

test("mapMintgardenSignals: allow-list does not suppress a lexicon hit", () => {
  const whitelist = buildWhitelistSet([{ creatorDid: "did:chia:good", collectionId: "col_good" }]);
  const v = mapMintgardenSignals(
    {
      name: "explicit piece",
      creator: { encoded_id: "did:chia:good" },
      collection: { id: "col_good" },
    },
    { whitelist }
  );
  expect(v).toEqual({ disposition: "sensitive" });
});

test("mapMintgardenSignals: allow-list does not suppress a denylist entry", () => {
  const whitelist = buildWhitelistSet([{ creatorDid: "did:chia:good", collectionId: "col_good" }]);
  const denylist = buildDenylistMap([{ collectionId: "col_good", disposition: "blocked" }]);
  const v = mapMintgardenSignals(
    { creator: { encoded_id: "did:chia:good" }, collection: { id: "col_good" } },
    { whitelist, denylist }
  );
  expect(v).toEqual({ disposition: "blocked" });
});

test("mapMintgardenSignals: allow-list does not suppress a sensitive_content flag", () => {
  const whitelist = buildWhitelistSet([{ creatorDid: "did:chia:good", collectionId: "col_good" }]);
  const v = mapMintgardenSignals(
    {
      creator: { encoded_id: "did:chia:good" },
      collection: { id: "col_good", sensitive_content: true },
    },
    { whitelist }
  );
  expect(v).toEqual({ disposition: "sensitive" });
});

test("mapMintgardenSignals: allow-list does not suppress MintGarden authoritative blocked", () => {
  const whitelist = buildWhitelistSet([{ creatorDid: "did:chia:good", collectionId: "col_good" }]);
  const v = mapMintgardenSignals(
    { is_blocked: true, creator: { encoded_id: "did:chia:good" }, collection: { id: "col_good" } },
    { whitelist }
  );
  expect(v).toEqual({ disposition: "blocked" });
});

test("mapMintgardenSignals: partial match (collection id only, different creator) is not whitelisted", () => {
  const whitelist = buildWhitelistSet([{ creatorDid: "did:chia:good", collectionId: "col_good" }]);
  const v = mapMintgardenSignals(
    { creator: { encoded_id: "did:chia:other" }, collection: { id: "col_good" } },
    { whitelist }
  );
  expect(v).toEqual({ disposition: "ok" });
});
```

`buildDenylistMap` is already imported in this file (line 9).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/test/content-filter.test.ts`
Expected: FAIL — `mapMintgardenSignals` returns `{ disposition: "ok" }` (no `whitelisted` field) for the first test; `MapMintgardenOpts` has no `whitelist` property (TS error) until Step 3.

- [ ] **Step 3: Implement**

Modify `server/src/content-filter/types.ts` (full file):

```ts
export type Disposition = "blocked" | "sensitive" | "ok";

export interface Verdict {
  disposition: Disposition;
  /** True when an allow-list match (creator DID + collection id) resolved
   *  this "ok" verdict; used to skip the Vision SafeSearch check. Never set
   *  when disposition is not "ok" — the allow-list cannot override a
   *  negative signal. */
  whitelisted?: boolean;
}
```

Modify `server/src/content-filter/signals/mintgarden.ts`:

Change the import block (lines 1-4) to add the whitelist import:

```ts
import type { Disposition, Verdict } from "../types.js";
import { combine } from "../verdict.js";
import { LEXICON, matchesLexicon } from "./lexicon.js";
import { DENYLIST_MAP, dispositionForCollection } from "./denylist.js";
import { WHITELIST_SET, isWhitelisted } from "./whitelist.js";
```

Change `MapMintgardenOpts` (lines 23-28) to add the `whitelist` field:

```ts
export interface MapMintgardenOpts {
  /** Override the adult-term lexicon (test injection). Defaults to LEXICON. */
  lexicon?: string[];
  /** Override the collection denylist map (test injection). Defaults to DENYLIST_MAP. */
  denylist?: Map<string, Disposition>;
  /** Override the collection allow-list (test injection). Defaults to WHITELIST_SET. */
  whitelist?: Set<string>;
}
```

Replace the body of `mapMintgardenSignals` (lines 35-75) with:

```ts
export function mapMintgardenSignals(json: unknown, opts: MapMintgardenOpts = {}): Verdict {
  const lexicon = opts.lexicon ?? LEXICON;
  const denylist = opts.denylist ?? DENYLIST_MAP;
  const whitelist = opts.whitelist ?? WHITELIST_SET;

  const nft = asRecord(json);
  const collection = asRecord(nft.collection);
  const creator = asRecord(nft.creator);
  const metadata = asRecord(asRecord(nft.data).metadata_json);

  const parts: Array<{ disposition: Disposition }> = [];

  // creator verification → hard block
  if (creator.verification_state === 2) {
    parts.push({ disposition: "blocked" });
  }

  // MintGarden collection-level flags
  if (nft.is_blocked === true || collection.blocked_content === true) {
    parts.push({ disposition: "blocked" });
  } else if (isSensitiveFlag(collection.sensitive_content)) {
    parts.push({ disposition: "sensitive" });
  }

  // CHIP-0007 off-chain metadata sensitive_content
  if (isSensitiveFlag(metadata.sensitive_content)) {
    parts.push({ disposition: "sensitive" });
  }

  // curated collection denylist
  const collectionId = typeof collection.id === "string" ? collection.id : undefined;
  const deny = dispositionForCollection(denylist, collectionId);
  if (deny) parts.push({ disposition: deny });

  // text-keyword heuristic over name / collection name / description
  const text = [nft.name, metadata.name, collection.name, metadata.description]
    .filter((s): s is string => typeof s === "string")
    .join(" ");
  if (matchesLexicon(text, lexicon)) parts.push({ disposition: "sensitive" });

  const verdict = combine(parts);

  // Curated allow-list: consulted last, only once every other signal has
  // already resolved to "ok". Never overrides a blocked/sensitive result —
  // it exists purely to skip the Vision SafeSearch check for known-safe
  // collections (see whitelist.ts).
  if (verdict.disposition === "ok") {
    const creatorDid = typeof creator.encoded_id === "string" ? creator.encoded_id : undefined;
    if (isWhitelisted(whitelist, creatorDid, collectionId)) {
      return { disposition: "ok", whitelisted: true };
    }
  }

  return verdict;
}
```

Everything below this function (`mapMintgarden` and `extractContentHash`) is unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/test/content-filter.test.ts`
Expected: PASS (all tests in the file, including the 6 new ones)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add server/src/content-filter/types.ts server/src/content-filter/signals/mintgarden.ts server/test/content-filter.test.ts
git commit -m "Consult NFT collection allow-list last in cheap-signal precedence"
```

---

### Task 3: `ContentStore.putCheap` gains a SafeSearch-skip flag

**Files:**

- Modify: `server/src/content-filter/store.ts`
- Test: `server/test/content-store.test.ts`

**Interfaces:**

- Consumes: `Verdict` (now with optional `whitelisted`) from Task 2.
- Produces: `ContentStore.putCheap(launcherId, nftId, verdict, contentHash?, skipSafesearch?: boolean): void` — when `skipSafesearch` is true, the row's `safesearch_checked_at` is stamped at insert time (as if already Vision-checked), without ever calling Vision.

- [ ] **Step 1: Write the failing tests**

Add to `server/test/content-store.test.ts`, after the first test ("putCheap then get round-trips disposition, safesearch not yet checked", lines 8-17) — anywhere in the file is fine, but keep it near the other `putCheap` tests for readability:

```ts
test("putCheap with skipSafesearch stamps safesearchChecked immediately", () => {
  const store = new ContentStore(":memory:");
  store.putCheap("lid4", "nft1d", { disposition: "ok", whitelisted: true }, undefined, true);
  const v = store.get("lid4");
  expect(v?.disposition).toBe("ok");
  expect(v?.safesearchChecked).toBe(true);
  store.close();
});

test("putCheap without skipSafesearch does not clobber an already-stamped safesearchChecked", () => {
  const store = new ContentStore(":memory:");
  store.putCheap("lid5", "nft1e", { disposition: "ok" }, undefined, true);
  // a later re-spend re-runs putCheap without the flag (e.g. cache-miss path) —
  // must not un-stamp a row that was already marked checked
  store.putCheap("lid5", "nft1e", { disposition: "ok" });
  const v = store.get("lid5");
  expect(v?.safesearchChecked).toBe(true);
  store.close();
});

test("putCheap without skipSafesearch on a fresh row leaves safesearchChecked false", () => {
  const store = new ContentStore(":memory:");
  store.putCheap("lid6", "nft1f", { disposition: "ok" });
  const v = store.get("lid6");
  expect(v?.safesearchChecked).toBe(false);
  store.close();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/test/content-store.test.ts`
Expected: FAIL — TS error, `putCheap` does not accept a 5th argument; first test's `v?.safesearchChecked` is `false` instead of the expected `true`.

- [ ] **Step 3: Implement**

Modify `server/src/content-filter/store.ts`, replacing the `putCheap` method (current lines 70-87):

```ts
  putCheap(
    launcherId: string,
    nftId: string | undefined,
    verdict: Verdict,
    contentHash?: string,
    skipSafesearch?: boolean
  ): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO nft (launcher_id, nft_id, disposition, content_hash, checked_at, safesearch_checked_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(launcher_id) DO UPDATE SET
           nft_id = excluded.nft_id,
           disposition = excluded.disposition,
           content_hash = COALESCE(excluded.content_hash, nft.content_hash),
           checked_at = excluded.checked_at,
           safesearch_checked_at = COALESCE(nft.safesearch_checked_at, excluded.safesearch_checked_at)`
      )
      .run(
        launcherId,
        nftId ?? null,
        verdict.disposition,
        contentHash ?? null,
        now,
        skipSafesearch ? now : null
      );
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/test/content-store.test.ts`
Expected: PASS (all tests in the file, including the 3 new ones)

- [ ] **Step 5: Run the full content-filter test file too** (it also exercises `putCheap`)

Run: `npx vitest run server/test/content-filter.test.ts`
Expected: PASS (unchanged — `putCheap` is still called the same way for the non-whitelisted path)

- [ ] **Step 6: Commit**

```bash
git add server/src/content-filter/store.ts server/test/content-store.test.ts
git commit -m "Add skipSafesearch flag to ContentStore.putCheap"
```

---

### Task 4: Thread the allow-list through `ContentFilter`, skip Vision end-to-end

**Files:**

- Modify: `server/src/content-filter/index.ts`
- Modify: `server/CLAUDE.md`
- Test: `server/test/content-filter.test.ts`

**Interfaces:**

- Consumes: `mapMintgardenSignals(json, { whitelist })` from Task 2; `store.putCheap(launcherId, nftId, verdict, contentHash, skipSafesearch)` from Task 3.
- Produces: `ContentFilterOptions.whitelist?: Set<string>` (test/config injection, defaults to `WHITELIST_SET` inside `mapMintgardenSignals`); whitelisted NFTs are persisted with `safesearch_checked_at` already stamped, so `SafeSearchWorker` never enqueues them.

- [ ] **Step 1: Write the failing tests**

Add to `server/test/content-filter.test.ts`, after the existing "enrich queues SafeSearch for a clean image mint and emits a flag" test (around line 420):

```ts
test("enrich skips SafeSearch entirely for a whitelisted collection", async () => {
  const media = new MediaIndex(10);
  media.set("Wl", { url: "https://e/w.png", kind: "image" });
  const store = new ContentStore(":memory:");
  const flags: import("@grove/shared").ContentFlagEvent[] = [];
  let visionCalls = 0;
  const whitelist = buildWhitelistSet([{ creatorDid: "did:chia:good", collectionId: "col_good" }]);
  const filter = new ContentFilter(media, {
    store,
    googleApiKey: "k",
    onFlag: (e) => flags.push(e),
    whitelist,
    fetchImpl: (async (url: string) => {
      if (String(url).includes("images:annotate")) {
        visionCalls++;
        return new Response(
          JSON.stringify({ responses: [{ safeSearchAnnotation: { adult: "VERY_LIKELY" } }] }),
          { status: 200 }
        );
      }
      return okJson({ creator: { encoded_id: "did:chia:good" }, collection: { id: "col_good" } });
    }) as typeof fetch,
  });
  const event: SproutEvent = {
    type: "sprout",
    kind: "nft",
    height: 1,
    coinId: "c",
    amount: "1",
    mint: true,
    launcherId: "Wl",
    nftId: "nft1w",
    mediaKind: "image",
  };
  await filter.enrich([event]);
  await tick();
  expect(event.mediaFilter).toBeUndefined();
  expect(visionCalls).toBe(0);
  expect(flags).toEqual([]);
  expect(store.get("Wl")?.safesearchChecked).toBe(true);
  store.close();
});

test("enrich still runs SafeSearch when the NFT is not on the allow-list", async () => {
  const media = new MediaIndex(10);
  media.set("Nw", { url: "https://e/n.png", kind: "image" });
  const store = new ContentStore(":memory:");
  let visionCalls = 0;
  const whitelist = buildWhitelistSet([{ creatorDid: "did:chia:good", collectionId: "col_good" }]);
  const filter = new ContentFilter(media, {
    store,
    googleApiKey: "k",
    onFlag: () => {},
    whitelist,
    fetchImpl: (async (url: string) => {
      if (String(url).includes("images:annotate")) {
        visionCalls++;
        return new Response(
          JSON.stringify({ responses: [{ safeSearchAnnotation: { adult: "UNLIKELY" } }] }),
          { status: 200 }
        );
      }
      // different creator/collection than the whitelist entry above
      return okJson({ creator: { encoded_id: "did:chia:other" }, collection: { id: "col_other" } });
    }) as typeof fetch,
  });
  const event: SproutEvent = {
    type: "sprout",
    kind: "nft",
    height: 1,
    coinId: "c",
    amount: "1",
    mint: true,
    launcherId: "Nw",
    nftId: "nft1n",
    mediaKind: "image",
  };
  await filter.enrich([event]);
  await tick();
  expect(visionCalls).toBe(1);
  store.close();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/test/content-filter.test.ts`
Expected: FAIL — TS error, `ContentFilterOptions` has no `whitelist` property; even once that compiles, `visionCalls` would be `1` instead of `0` in the first new test.

- [ ] **Step 3: Implement**

Modify `server/src/content-filter/index.ts`:

Add `whitelist` to `ContentFilterOptions` (after `archiveCheckDelayMs?: number;`, before `store?: ContentStore;`):

```ts
  /** Milliseconds to wait between Archive poll attempts. */
  archiveCheckDelayMs?: number;
  /** Override the collection allow-list used by the cheap-signal check (test
   *  injection); passed through to mapMintgardenSignals, which defaults to
   *  WHITELIST_SET when this is undefined. */
  whitelist?: Set<string>;
  /** Persistent verdict store keyed by launcherId; a hit skips the MintGarden network fetch. */
  store?: ContentStore;
```

Add a private field (after `private readonly archiveBaseUrl: string;`):

```ts
  private readonly archiveBaseUrl: string;
  private readonly whitelist?: Set<string>;
  private readonly store?: ContentStore;
```

Set it in the constructor (after the `this.archiveBaseUrl = ...` line):

```ts
this.archiveBaseUrl = opts.archiveBaseUrl ?? "https://archive.mintgarden.io";
this.whitelist = opts.whitelist;
```

Change `fetchVerdict` to pass the whitelist through:

```ts
  private async fetchVerdict(nftId: string): Promise<FetchResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/nfts/${nftId}`, {
        signal: controller.signal,
      });
      if (res.status === 404) return { verdict: { disposition: "ok" } }; // genuinely unknown to MintGarden → cacheable permissive
      if (!res.ok) throw new Error(`mintgarden ${res.status}`); // 5xx/429/etc → transient, don't poison the cache
      const json = await res.json();
      return {
        verdict: mapMintgardenSignals(json, { whitelist: this.whitelist }),
        contentHash: extractContentHash(json),
      };
    } finally {
      clearTimeout(timer);
    }
  }
```

Change the `putCheap` call inside `apply()` to thread the flag through:

```ts
if (!stored && launcherId) {
  try {
    this.store?.putCheap(launcherId, event.nftId, verdict, contentHash, verdict.whitelisted);
  } catch (err) {
    log.warn({ err }, "content-filter store.putCheap failed (verdict not persisted)");
  }
}
```

(This is the only change inside `apply()` — the `this.worker?.maybeEnqueue(event)` call a few lines below is unchanged; `SafeSearchWorker.tryEnqueue()` already re-reads the store and bails on `stored.safesearchChecked`, which the line above just made `true`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/test/content-filter.test.ts`
Expected: PASS (all tests in the file, including the 2 new ones)

- [ ] **Step 5: Run the full test suite, typecheck, and lint**

Run: `npm test`
Expected: PASS (all files)

Run: `npm run typecheck`
Expected: no errors

Run: `npm run lint`
Expected: no errors

- [ ] **Step 6: Update documentation**

Modify `server/CLAUDE.md`, in the `ContentFilter` bullet, change:

```
1. _Cheap signals_ inline — lexicon, CHIP-7 `sensitive_content` flag, MintGarden collection/creator flags, curated denylist — stamps `mediaFilter` and `signals?: string[]` on NFT `SproutEvent`s immediately.
```

to:

```
1. _Cheap signals_ inline — lexicon, CHIP-7 `sensitive_content` flag, MintGarden collection/creator flags, curated denylist, curated collection allow-list (`signals/whitelist.ts`, keyed by creator DID + collection id) — stamps `mediaFilter` on NFT `SproutEvent`s immediately. The allow-list never overrides a blocked/sensitive signal; a match only skips the Vision SafeSearch tier below for known-safe collections.
```

- [ ] **Step 7: Commit**

```bash
git add server/src/content-filter/index.ts server/test/content-filter.test.ts server/CLAUDE.md
git commit -m "Skip SafeSearch for whitelisted NFT collections"
```
