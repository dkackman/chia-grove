# SafeSearch + Extractable Content-Filter Module — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google Vision SafeSearch as an out-of-band content-filter signal (adult `LIKELY`/`VERY_LIKELY` → sensitive) and relocate the filter into a self-contained, SQLite-backed `server/src/content-filter/` module that could be lifted into a separate project later.

**Architecture:** Cheap signals (lexicon, CHIP-7, MintGarden collection/creator/denylist) run inline as today and stamp `mediaFilter` + a new `signals[]` provenance array on the `SproutEvent`. SafeSearch runs async, fire-and-forget, only when the cheap verdict is `ok`, on image mints; its later verdict is persisted in SQLite and pushed to clients as a new lightweight `content-flag` event over the existing Hub. All verdicts persist per `launcherId` in SQLite so an NFT is classified at most once.

**Tech Stack:** TypeScript (ESM, NodeNext), Node ≥ 24, Fastify, `node:sqlite` (built-in), Vitest, Three.js (web).

## Global Constraints

- Node ≥ 24 (the repo already requires it; `node:sqlite` depends on it).
- No new runtime dependencies — use built-in `node:sqlite` and `fetch`; do **not** add `@google-cloud/vision` or `better-sqlite3`.
- ESM with explicit `.js` import extensions (NodeNext), matching the codebase.
- The `content-filter/` module imports only `@grove/shared` types and `../web/media-index.js` — no other grove internals.
- `Disposition = "blocked" | "sensitive" | "ok"`; `blocked > sensitive > ok`. SafeSearch only ever yields `sensitive`, never `blocked`.
- SafeSearch auth: REST `images:annotate` with an API key (`GOOGLE_VISION_API_KEY`); Google fetches the image URI — we never download bytes.
- Per-task: run `npm run typecheck` and the relevant `npx vitest run <file>` before committing; full `npm test` at the end.
- Commit messages end with the repo's `Co-Authored-By` trailer is NOT required here; use plain conventional-commit subjects as the repo does.

---

## File Structure

**New (`server/src/content-filter/`):**

- `types.ts` — `Disposition`, `SignalName`, `Verdict`.
- `verdict.ts` — `strongest()`, `combine()`.
- `signals/lexicon.ts` — moved from `classify/lexicon.ts`.
- `signals/denylist.ts` — moved from `classify/denylist.ts`.
- `signals/mintgarden.ts` — signal-aware MintGarden mapping (`mapMintgardenSignals`, plus thin `mapMintgarden`).
- `signals/safesearch.ts` — pure Vision REST query + likelihood→disposition.
- `safesearch-worker.ts` — bounded-concurrency async queue; writes store + emits flags.
- `store.ts` — `ContentStore` (SQLite, keyed by `launcherId`).
- `index.ts` — `ContentFilter` (moved from `classify/content-filter.ts`), now SQLite-backed + SafeSearch-aware.

**Modified:**

- `shared/src/index.ts` — `signals?` on `SproutEvent`, new `ContentFlagEvent`, `PROTOCOL_VERSION` 3→4.
- `server/src/index.ts` — construct `ContentFilter` with `onFlag`/`googleApiKey`/`dbPath`.
- Web: `themes/gallery/pieces.ts`, `themes/gallery/gallery.ts`, `themes/mine/structures.ts`, `themes/mine/mine.ts`, `themes/mine/index.ts`, `ui/detail-card.ts`, `net/demo.ts`.
- `.gitignore`, `CLAUDE.md`.

**Deleted:** `server/src/classify/content-filter.ts`, `classify/lexicon.ts`, `classify/denylist.ts`.

---

## Task 1: Relocate the filter into `server/src/content-filter/` (pure move)

No behavior change. Just move three files and fix import paths so the suite stays green.

**Files:**

- Move: `server/src/classify/content-filter.ts` → `server/src/content-filter/index.ts`
- Move: `server/src/classify/lexicon.ts` → `server/src/content-filter/signals/lexicon.ts`
- Move: `server/src/classify/denylist.ts` → `server/src/content-filter/signals/denylist.ts`
- Modify: `server/src/index.ts`, `server/test/content-filter.test.ts`, `server/test/lexicon.test.ts`, `server/test/denylist.test.ts`

**Interfaces:**

- Produces: same public API as today — `ContentFilter`, `mapMintgarden`, from `server/src/content-filter/index.js`; `LEXICON`/`matchesLexicon` from `signals/lexicon.js`; `DENYLIST_MAP`/`buildDenylistMap`/`dispositionForCollection`/`DenylistEntry` from `signals/denylist.js`.

- [ ] **Step 1: Move the files with git**

```bash
cd /Users/don/src/dkackman/chia-grove
mkdir -p server/src/content-filter/signals
git mv server/src/classify/content-filter.ts server/src/content-filter/index.ts
git mv server/src/classify/lexicon.ts        server/src/content-filter/signals/lexicon.ts
git mv server/src/classify/denylist.ts       server/src/content-filter/signals/denylist.ts
```

- [ ] **Step 2: Fix imports inside the moved files**

In `server/src/content-filter/index.ts` update the two signal imports (the `../web/media-index.js` import is already correct — `content-filter/` is a sibling of `web/`):

```ts
import { LEXICON, matchesLexicon } from "./signals/lexicon.js";
import { DENYLIST_MAP, dispositionForCollection } from "./signals/denylist.js";
```

In `server/src/content-filter/signals/denylist.ts` change the `Disposition` import to point up to the (moved) index:

```ts
import type { Disposition } from "../index.js";
```

(`signals/lexicon.ts` has no internal imports — leave it.)

- [ ] **Step 3: Fix imports in `server/src/index.ts`**

```ts
import { ContentFilter } from "./content-filter/index.js";
```

- [ ] **Step 4: Fix imports in the three test files**

`server/test/content-filter.test.ts`:

```ts
import { mapMintgarden } from "../src/content-filter/index.js";
import { ContentFilter } from "../src/content-filter/index.js";
import { MediaIndex } from "../src/web/media-index.js";
import { buildDenylistMap } from "../src/content-filter/signals/denylist.js";
```

`server/test/lexicon.test.ts`: change `../src/classify/lexicon.js` → `../src/content-filter/signals/lexicon.js`.

`server/test/denylist.test.ts`: change `../src/classify/denylist.js` → `../src/content-filter/signals/denylist.js` (and any `../src/classify/content-filter.js` → `../src/content-filter/index.js`).

- [ ] **Step 5: Verify nothing else references the old paths**

Run: `cd /Users/don/src/dkackman/chia-grove && grep -rn "classify/content-filter\|classify/lexicon\|classify/denylist" server`
Expected: no output.

- [ ] **Step 6: Typecheck and test**

