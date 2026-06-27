# Content Filter: Text-Keyword + Collection-Denylist Signals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two low-cost adult-content signals — a text-keyword heuristic and a curated collection denylist — that fold into the existing `mapMintgarden` disposition function without changing the async `ContentFilter` class.

**Architecture:** Two new pure data modules (`lexicon.ts`, `denylist.ts`) in `server/src/classify/`. `mapMintgarden` gains an optional injectable `opts` argument and combines three verdicts — existing MintGarden flags, denylist (by `collection.id`), and lexicon (over name/description text) — using the existing `blocked > sensitive > ok` precedence. New signals can only raise sensitivity, never lower it.

**Tech Stack:** TypeScript (Node ≥ 24, ESM, `.js` import specifiers), Vitest.

## Global Constraints

- ESM with explicit `.js` extensions on relative imports (e.g. `import { LEXICON } from "./lexicon.js"`), matching the existing codebase.
- `Disposition = "blocked" | "sensitive" | "ok"` is defined in `content-filter.ts`; other modules import it with `import type` to avoid a runtime cycle.
- Existing `mapMintgarden` behavior and all current tests in `server/test/content-filter.test.ts` must continue to pass unchanged.
- New signals are permissive on empty/unknown input: missing fields and an empty denylist resolve to `ok`.
- Denylist ships **empty**. Lexicon ships a small, high-precision starter set.
- Run tests with `npx vitest run server/test/content-filter.test.ts` (single file) and `npm test` (full suite).

---

### Task 1: Lexicon module

**Files:**
- Create: `server/src/classify/lexicon.ts`
- Test: `server/test/lexicon.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export const LEXICON: string[]` — starter adult terms.
  - `export function matchesLexicon(text: string, terms?: string[]): boolean` — case-insensitive, word-boundary match; `terms` defaults to `LEXICON`.

- [ ] **Step 1: Write the failing test**

Create `server/test/lexicon.test.ts`:

```typescript
import { expect, test } from "vitest";
import { LEXICON, matchesLexicon } from "../src/classify/lexicon.js";

test("LEXICON is a non-empty list of lowercase strings", () => {
  expect(Array.isArray(LEXICON)).toBe(true);
  expect(LEXICON.length).toBeGreaterThan(0);
  for (const term of LEXICON) {
    expect(typeof term).toBe("string");
    expect(term).toBe(term.toLowerCase());
    expect(term.trim()).not.toBe("");
  }
});

test("matches a whole-word term, case-insensitively", () => {
  expect(matchesLexicon("Hardcore XXX collection")).toBe(true);
  expect(matchesLexicon("NUDE study")).toBe(true);
});

test("does not match a term embedded as a substring (word boundary)", () => {
  // "sussex" contains "sex", "analysis" contains "anal" — must not match
  expect(matchesLexicon("Sussex sunrise", ["sex"])).toBe(false);
  expect(matchesLexicon("data analysis", ["anal"])).toBe(false);
});

test("benign text → no match", () => {
  expect(matchesLexicon("A peaceful mountain landscape")).toBe(false);
  expect(matchesLexicon("")).toBe(false);
});

test("custom term list is honored", () => {
  expect(matchesLexicon("contains widget", ["widget"])).toBe(true);
  expect(matchesLexicon("contains widget", ["gadget"])).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/test/lexicon.test.ts`
Expected: FAIL — cannot resolve `../src/classify/lexicon.js`.

- [ ] **Step 3: Write minimal implementation**

Create `server/src/classify/lexicon.ts`:

```typescript
/**
 * Small, high-precision starter set of adult-content terms. A whole-word match
 * (case-insensitive) in an NFT's name/description/collection-name text flags the
 * NFT as `sensitive` (blur), not `blocked` — keyword matching is fuzzy, so the
 * response is reversible. Tune this list via PR.
 */
export const LEXICON: string[] = [
  "porn",
  "xxx",
  "nsfw",
  "hentai",
  "nude",
  "nudity",
  "naked",
  "erotic",
  "erotica",
  "fetish",
  "hardcore",
  "explicit",
  "onlyfans",
];

const escape = (term: string): string => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Build one case-insensitive, word-boundary regex from a term list. */
const compile = (terms: string[]): RegExp | null =>
  terms.length === 0 ? null : new RegExp(`\\b(?:${terms.map(escape).join("|")})\\b`, "i");

const DEFAULT_RE = compile(LEXICON);

/**
 * True if `text` contains any term as a whole word (case-insensitive). Word
 * boundaries stop benign substrings (e.g. "sex" inside "Sussex") from matching.
 */
export function matchesLexicon(text: string, terms: string[] = LEXICON): boolean {
  if (text === "") return false;
  const re = terms === LEXICON ? DEFAULT_RE : compile(terms);
  return re !== null && re.test(text);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/test/lexicon.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/classify/lexicon.ts server/test/lexicon.test.ts
git commit -m "feat: lexicon module for adult-term text matching"
```

---

### Task 2: Denylist module

**Files:**
- Create: `server/src/classify/denylist.ts`
- Test: `server/test/denylist.test.ts`

**Interfaces:**
- Consumes: `import type { Disposition } from "./content-filter.js"` (type-only; no runtime cycle).
- Produces:
  - `export interface DenylistEntry { collectionId: string; disposition: "blocked" | "sensitive"; note?: string }`
  - `export const DENYLIST: DenylistEntry[]` — ships empty.
  - `export function buildDenylistMap(entries: DenylistEntry[]): Map<string, Disposition>`
  - `export const DENYLIST_MAP: Map<string, Disposition>` — `buildDenylistMap(DENYLIST)`.
  - `export function dispositionForCollection(map: Map<string, Disposition>, collectionId: string | undefined): Disposition | undefined`

- [ ] **Step 1: Write the failing test**

Create `server/test/denylist.test.ts`:

```typescript
import { expect, test } from "vitest";
import {
  DENYLIST,
  DENYLIST_MAP,
  buildDenylistMap,
  dispositionForCollection,
  type DenylistEntry,
} from "../src/classify/denylist.js";

test("DENYLIST ships empty and well-formed", () => {
  expect(Array.isArray(DENYLIST)).toBe(true);
  expect(DENYLIST.length).toBe(0);
  expect(DENYLIST_MAP.size).toBe(0);
});

test("buildDenylistMap maps collectionId → disposition", () => {
  const entries: DenylistEntry[] = [
    { collectionId: "col_blocked", disposition: "blocked" },
    { collectionId: "col_sensitive", disposition: "sensitive", note: "nsfw art" },
  ];
  const map = buildDenylistMap(entries);
  expect(map.get("col_blocked")).toBe("blocked");
  expect(map.get("col_sensitive")).toBe("sensitive");
});

test("dispositionForCollection returns undefined for unknown / missing id", () => {
  const map = buildDenylistMap([{ collectionId: "col1", disposition: "blocked" }]);
  expect(dispositionForCollection(map, "col1")).toBe("blocked");
  expect(dispositionForCollection(map, "nope")).toBeUndefined();
  expect(dispositionForCollection(map, undefined)).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/test/denylist.test.ts`
Expected: FAIL — cannot resolve `../src/classify/denylist.js`.

- [ ] **Step 3: Write minimal implementation**

Create `server/src/classify/denylist.ts`:

```typescript
import type { Disposition } from "./content-filter.js";

/** One curated denylist entry, keyed by MintGarden collection id. */
export interface DenylistEntry {
  collectionId: string;
  disposition: "blocked" | "sensitive";
  note?: string;
}

/**
 * Curated collection denylist. Ships empty; populated via PR. Each entry carries
 * its own disposition so a takedown-worthy collection can be `blocked` while a
 * merely-NSFW one is `sensitive` (blur).
 */
export const DENYLIST: DenylistEntry[] = [];

/** Index entries by collection id for O(1) lookup. Later entries win on dup ids. */
export function buildDenylistMap(entries: DenylistEntry[]): Map<string, Disposition> {
  const map = new Map<string, Disposition>();
  for (const entry of entries) map.set(entry.collectionId, entry.disposition);
  return map;
}

export const DENYLIST_MAP: Map<string, Disposition> = buildDenylistMap(DENYLIST);

/** Disposition for a collection id, or undefined if absent / id missing. */
export function dispositionForCollection(
  map: Map<string, Disposition>,
  collectionId: string | undefined
): Disposition | undefined {
  return collectionId === undefined ? undefined : map.get(collectionId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/test/denylist.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/classify/denylist.ts server/test/denylist.test.ts
git commit -m "feat: empty collection denylist module with id lookup"
```