Run: `npm run typecheck && npx vitest run server/test/content-filter.test.ts server/test/lexicon.test.ts server/test/denylist.test.ts`
Expected: typecheck clean; all three test files PASS (unchanged behavior).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: relocate content filter into server/src/content-filter module"
```

---

## Task 2: Signal provenance — `types.ts`, `verdict.ts`, signal-aware MintGarden, `signals[]` on the stream

Break the MintGarden mapping into a `Verdict { disposition, signals[] }` and stamp `signals[]` onto NFT sprout events. `blocked` stays distinct.

**Files:**

- Create: `server/src/content-filter/types.ts`
- Create: `server/src/content-filter/verdict.ts`
- Create: `server/src/content-filter/signals/mintgarden.ts`
- Modify: `server/src/content-filter/index.ts` (resolve→Verdict, apply stamps signals)
- Modify: `shared/src/index.ts` (`signals?` on `SproutEvent`)
- Test: `server/test/content-filter.test.ts` (extend), `server/test/verdict.test.ts` (new)

**Interfaces:**

- Produces:
  - `types.ts`: `type Disposition = "blocked" | "sensitive" | "ok"`; `type SignalName = "chip7" | "mintgarden" | "mintgarden-creator" | "denylist" | "lexicon" | "safesearch"`; `interface Verdict { disposition: Disposition; signals: SignalName[] }`.
  - `verdict.ts`: `strongest(...ds: Disposition[]): Disposition`; `combine(parts: Array<{ disposition: Disposition; signal: SignalName }>): Verdict`.
  - `signals/mintgarden.ts`: `mapMintgardenSignals(json: unknown, opts?: MapMintgardenOpts): Verdict`; `mapMintgarden(json: unknown, opts?: MapMintgardenOpts): Disposition` (= `.disposition`); `interface MapMintgardenOpts { lexicon?: string[]; denylist?: Map<string, Disposition> }`.
- Consumes (later tasks): `SproutEvent.signals?: string[]`.

- [ ] **Step 1: Write the failing test for `verdict.ts`**

Create `server/test/verdict.test.ts`:

```ts
import { expect, test } from "vitest";
import { strongest, combine } from "../src/content-filter/verdict.js";

test("strongest picks blocked over sensitive over ok", () => {
  expect(strongest("ok", "sensitive", "blocked")).toBe("blocked");
  expect(strongest("ok", "sensitive")).toBe("sensitive");
  expect(strongest("ok", "ok")).toBe("ok");
  expect(strongest()).toBe("ok");
});

test("combine reports disposition and only the signals that fired", () => {
  const v = combine([
    { disposition: "ok", signal: "chip7" },
    { disposition: "sensitive", signal: "lexicon" },
    { disposition: "blocked", signal: "denylist" },
  ]);
  expect(v.disposition).toBe("blocked");
  expect(v.signals).toEqual(["lexicon", "denylist"]);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run server/test/verdict.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Create `types.ts` and `verdict.ts`**

`server/src/content-filter/types.ts`:

```ts
export type Disposition = "blocked" | "sensitive" | "ok";

export type SignalName =
  "chip7" | "mintgarden" | "mintgarden-creator" | "denylist" | "lexicon" | "safesearch";

export interface Verdict {
  disposition: Disposition;
  signals: SignalName[];
}
```

`server/src/content-filter/verdict.ts`:

```ts
import type { Disposition, SignalName, Verdict } from "./types.js";

const RANK: Record<Disposition, number> = { ok: 0, sensitive: 1, blocked: 2 };

/** Strongest disposition under `blocked > sensitive > ok`. */
export const strongest = (...ds: Disposition[]): Disposition =>
  ds.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "ok");

/** Collapse per-signal dispositions into a combined verdict + the names that fired. */
export function combine(parts: Array<{ disposition: Disposition; signal: SignalName }>): Verdict {
  const disposition = strongest(...parts.map((p) => p.disposition));
  const signals = parts.filter((p) => p.disposition !== "ok").map((p) => p.signal);
  return { disposition, signals };
}
```

- [ ] **Step 4: Run the verdict test**

Run: `npx vitest run server/test/verdict.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for signal-aware MintGarden**

Append to `server/test/content-filter.test.ts`:

```ts
import { mapMintgardenSignals } from "../src/content-filter/index.js";

test("mapMintgardenSignals reports which signals fired", () => {
  const v = mapMintgardenSignals({
    name: "totally nsfw piece",
    collection: { sensitive_content: true },
    creator: { verification_state: 2 },
  });
  expect(v.disposition).toBe("blocked"); // creator verification wins
  expect(v.signals.sort()).toEqual(["lexicon", "mintgarden", "mintgarden-creator"].sort());
});

test("mapMintgardenSignals chip7 metadata sensitive_content fires chip7", () => {
  const v = mapMintgardenSignals({ data: { metadata_json: { sensitive_content: "nudity" } } });
  expect(v.disposition).toBe("sensitive");
  expect(v.signals).toEqual(["chip7"]);
});

test("mapMintgardenSignals clean json fires nothing", () => {
  const v = mapMintgardenSignals({ name: "a calm landscape" });
  expect(v).toEqual({ disposition: "ok", signals: [] });
});
```

- [ ] **Step 6: Run it to confirm it fails**

Run: `npx vitest run server/test/content-filter.test.ts`
Expected: FAIL (`mapMintgardenSignals` is not exported).

- [ ] **Step 7: Create `signals/mintgarden.ts`**

`server/src/content-filter/signals/mintgarden.ts`:

```ts
import type { Disposition, SignalName, Verdict } from "../types.js";
import { combine } from "../verdict.js";
import { LEXICON, matchesLexicon } from "./lexicon.js";
import { DENYLIST_MAP, dispositionForCollection } from "./denylist.js";

const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};

/**
 * sensitive_content per CHIP-0007 may be boolean, a string, or a non-empty list.
 * A bare descriptive string (e.g. "nudity") flags as sensitive too; only the
 * explicit negatives ("" / "false") and a literal `false` are treated as clear.
 */
const isSensitiveFlag = (v: unknown): boolean => {
  if (v === true) return true;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s !== "" && s !== "false";
  }
  return Array.isArray(v) && v.length > 0;
};

export interface MapMintgardenOpts {
  /** Override the adult-term lexicon (test injection). Defaults to LEXICON. */
  lexicon?: string[];
  /** Override the collection denylist map (test injection). Defaults to DENYLIST_MAP. */
  denylist?: Map<string, Disposition>;
}

/**
 * Collapse a MintGarden GET /nfts/:id response into a Verdict, reporting which
 * of the cheap signals fired. Blocked (hard takedown) wins over sensitive (NSFW).
 * Anything unrecognized or malformed contributes nothing (permissive).
 */