---

### Task 3: Fold text + denylist signals into mapMintgarden

**Files:**
- Modify: `server/src/classify/content-filter.ts` (the `mapMintgarden` function and its imports)
- Test: `server/test/content-filter.test.ts` (add cases)

**Interfaces:**
- Consumes: `LEXICON`, `matchesLexicon` from Task 1; `DENYLIST_MAP`, `dispositionForCollection`, `buildDenylistMap` from Task 2.
- Produces (changed signature, backward compatible):
  - `export interface MapMintgardenOpts { lexicon?: string[]; denylist?: Map<string, Disposition> }`
  - `export function mapMintgarden(json: unknown, opts?: MapMintgardenOpts): Disposition`

- [ ] **Step 1: Write the failing tests**

Add to `server/test/content-filter.test.ts` (after the existing `mapMintgarden` tests, before the `nftEvent` helper). Note the new import of `buildDenylistMap`:

```typescript
import { buildDenylistMap } from "../src/classify/denylist.js";

test("lexicon hit in nft name → sensitive", () => {
  expect(mapMintgarden({ name: "Hardcore #1" })).toBe("sensitive");
});

test("lexicon hit in collection name → sensitive", () => {
  expect(mapMintgarden({ collection: { name: "XXX Club" } })).toBe("sensitive");
});

test("lexicon hit in metadata description → sensitive", () => {
  expect(mapMintgarden({ data: { metadata_json: { description: "explicit content" } } })).toBe(
    "sensitive"
  );
});

test("benign name with embedded substring does not match (word boundary)", () => {
  expect(mapMintgarden({ name: "Sussex Coastline", collection: { name: "Analysis" } })).toBe("ok");
});

test("denylisted collection returns its declared disposition", () => {
  const denylist = buildDenylistMap([{ collectionId: "col_bad", disposition: "blocked" }]);
  expect(mapMintgarden({ collection: { id: "col_bad" } }, { denylist })).toBe("blocked");
});

test("denylist sensitive entry → sensitive", () => {
  const denylist = buildDenylistMap([{ collectionId: "col_nsfw", disposition: "sensitive" }]);
  expect(mapMintgarden({ collection: { id: "col_nsfw" } }, { denylist })).toBe("sensitive");
});

test("denylist blocked overrides a co-occurring text sensitive hit", () => {
  const denylist = buildDenylistMap([{ collectionId: "col_bad", disposition: "blocked" }]);
  expect(
    mapMintgarden({ name: "nude study", collection: { id: "col_bad" } }, { denylist })
  ).toBe("blocked");
});

test("MintGarden blocked flag still wins over a text sensitive hit", () => {
  expect(mapMintgarden({ is_blocked: true, name: "nude study" })).toBe("blocked");
});

test("custom lexicon via opts is honored", () => {
  expect(mapMintgarden({ name: "contains widget" }, { lexicon: ["widget"] })).toBe("sensitive");
});

test("non-denylisted collection with default (empty) denylist → ok", () => {
  expect(mapMintgarden({ collection: { id: "col_unknown" } })).toBe("ok");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/test/content-filter.test.ts`
Expected: FAIL — e.g. `mapMintgarden({ name: "Hardcore #1" })` returns `"ok"`, expected `"sensitive"`.

- [ ] **Step 3: Implement the fold**

In `server/src/classify/content-filter.ts`, add imports at the top (after the existing imports):

```typescript
import { LEXICON, matchesLexicon } from "./lexicon.js";
import { DENYLIST_MAP, dispositionForCollection } from "./denylist.js";
```

Add a precedence helper and `MapMintgardenOpts` just above the current `mapMintgarden`:

```typescript
const RANK: Record<Disposition, number> = { ok: 0, sensitive: 1, blocked: 2 };

/** Strongest disposition under `blocked > sensitive > ok`. */
const strongest = (...ds: Disposition[]): Disposition =>
  ds.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "ok");

export interface MapMintgardenOpts {
  /** Override the adult-term lexicon (test injection). Defaults to LEXICON. */
  lexicon?: string[];
  /** Override the collection denylist map (test injection). Defaults to DENYLIST_MAP. */
  denylist?: Map<string, Disposition>;
}
```

Replace the body of `mapMintgarden` with the combined fold (keep the existing doc comment, update its wording to mention the three signals):

```typescript
export function mapMintgarden(json: unknown, opts: MapMintgardenOpts = {}): Disposition {
  const lexicon = opts.lexicon ?? LEXICON;
  const denylist = opts.denylist ?? DENYLIST_MAP;

  const nft = asRecord(json);
  const collection = asRecord(nft.collection);
  const creator = asRecord(nft.creator);
  const metadata = asRecord(asRecord(nft.data).metadata_json);

  // 1. existing MintGarden structured flags (unchanged precedence)
  const flagVerdict: Disposition =
    nft.is_blocked === true ||
    collection.blocked_content === true ||
    creator.verification_state === 2
      ? "blocked"
      : isSensitiveFlag(collection.sensitive_content) ||
          isSensitiveFlag(metadata.sensitive_content)
        ? "sensitive"
        : "ok";

  // 2. curated collection denylist, keyed by MintGarden collection id
  const collectionId = typeof collection.id === "string" ? collection.id : undefined;
  const denyVerdict = dispositionForCollection(denylist, collectionId) ?? "ok";

  // 3. text-keyword heuristic over name / collection name / description
  const text = [nft.name, metadata.name, collection.name, metadata.description]
    .filter((s): s is string => typeof s === "string")
    .join(" ");
  const textVerdict: Disposition = matchesLexicon(text, lexicon) ? "sensitive" : "ok";

  return strongest(flagVerdict, denyVerdict, textVerdict);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/test/content-filter.test.ts`
Expected: PASS — all existing tests plus the 10 new ones.

- [ ] **Step 5: Commit**

```bash
git add server/src/classify/content-filter.ts server/test/content-filter.test.ts
git commit -m "feat: fold text-keyword and collection-denylist signals into mapMintgarden"
```

---

### Task 4: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: PASS, no errors.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: PASS, no errors.

- [ ] **Step 3: Full test suite**

Run: `npm test`
Expected: PASS — including `lexicon.test.ts`, `denylist.test.ts`, and the extended `content-filter.test.ts`.

- [ ] **Step 4: Confirm no extra commit needed**

If `git status` is clean (Tasks 1–3 already committed their work), nothing to commit. Otherwise commit any formatting fixes:

```bash
git status
# if dirty after `npm run format`:
git add -A && git commit -m "chore: format content-filter additions"
```

---

## Self-Review

- **Spec coverage:** text heuristic (Task 1 + Task 3) ✓; collection denylist (Task 2 + Task 3) ✓; per-entry disposition ✓; ships-empty denylist ✓; verdict fold with `blocked > sensitive > ok` ✓; defensive field reads via `asRecord` ✓; tests for each text field, word boundary, denylist override, MintGarden-wins, permissive-on-empty ✓; lexicon/denylist well-formed sanity tests ✓.
- **Placeholder scan:** no TBD/TODO; all steps carry full code.
- **Type consistency:** `Disposition` defined in `content-filter.ts`, type-imported by `denylist.ts`; `buildDenylistMap`/`dispositionForCollection`/`matchesLexicon`/`MapMintgardenOpts` names match across tasks. `mapMintgarden` second arg defaults to `{}`, so existing zero-arg call sites compile unchanged.
- **Field-path note:** Task 3 reads `nft.name`, `metadata.name`, `collection.name`, `metadata.description`. If a real MintGarden `/nfts/:id` fixture shows a different path, adjust the `text` array — the verdict fold itself is unaffected.