export function mapMintgardenSignals(json: unknown, opts: MapMintgardenOpts = {}): Verdict {
  const lexicon = opts.lexicon ?? LEXICON;
  const denylist = opts.denylist ?? DENYLIST_MAP;

  const nft = asRecord(json);
  const collection = asRecord(nft.collection);
  const creator = asRecord(nft.creator);
  const metadata = asRecord(asRecord(nft.data).metadata_json);

  const parts: Array<{ disposition: Disposition; signal: SignalName }> = [];

  // creator verification → hard block
  if (creator.verification_state === 2) {
    parts.push({ disposition: "blocked", signal: "mintgarden-creator" });
  }

  // MintGarden collection-level flags
  if (nft.is_blocked === true || collection.blocked_content === true) {
    parts.push({ disposition: "blocked", signal: "mintgarden" });
  } else if (isSensitiveFlag(collection.sensitive_content)) {
    parts.push({ disposition: "sensitive", signal: "mintgarden" });
  }

  // CHIP-0007 off-chain metadata sensitive_content
  if (isSensitiveFlag(metadata.sensitive_content)) {
    parts.push({ disposition: "sensitive", signal: "chip7" });
  }

  // curated collection denylist
  const collectionId = typeof collection.id === "string" ? collection.id : undefined;
  const deny = dispositionForCollection(denylist, collectionId);
  if (deny) parts.push({ disposition: deny, signal: "denylist" });

  // text-keyword heuristic over name / collection name / description
  const text = [nft.name, metadata.name, collection.name, metadata.description]
    .filter((s): s is string => typeof s === "string")
    .join(" ");
  if (matchesLexicon(text, lexicon)) parts.push({ disposition: "sensitive", signal: "lexicon" });

  return combine(parts);
}

/** Disposition-only convenience (back-compat with existing call sites/tests). */
export function mapMintgarden(json: unknown, opts: MapMintgardenOpts = {}): Disposition {
  return mapMintgardenSignals(json, opts).disposition;
}
```

- [ ] **Step 8: Re-export from `index.ts` and delete the old in-file mapping**

In `server/src/content-filter/index.ts`: remove the in-file `asRecord`, `isSensitiveFlag`, `RANK`, `strongest`, `MapMintgardenOpts`, and `mapMintgarden` definitions (now living in `verdict.ts` / `signals/mintgarden.ts`), and re-export plus import what `ContentFilter` needs:

```ts
import type { GroveEvent, SproutEvent } from "@grove/shared";
import type { MediaIndex } from "../web/media-index.js";
import type { Disposition, Verdict } from "./types.js";
import { mapMintgardenSignals } from "./signals/mintgarden.js";

export type { Disposition } from "./types.js";
export { mapMintgarden, mapMintgardenSignals } from "./signals/mintgarden.js";
```

- [ ] **Step 9: Make `ContentFilter` resolve to a `Verdict` and stamp `signals[]`**

In `server/src/content-filter/index.ts`, change the cache/inflight types and the resolve/apply/fetch internals from `Disposition` to `Verdict`:

```ts
private readonly cache = new Map<string, Verdict>();
private readonly inflight = new Map<string, Promise<Verdict>>();
```

`apply()` — stamp both fields (key everything by `launcherId`, which every NFT sprout has):

```ts
private async apply(event: SproutEvent): Promise<void> {
  const verdict = await this.resolve(event.nftId!);
  if (verdict.disposition === "blocked") {
    event.mediaFilter = "blocked";
    if (event.launcherId) this.media.delete(event.launcherId);
  } else if (verdict.disposition === "sensitive") {
    event.mediaFilter = "sensitive";
  }
  if (verdict.signals.length > 0) event.signals = [...verdict.signals];
}
```

Update `resolve()`, `remember()`, the negative-cache fast path, and `fetchDisposition()` to carry `Verdict` instead of `Disposition`. The "ok" / negative-cache / 404 cases become `{ disposition: "ok", signals: [] }`; the success case becomes `mapMintgardenSignals(await res.json())`. Rename `fetchDisposition` → `fetchVerdict` for clarity.

For example, the negative-cache and catch branches:

```ts
const OK: Verdict = { disposition: "ok", signals: [] };
// ...
if (this.now() < until) return Promise.resolve(OK);
// ...
.catch(() => {
  this.rememberFailure(nftId);
  return OK;
})
```

and:

```ts
private async fetchVerdict(nftId: string): Promise<Verdict> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), this.timeoutMs);
  try {
    const res = await this.fetchImpl(`${this.baseUrl}/nfts/${nftId}`, { signal: controller.signal });
    if (res.status === 404) return { disposition: "ok", signals: [] };
    if (!res.ok) throw new Error(`mintgarden ${res.status}`);
    return mapMintgardenSignals(await res.json());
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 10: Add `signals?` to the shared `SproutEvent`**

In `shared/src/index.ts`, in `SproutEvent`, directly after the `mediaFilter` line:

```ts
  signals?: string[]; // which content-filter signals fired (e.g. ["lexicon","safesearch"]); provenance for mediaFilter
```

- [ ] **Step 11: Run the tests**

Run: `npx vitest run server/test/content-filter.test.ts server/test/verdict.test.ts && npm run typecheck`
Expected: PASS; typecheck clean. (Existing `mapMintgarden(...)` assertions still pass via the thin wrapper.)

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: report which content-filter signals fired via signals[]"
```

---

## Task 3: SQLite store, keyed by `launcherId`

Persist verdicts so an NFT is classified once across restarts, and so the SafeSearch path knows whether it has already run.

**Files:**

- Create: `server/src/content-filter/store.ts`
- Modify: `server/src/content-filter/index.ts` (consult/write the store on the cheap path)
- Test: `server/test/content-store.test.ts` (new)

**Interfaces:**

- Produces (`store.ts`):
  - `interface StoredVerdict { disposition: Disposition; signals: SignalName[]; safesearchChecked: boolean }`
  - `class ContentStore { constructor(dbPath: string); get(launcherId: string): StoredVerdict | undefined; putCheap(launcherId: string, nftId: string | undefined, verdict: Verdict): void; putSafeSearch(launcherId: string, result: { sensitive: boolean; adult: string; raw: unknown }): StoredVerdict; close(): void }`
- Consumes: `Verdict`, `Disposition`, `SignalName` from `./types.js`; `strongest` from `./verdict.js`.

- [ ] **Step 1: Write the failing store test**

Create `server/test/content-store.test.ts`:

```ts
import { expect, test } from "vitest";
import { ContentStore } from "../src/content-filter/store.js";

test("putCheap then get round-trips disposition + signals, safesearch not yet checked", () => {
  const store = new ContentStore(":memory:");
  store.putCheap("launch1", "nft1abc", { disposition: "sensitive", signals: ["lexicon"] });
  expect(store.get("launch1")).toEqual({
    disposition: "sensitive",
    signals: ["lexicon"],
    safesearchChecked: false,
  });
  expect(store.get("missing")).toBeUndefined();
  store.close();
});

test("putSafeSearch sensitive upgrades an ok row and records the check", () => {
  const store = new ContentStore(":memory:");
  store.putCheap("l", "nft1", { disposition: "ok", signals: [] });
  const updated = store.putSafeSearch("l", {
    sensitive: true,
    adult: "VERY_LIKELY",
    raw: { adult: "VERY_LIKELY" },
  });
  expect(updated.disposition).toBe("sensitive");
  expect(updated.signals).toEqual(["safesearch"]);
  expect(updated.safesearchChecked).toBe(true);
  expect(store.get("l")).toEqual(updated);
  store.close();
});

test("putSafeSearch ok marks checked without changing disposition", () => {
  const store = new ContentStore(":memory:");
  store.putCheap("l", "nft1", { disposition: "ok", signals: [] });
  const updated = store.putSafeSearch("l", { sensitive: false, adult: "UNLIKELY", raw: {} });
  expect(updated.disposition).toBe("ok");
  expect(updated.signals).toEqual([]);
  expect(updated.safesearchChecked).toBe(true);
  store.close();
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run server/test/content-store.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `store.ts`**

`server/src/content-filter/store.ts`:

```ts
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Disposition, SignalName, Verdict } from "./types.js";
import { strongest } from "./verdict.js";

export interface StoredVerdict {
  disposition: Disposition;
  signals: SignalName[];
  safesearchChecked: boolean;
}

interface Row {
  disposition: string;
  signals_json: string;
  safesearch_checked_at: number | null;
}

/**
 * Persistent per-NFT verdict cache, keyed by launcherId (stable across spends and
 * shared with the /img proxy + client). One row per NFT is the cache and the audit
 * trail; `safesearch_checked_at IS NULL` is the "SafeSearch not yet run" sentinel.
 */
export class ContentStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nft (
        launcher_id           TEXT PRIMARY KEY,
        nft_id                TEXT,
        disposition           TEXT NOT NULL,
        signals_json          TEXT NOT NULL,
        safesearch_adult      TEXT,
        safesearch_raw_json   TEXT,
        safesearch_checked_at INTEGER,
        checked_at            INTEGER NOT NULL
      );
    `);
  }

  get(launcherId: string): StoredVerdict | undefined {
    const row = this.db
      .prepare(
        "SELECT disposition, signals_json, safesearch_checked_at FROM nft WHERE launcher_id = ?"
      )
      .get(launcherId) as Row | undefined;
    if (!row) return undefined;
    return {
      disposition: row.disposition as Disposition,
      signals: JSON.parse(row.signals_json) as SignalName[],
      safesearchChecked: row.safesearch_checked_at !== null,
    };
  }

  putCheap(launcherId: string, nftId: string | undefined, verdict: Verdict): void {
    this.db
      .prepare(
        `INSERT INTO nft (launcher_id, nft_id, disposition, signals_json, checked_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(launcher_id) DO UPDATE SET
           nft_id = excluded.nft_id,
           disposition = excluded.disposition,
           signals_json = excluded.signals_json,
           checked_at = excluded.checked_at`
      )
      .run(
        launcherId,
        nftId ?? null,
        verdict.disposition,
        JSON.stringify(verdict.signals),
        Date.now()
      );
  }

  putSafeSearch(
    launcherId: string,
    result: { sensitive: boolean; adult: string; raw: unknown }
  ): StoredVerdict {
    const current = this.get(launcherId) ?? {
      disposition: "ok",
      signals: [],
      safesearchChecked: false,
    };
    const signals = result.sensitive
      ? Array.from(new Set([...current.signals, "safesearch" as SignalName]))
      : current.signals.filter((s) => s !== "safesearch");
    const disposition = result.sensitive
      ? strongest(current.disposition, "sensitive")
      : current.disposition;
    this.db
      .prepare(
        `INSERT INTO nft (launcher_id, disposition, signals_json, safesearch_adult, safesearch_raw_json, safesearch_checked_at, checked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(launcher_id) DO UPDATE SET
           disposition = excluded.disposition,
           signals_json = excluded.signals_json,
           safesearch_adult = excluded.safesearch_adult,
           safesearch_raw_json = excluded.safesearch_raw_json,
           safesearch_checked_at = excluded.safesearch_checked_at`
      )
      .run(
        launcherId,
        disposition,
        JSON.stringify(signals),
        result.adult,
        JSON.stringify(result.raw),
        Date.now(),
        Date.now()
      );
    return { disposition, signals, safesearchChecked: true };
  }

  close(): void {
    this.db.close();
  }
}
```

- [ ] **Step 4: Run the store test**

Run: `npx vitest run server/test/content-store.test.ts`
Expected: PASS. (If `node:sqlite` types are missing under `tsc`, confirm `@types/node` is current — Node 24 ships the runtime module; tsx runs it directly.)

- [ ] **Step 5: Wire the store into the cheap path of `ContentFilter`**

In `server/src/content-filter/index.ts`:

- Add `store?: ContentStore` to `ContentFilterOptions` and keep a `private readonly store?: ContentStore` from `opts.store`.
- In `apply()`, before resolving over the network, consult the store; after a network resolve, persist it. Change `apply` to take the event (it already does) and key by `launcherId`:

```ts
private async apply(event: SproutEvent): Promise<void> {
  const launcherId = event.launcherId;
  const stored = launcherId ? this.store?.get(launcherId) : undefined;
  const verdict: Verdict = stored
    ? { disposition: stored.disposition, signals: stored.signals }
    : await this.resolve(event.nftId!);

  if (!stored && launcherId) this.store?.putCheap(launcherId, event.nftId, verdict);

  if (verdict.disposition === "blocked") {
    event.mediaFilter = "blocked";
    if (launcherId) this.media.delete(launcherId);
  } else if (verdict.disposition === "sensitive") {
    event.mediaFilter = "sensitive";
  }
  if (verdict.signals.length > 0) event.signals = [...verdict.signals];
}
```

- [ ] **Step 6: Add a store-hit test for `enrich`**

Append to `server/test/content-filter.test.ts` (a store hit must skip the network entirely):

```ts
import { ContentStore } from "../src/content-filter/store.js";

test("enrich uses a stored verdict and skips the MintGarden fetch", async () => {
  const store = new ContentStore(":memory:");
  store.putCheap("launchX", "nft1x", { disposition: "sensitive", signals: ["lexicon"] });
  let fetched = 0;
  const filter = new ContentFilter(new MediaIndex(10), {
    store,
    fetchImpl: (async () => {
      fetched++;
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
  });
  const event: SproutEvent = {
    type: "sprout",
    kind: "nft",
    height: 1,
    coinId: "c",
    amount: "1",
    launcherId: "launchX",
    nftId: "nft1x",
    mediaKind: "image",
  };
  await filter.enrich([event]);
  expect(fetched).toBe(0);
  expect(event.mediaFilter).toBe("sensitive");
  expect(event.signals).toEqual(["lexicon"]);
  store.close();
});
```

- [ ] **Step 7: Run the suite slice + typecheck**

Run: `npx vitest run server/test/content-filter.test.ts server/test/content-store.test.ts && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: persist content-filter verdicts in a sqlite store keyed by launcherId"
```

---

## Task 4: SafeSearch signal (pure Vision REST query + mapping)

Isolated, fully testable with an injected `fetch` — no worker, no store, no network.

**Files:**

- Create: `server/src/content-filter/signals/safesearch.ts`
- Test: `server/test/safesearch.test.ts` (new)

**Interfaces:**

- Produces:
  - `interface SafeSearchResult { sensitive: boolean; adult: string; raw: unknown }`
  - `async function querySafeSearch(imageUri: string, opts: { apiKey: string; fetchImpl?: typeof fetch; timeoutMs?: number; baseUrl?: string }): Promise<SafeSearchResult>`
  - `function adultIsSensitive(likelihood: string): boolean` (LIKELY/VERY_LIKELY → true)

- [ ] **Step 1: Write the failing test**

Create `server/test/safesearch.test.ts`:

```ts
import { expect, test } from "vitest";
import { querySafeSearch, adultIsSensitive } from "../src/content-filter/signals/safesearch.js";

test("adultIsSensitive only for LIKELY / VERY_LIKELY", () => {
  expect(adultIsSensitive("VERY_LIKELY")).toBe(true);
  expect(adultIsSensitive("LIKELY")).toBe(true);
  expect(adultIsSensitive("POSSIBLE")).toBe(false);
  expect(adultIsSensitive("UNLIKELY")).toBe(false);
  expect(adultIsSensitive("UNKNOWN")).toBe(false);
});

test("querySafeSearch passes the imageUri by reference and maps adult likelihood", async () => {
  let sentBody: unknown;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    expect(String(url)).toContain("images:annotate");
    expect(String(url)).toContain("key=test-key");
    sentBody = JSON.parse(init.body as string);
    return new Response(
      JSON.stringify({
        responses: [{ safeSearchAnnotation: { adult: "VERY_LIKELY", violence: "UNLIKELY" } }],
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  const result = await querySafeSearch("https://example.com/art.png", {
    apiKey: "test-key",
    fetchImpl,
  });
  expect(sentBody).toEqual({
    requests: [
      {
        image: { source: { imageUri: "https://example.com/art.png" } },
        features: [{ type: "SAFE_SEARCH_DETECTION" }],
      },
    ],
  });
  expect(result.sensitive).toBe(true);
  expect(result.adult).toBe("VERY_LIKELY");
});

test("querySafeSearch maps a clean image to ok", async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ responses: [{ safeSearchAnnotation: { adult: "UNLIKELY" } }] }), {
      status: 200,
    })) as typeof fetch;
  const result = await querySafeSearch("https://e/x.png", { apiKey: "k", fetchImpl });
  expect(result.sensitive).toBe(false);
});

test("querySafeSearch throws on a non-ok HTTP status", async () => {
  const fetchImpl = (async () => new Response("nope", { status: 503 })) as typeof fetch;
  await expect(querySafeSearch("https://e/x.png", { apiKey: "k", fetchImpl })).rejects.toThrow();
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run server/test/safesearch.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `signals/safesearch.ts`**

```ts
export interface SafeSearchResult {
  sensitive: boolean;
  adult: string;
  raw: unknown;
}

const SENSITIVE_ADULT = new Set(["LIKELY", "VERY_LIKELY"]);

/** True when Vision's adult likelihood meets our sensitivity threshold. */
export function adultIsSensitive(likelihood: string): boolean {
  return SENSITIVE_ADULT.has(likelihood);
}

export interface QueryOpts {
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  baseUrl?: string;
}

/**
 * Ask Google Vision to SafeSearch-classify an image by URI. Google fetches the
 * URI itself — we never download the bytes. Maps adult LIKELY/VERY_LIKELY to
 * `sensitive`. Throws on transport / non-2xx / malformed responses so the caller
 * can leave the NFT permissive without poisoning the store.
 */
export async function querySafeSearch(
  imageUri: string,
  opts: QueryOpts
): Promise<SafeSearchResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const baseUrl = opts.baseUrl ?? "https://vision.googleapis.com/v1/images:annotate";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
  try {
    const res = await fetchImpl(`${baseUrl}?key=${opts.apiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requests: [
          { image: { source: { imageUri } }, features: [{ type: "SAFE_SEARCH_DETECTION" }] },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`vision ${res.status}`);
    const json = (await res.json()) as {
      responses?: Array<{
        safeSearchAnnotation?: { adult?: string };
        error?: { message?: string };
      }>;
    };
    const first = json.responses?.[0];
    if (first?.error) throw new Error(`vision: ${first.error.message ?? "annotation error"}`);
    const annotation = first?.safeSearchAnnotation ?? {};
    const adult = annotation.adult ?? "UNKNOWN";
    return { sensitive: adultIsSensitive(adult), adult, raw: annotation };
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run server/test/safesearch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add Vision SafeSearch query (image-by-URI, adult likelihood mapping)"
```

---

## Task 5: SafeSearch worker, `content-flag` event, async path, protocol bump, server wiring

The out-of-band path: eligible image mints get queued; on a `sensitive` result the worker writes the store and emits a `content-flag` event through the hub.

**Files:**

- Create: `server/src/content-filter/safesearch-worker.ts`
- Modify: `shared/src/index.ts` (`ContentFlagEvent`, union, `PROTOCOL_VERSION` 3→4)
- Modify: `server/src/content-filter/index.ts` (construct worker; queue from `enrich`)
- Modify: `server/src/index.ts` (pass `onFlag`, `googleApiKey`, `dbPath`, `store`)
- Test: `server/test/safesearch-worker.test.ts` (new), extend `server/test/content-filter.test.ts`

**Interfaces:**

- Produces:
  - `shared`: `interface ContentFlagEvent { type: "content-flag"; launcherId: string; mediaFilter: "sensitive" | "blocked"; signals: string[] }`; added to `GroveEvent`.
  - `safesearch-worker.ts`: `class SafeSearchWorker { constructor(opts: SafeSearchWorkerOpts); maybeEnqueue(event: SproutEvent): void }` with `interface SafeSearchWorkerOpts { media: MediaIndex; store: ContentStore; apiKey: string; onFlag: (e: ContentFlagEvent) => void; fetchImpl?: typeof fetch; timeoutMs?: number; concurrency?: number; failTtlMs?: number; now?: () => number }`.
- Consumes: `querySafeSearch` (Task 4), `ContentStore` (Task 3), `MediaIndex.get(launcherId).url`.

- [ ] **Step 1: Add `ContentFlagEvent` and bump the protocol**

In `shared/src/index.ts`:

```ts
export interface ContentFlagEvent {
  type: "content-flag";
  launcherId: string;
  mediaFilter: "sensitive" | "blocked";
  signals: string[]; // which signals fired, including "safesearch"
}

export type GroveEvent = BlockEvent | SproutEvent | AmbientEvent | ReorgEvent | ContentFlagEvent;
```

And change `export const PROTOCOL_VERSION = 3;` to `= 4;` (update its comment to note the `content-flag` event + `signals[]`). `Snapshot`/`Batch` already carry `GroveEvent[]`, so no transport change.

- [ ] **Step 2: Write the failing worker test**

Create `server/test/safesearch-worker.test.ts`:

```ts
import { expect, test } from "vitest";
import { SafeSearchWorker } from "../src/content-filter/safesearch-worker.js";
import { ContentStore } from "../src/content-filter/store.js";
import { MediaIndex } from "../src/web/media-index.js";
import type { ContentFlagEvent, SproutEvent } from "@grove/shared";

const nftEvent = (over: Partial<SproutEvent> = {}): SproutEvent => ({
  type: "sprout",
  kind: "nft",
  height: 1,
  coinId: "c",
  amount: "1",
  mint: true,
  launcherId: "L1",
  nftId: "nft1",
  mediaKind: "image",
  ...over,
});

const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0));

test("a sensitive image mint writes the store and emits a content-flag", async () => {
  const media = new MediaIndex(10);
  media.set("L1", { url: "https://e/x.png", kind: "image" });
  const store = new ContentStore(":memory:");
  store.putCheap("L1", "nft1", { disposition: "ok", signals: [] });
  const flags: ContentFlagEvent[] = [];
  const worker = new SafeSearchWorker({
    media,
    store,
    apiKey: "k",
    onFlag: (e) => flags.push(e),
    fetchImpl: (async () =>
      new Response(
        JSON.stringify({ responses: [{ safeSearchAnnotation: { adult: "VERY_LIKELY" } }] }),
        {
          status: 200,
        }
      )) as typeof fetch,
  });

  worker.maybeEnqueue(nftEvent());
  await flushMicrotasks();

  expect(flags).toEqual([
    { type: "content-flag", launcherId: "L1", mediaFilter: "sensitive", signals: ["safesearch"] },
  ]);
  expect(store.get("L1")?.disposition).toBe("sensitive");
  expect(store.get("L1")?.safesearchChecked).toBe(true);
  store.close();
});

test("a clean image mint marks checked and emits no flag", async () => {
  const media = new MediaIndex(10);
  media.set("L1", { url: "https://e/x.png", kind: "image" });
  const store = new ContentStore(":memory:");
  store.putCheap("L1", "nft1", { disposition: "ok", signals: [] });
  const flags: ContentFlagEvent[] = [];
  const worker = new SafeSearchWorker({
    media,
    store,
    apiKey: "k",
    onFlag: (e) => flags.push(e),
    fetchImpl: (async () =>
      new Response(
        JSON.stringify({ responses: [{ safeSearchAnnotation: { adult: "UNLIKELY" } }] }),
        {
          status: 200,
        }
      )) as typeof fetch,
  });
  worker.maybeEnqueue(nftEvent());
  await flushMicrotasks();
  expect(flags).toEqual([]);
  expect(store.get("L1")?.safesearchChecked).toBe(true);
  store.close();
});

test("ineligible events are skipped (non-mint, non-image, already-checked, no media)", async () => {
  const media = new MediaIndex(10);
  const store = new ContentStore(":memory:");
  let calls = 0;
  const worker = new SafeSearchWorker({
    media,
    store,
    apiKey: "k",
    onFlag: () => {},
    fetchImpl: (async () => {
      calls++;
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
  });
  worker.maybeEnqueue(nftEvent({ mint: undefined })); // not a mint
  worker.maybeEnqueue(nftEvent({ mediaKind: "video" })); // not an image
  worker.maybeEnqueue(nftEvent()); // no media-index entry
  await flushMicrotasks();
  expect(calls).toBe(0);
  store.close();
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `npx vitest run server/test/safesearch-worker.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement `safesearch-worker.ts`**

```ts
import type { ContentFlagEvent, SproutEvent } from "@grove/shared";
import type { MediaIndex } from "../web/media-index.js";
import type { ContentStore } from "./store.js";
import { querySafeSearch } from "./signals/safesearch.js";

export interface SafeSearchWorkerOpts {
  media: MediaIndex;
  store: ContentStore;
  apiKey: string;
  onFlag: (e: ContentFlagEvent) => void;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  concurrency?: number;
  /** How long a failed lookup is suppressed before another attempt. */
  failTtlMs?: number;
  now?: () => number;
}

/**
 * Out-of-band SafeSearch path. `maybeEnqueue` is fire-and-forget: eligible image
 * mints whose cheap verdict was `ok` get a single Vision lookup behind a bounded
 * concurrency gate. A `sensitive` result is persisted and pushed to clients as a
 * `content-flag`. Failures leave the NFT permissive and are suppressed for
 * `failTtlMs` so an outage doesn't re-spend the paid quota every block.
 */
export class SafeSearchWorker {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly concurrency: number;
  private readonly failTtlMs: number;
  private readonly now: () => number;
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly queued = new Set<string>();
  private readonly failedUntil = new Map<string, number>();

  constructor(private readonly opts: SafeSearchWorkerOpts) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 8000;
    this.concurrency = opts.concurrency ?? 2;
    this.failTtlMs = opts.failTtlMs ?? 300_000;
    this.now = opts.now ?? Date.now;
  }

  maybeEnqueue(event: SproutEvent): void {
    if (event.kind !== "nft" || event.mint !== true || event.mediaKind !== "image") return;
    const launcherId = event.launcherId;
    if (!launcherId || this.queued.has(launcherId)) return;
    const media = this.opts.media.get(launcherId);
    if (!media || media.kind !== "image") return;
    const stored = this.opts.store.get(launcherId);
    if (stored?.safesearchChecked) return;
    const until = this.failedUntil.get(launcherId);
    if (until !== undefined && this.now() < until) return;

    this.queued.add(launcherId);
    void this.gate(() => this.run(launcherId, media.url)).finally(() =>
      this.queued.delete(launcherId)
    );
  }

  private async run(launcherId: string, imageUri: string): Promise<void> {
    try {
      const result = await querySafeSearch(imageUri, {
        apiKey: this.opts.apiKey,
        fetchImpl: this.fetchImpl,
        timeoutMs: this.timeoutMs,
      });
      const updated = this.opts.store.putSafeSearch(launcherId, result);
      if (result.sensitive) {
        this.opts.onFlag({
          type: "content-flag",
          launcherId,
          mediaFilter: "sensitive",
          signals: updated.signals,
        });
      }
    } catch {
      this.failedUntil.set(launcherId, this.now() + this.failTtlMs);
    }
  }

  private gate<T>(fn: () => Promise<T>): Promise<T> {
    const runNow = async (): Promise<T> => {
      this.active++;
      try {
        return await fn();
      } finally {
        this.active--;
        this.waiters.shift()?.();
      }
    };
    if (this.active < this.concurrency) return runNow();
    return new Promise<T>((resolve, reject) => {
      this.waiters.push(() => runNow().then(resolve, reject));
    });
  }
}
```

- [ ] **Step 5: Run the worker test**

Run: `npx vitest run server/test/safesearch-worker.test.ts`
Expected: PASS.

- [ ] **Step 6: Construct the worker in `ContentFilter` and queue from `enrich`**

In `server/src/content-filter/index.ts`:

- Extend `ContentFilterOptions` with `onFlag?: (e: ContentFlagEvent) => void;` and `googleApiKey?: string;` (and keep `store?`).
- In the constructor, if `opts.store` and `opts.googleApiKey` and `opts.onFlag` are all present, create `this.worker = new SafeSearchWorker({ media, store: opts.store, apiKey: opts.googleApiKey, onFlag: opts.onFlag, fetchImpl: opts.fetchImpl })`. Otherwise leave `this.worker` undefined (SafeSearch disabled).
- In `apply()`, after stamping the cheap verdict, queue the async lookup only when the cheap verdict is permissive:

```ts
if (verdict.disposition === "ok") this.worker?.maybeEnqueue(event);
```

Import: `import type { ContentFlagEvent } from "@grove/shared";` and `import { SafeSearchWorker } from "./safesearch-worker.js";`.

- [ ] **Step 7: Add an `enrich`-level integration test**

Append to `server/test/content-filter.test.ts`:

```ts
test("enrich queues SafeSearch for a clean image mint and emits a flag", async () => {
  const media = new MediaIndex(10);
  media.set("Lg", { url: "https://e/g.png", kind: "image" });
  const store = new ContentStore(":memory:");
  const flags: import("@grove/shared").ContentFlagEvent[] = [];
  const filter = new ContentFilter(media, {
    store,
    googleApiKey: "k",
    onFlag: (e) => flags.push(e),
    fetchImpl: (async (url: string) => {
      if (String(url).includes("images:annotate")) {
        return new Response(
          JSON.stringify({ responses: [{ safeSearchAnnotation: { adult: "LIKELY" } }] }),
          { status: 200 }
        );
      }
      return new Response("{}", { status: 404 }); // MintGarden unknown → ok
    }) as typeof fetch,
  });
  const event: SproutEvent = {
    type: "sprout",
    kind: "nft",
    height: 1,
    coinId: "c",
    amount: "1",
    mint: true,
    launcherId: "Lg",
    nftId: "nft1g",
    mediaKind: "image",
  };
  await filter.enrich([event]);
  await new Promise((r) => setTimeout(r, 0));
  expect(event.mediaFilter).toBeUndefined(); // streamed permissive
  expect(flags).toEqual([
    { type: "content-flag", launcherId: "Lg", mediaFilter: "sensitive", signals: ["safesearch"] },
  ]);
  store.close();
});
```

- [ ] **Step 8: Wire the real store, key, and onFlag in `server/src/index.ts`**

```ts
import { ContentStore } from "./content-filter/store.js";
// ...
const CONTENT_DB_PATH = process.env.CONTENT_DB_PATH ?? "./data/content-filter.sqlite";
const contentStore = new ContentStore(CONTENT_DB_PATH);
const contentFilter = new ContentFilter(media, {
  store: contentStore,
  googleApiKey: process.env.GOOGLE_VISION_API_KEY,
  onFlag: (e) => hub.publish([e]),
});
```

And close the store on shutdown — in the signal handler, after `await app.close();` add `contentStore.close();`.

- [ ] **Step 9: Run the suite slice + typecheck**

Run: `npx vitest run server/test/safesearch-worker.test.ts server/test/content-filter.test.ts && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: async SafeSearch worker emits content-flag patches; bump protocol to 4"
```

---

## Task 6: Client — apply `content-flag` patches

Blur an already-rendered NFT when its async verdict arrives. Themes that don't render NFT art ignore it.

**Files:**

- Modify: `web/src/themes/gallery/pieces.ts` (add `markSensitive`)
- Modify: `web/src/themes/gallery/gallery.ts` (handle `content-flag`)
- Modify: `web/src/themes/mine/structures.ts` (add `markSensitive` to `Paintings`)
- Modify: `web/src/themes/mine/mine.ts` (dispatch `content-flag` via a new handler hook)
- Modify: `web/src/themes/mine/index.ts` (wire the handler)
- Modify: `web/src/ui/detail-card.ts` (re-render if open on the flagged launcher) — optional polish, include
- Modify: `web/src/net/demo.ts` (emit a delayed demo `content-flag`)
- Test: `web/test/content-flag.test.ts` (new)

**Interfaces:**

- Produces: `Pieces.markSensitive(launcherId: string, placeholder: THREE.Texture): boolean`; `Paintings.markSensitive(launcherId: string): boolean`; `mine` runtime `setContentFlagHandler(fn: (launcherId: string) => void): void`.

- [ ] **Step 1: Write a failing unit test for the gallery `markSensitive`**

Create `web/test/content-flag.test.ts`. The gallery `Pieces` pool is the unit; mock Three minimally by exercising the real class against a tiny scene. If `Pieces` is hard to construct headless, test the pure mapping instead: assert that a `content-flag` event narrows to the patch the dispatch applies. Concretely, test the small dispatch helper extracted in Step 4:

```ts
import { expect, test } from "vitest";
import { contentFlagTarget } from "../src/themes/shared/content-flag.js";
import type { ContentFlagEvent } from "@grove/shared";

test("contentFlagTarget returns the launcher for a sensitive flag", () => {
  const e: ContentFlagEvent = {
    type: "content-flag",
    launcherId: "L9",
    mediaFilter: "sensitive",
    signals: ["safesearch"],
  };
  expect(contentFlagTarget(e)).toBe("L9");
});

test("contentFlagTarget ignores a non-content-flag event", () => {
  expect(
    contentFlagTarget({
      type: "block",
      height: 1,
      headerHash: "h",
      timestamp: 0,
      spendCount: 0,
      fees: "0",
    })
  ).toBeNull();
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run web/test/content-flag.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Create the shared helper**

`web/src/themes/shared/content-flag.ts`:

```ts
import type { GroveEvent } from "@grove/shared";

/** Launcher id a content-flag event targets, or null for any other event. */
export function contentFlagTarget(event: GroveEvent): string | null {
  return event.type === "content-flag" ? event.launcherId : null;
}
```

- [ ] **Step 4: Run the helper test**

Run: `npx vitest run web/test/content-flag.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `markSensitive` to gallery `Pieces`**

In `web/src/themes/gallery/pieces.ts`, add (mirroring `ping`, using the `image` mesh material like `retire` does):

```ts
/** Blur an already-hung NFT after a late content-flag: hang the neutral placeholder. */
markSensitive(launcherId: string, placeholder: THREE.Texture): boolean {
  const slotId = this.byLauncher.get(launcherId);
  if (slotId === undefined) return false;
  const piece = this.slots[slotId];
  if (!piece) return false;
  piece.event = { ...piece.event, mediaFilter: "sensitive" };
  const mat = piece.image.material as THREE.MeshBasicMaterial;
  mat.map = placeholder;
  mat.color.set(0xffffff);
  mat.needsUpdate = true;
  return true;
}
```

(If `slots`/`piece.image` have different private names, match the names used in `retire()` / `ping()` in that file.)

- [ ] **Step 6: Handle `content-flag` in gallery dispatch**

In `web/src/themes/gallery/gallery.ts`, inside the `feed.onEvent` switch, add a case (the file already imports `sensitivePlaceholderTexture`):

```ts
case "content-flag": {
  if (pieces.markSensitive(event.launcherId, sensitivePlaceholderTexture().clone())) {
    refreshPlacardIf(event.launcherId);
  }
  break;
}
```

- [ ] **Step 7: Add `markSensitive` to mine `Paintings`**

In `web/src/themes/mine/structures.ts` (the `Paintings` class already imports `sensitivePlaceholderTexture`), add next to `has()`:

```ts
/** Blur an already-hung painting after a late content-flag. */
markSensitive(launcherId: string): boolean {
  const slot = this.byLauncher.get(launcherId);
  if (slot === undefined) return false;
  const p = this.pool[slot];
  if (!p?.meta) return false;
  p.meta = { ...p.meta, mediaFilter: "sensitive" };
  const mat = p.panel.material as THREE.MeshBasicMaterial;
  mat.map = sensitivePlaceholderTexture();
  mat.color.set(0xffffff);
  mat.needsUpdate = true;
  return true;
}
```

- [ ] **Step 8: Dispatch `content-flag` in mine**

In `web/src/themes/mine/mine.ts`: add a handler slot and a switch case, and expose the setter.

Near the other `let on*Extra` declarations:

```ts
let onContentFlag = (_launcherId: string) => {};
```

In the `feed.onEvent` switch:

```ts
case "content-flag":
  onContentFlag(event.launcherId);
  break;
```

In the returned object's setters:

```ts
setContentFlagHandler: (fn: typeof onContentFlag) => (onContentFlag = fn),
```

In `web/src/themes/mine/index.ts`, after the other `runtime.set*Handler(...)` calls:

```ts
runtime.setContentFlagHandler((launcherId) => paintings.markSensitive(launcherId));
```

- [ ] **Step 9: Detail card re-render (polish)**

In `web/src/ui/detail-card.ts`, the card reads `event.mediaFilter` to add the `sensitive` class. No change is needed for newly opened cards (they read the patched event). Confirm the card is rebuilt from the current event on open; if the gallery placard already refreshes via `refreshPlacardIf` (Step 6), leave detail-card untouched. No code change unless a stale open card must update live — out of scope; skip.

- [ ] **Step 10: Demo `content-flag` (offline exercise)**

In `web/src/net/demo.ts`, after dispatching a sensitive-eligible NFT, schedule a delayed flag for one launcher so the patch path is exercisable with `?demo=1`. Near where demo NFT events are emitted:

```ts
// exercise the async content-flag patch path offline
if (event.kind === "nft" && event.launcherId && filterRoll >= 0.18 && filterRoll < 0.21) {
  const launcher = event.launcherId;
  setTimeout(
    () =>
      dispatch({
        type: "content-flag",
        launcherId: launcher,
        mediaFilter: "sensitive",
        signals: ["safesearch"],
      }),
    4000
  );
}
```

(Use the demo file's existing dispatch function name; it is the callback passed to `startDemo`.)

- [ ] **Step 11: Typecheck web + run the web test**

Run: `npm run typecheck && npx vitest run web/test/content-flag.test.ts`
Expected: typecheck clean (the new `content-flag` case is handled in gallery + mine; board/farm/grove switches ignore it without a `never` exhaustiveness error — confirm none use an exhaustive default; if one does, add a no-op `case "content-flag": break;`). Test PASS.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: apply content-flag patches in gallery and mine themes"
```

---

## Task 7: Config, ignore rules, docs, and full verification

**Files:**

- Modify: `.gitignore`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Ignore the SQLite data dir**

Add to `.gitignore`:

```
# content-filter SQLite store
/data/
```

- [ ] **Step 2: Document env vars in `CLAUDE.md`**

In the server env table add:

```
| `GOOGLE_VISION_API_KEY` | (unset) | Enables Vision SafeSearch; unset = cheap signals only |
| `CONTENT_DB_PATH`       | `./data/content-filter.sqlite` | SQLite verdict store path |
```

- [ ] **Step 3: Update the architecture prose in `CLAUDE.md`**

Replace the existing content-filter bullet under "Server internals" with a description of the new module: cheap signals inline (lexicon/CHIP-7/MintGarden/denylist) stamping `mediaFilter` + `signals[]`; SafeSearch async/out-of-band (image mints, only when cheap verdict is `ok`) persisted in `server/src/content-filter/store.ts` (SQLite, keyed by `launcherId`); late verdicts pushed as `content-flag` events. Add `ContentFlagEvent` to the event-types table. Note the module is self-contained for later extraction.

- [ ] **Step 4: Full verification**

Run: `npm run typecheck && npm test && npm run lint`
Expected: all pass. If lint flags formatting, run `npm run format` and re-run.

- [ ] **Step 5: Build sanity**

Run: `npm run build`
Expected: web bundle builds without type errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "docs: document SafeSearch content-filter module, env vars, and content-flag event"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** SafeSearch adult LIKELY/VERY_LIKELY → sensitive (Task 4); image-by-URI, no download (Task 4 `image.source.imageUri`); event-stream redesign via async `content-flag` + `signals[]` (Tasks 2, 5, 6); run-once-per-mint + SQLite (Tasks 3, 5 eligibility via `safesearchChecked`); only-when-cheap-`ok` (Task 5 `apply()` queues only on permissive); unified verdict per NFT keyed by launcherId (Task 3); clean liftable module (Tasks 1–5 confined to `content-filter/`, only `@grove/shared` + `MediaIndex` imports); `blocked` kept distinct, SafeSearch only `sensitive` (Tasks 2, 4); config/docs (Task 7). All spec sections map to a task.
- **Placeholder scan:** none — every code step carries concrete code; Task 6 Step 9 is an explicit "skip, out of scope" decision, not a TODO.
- **Type consistency:** `Verdict`, `Disposition`, `SignalName`, `StoredVerdict`, `ContentFlagEvent`, `mapMintgardenSignals`, `querySafeSearch`/`SafeSearchResult`, `SafeSearchWorker.maybeEnqueue`, `ContentStore.{get,putCheap,putSafeSearch,close}`, `markSensitive`, `setContentFlagHandler` are used identically across the tasks that define and consume them.

```

```
