# Chia Grove Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An ambient web-based 3D art piece (nocturnal meadow) that visualizes live Chia mainnet activity, with each block sprouting flora classified per-spend (XCH/CAT/NFT/DID) via the chia-wallet-sdk napi binding.

**Architecture:** One Node process: a coinset.org poller (ingest) feeds a pure classifier that emits compact "grove events" into a ring buffer + WebSocket hub; the same process serves the static Three.js frontend. No database. Spec: `docs/superpowers/specs/2026-06-10-chia-grove-design.md`.

**Tech Stack:** TypeScript everywhere; npm workspaces (`shared`, `server`, `web`); server: `chia-wallet-sdk` (napi, ^0.33.0), Fastify 5 + `@fastify/websocket` + `@fastify/static`, `tsx` runtime; web: Vite 6 + three.js (no UI framework); tests: Vitest at the root (the SDK's in-memory `Simulator` lets classify tests mint real NFTs/CATs/DIDs without network).

**Noted deviations from spec (intentional, minor):**

- `getAdditionsAndRemovals` is not fetched: block spends already carry every datum the scene uses (kinds, amounts, counts). Nothing visual consumed additions.
- NFT `imageUrl` comes straight from the on-chain metadata program's `dataUris` (first http(s) URI) — no server-side fetch/cache needed, same intent ("omitted when unavailable").
- Reorg "wilt and regrow" is implemented as a grove-wide gust (brief global scale dip + firefly scatter + ripple) rather than per-plant wilt — visible event, far simpler.

**Environment notes for the executor:**

- Working directory: `/Users/don/src/dkackman/chia-grove` (repo already initialized, spec committed).
- Node >= 20 required (napi native module).
- `chia-wallet-sdk` ships prebuilt binaries via npm — no Rust toolchain needed.
- bigints: all amounts cross the wire as **strings** (JSON-safe). Hex strings have no `0x` prefix; explorer links add it.

---

## File structure (final state)

```
chia-grove/
├── package.json                  # workspaces root, vitest
├── tsconfig.base.json
├── vitest.config.ts
├── .gitignore
├── README.md
├── shared/
│   ├── package.json              # @grove/shared (TS source consumed directly)
│   └── src/index.ts              # GroveEvent wire types
├── server/
│   ├── package.json              # @grove/server
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts              # wiring + env config
│   │   ├── ingest/types.ts       # RpcView/ChainSource/BlockData interfaces
│   │   ├── ingest/coinset-view.ts# RpcClient → RpcView adapter (thin glue)
│   │   ├── ingest/coinset-poller.ts
│   │   ├── classify/classify.ts  # CoinSpend[] → GroveEvent[]
│   │   ├── web/ring-buffer.ts
│   │   ├── web/hub.ts            # fan-out + backpressure
│   │   └── web/server.ts         # Fastify app factory
│   └── test/
│       ├── ring-buffer.test.ts
│       ├── classify.test.ts      # uses SDK Simulator
│       ├── coinset-poller.test.ts
│       └── hub.test.ts
├── web/
│   ├── package.json              # @grove/web
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── index.html
│   ├── src/
│   │   ├── main.ts
│   │   ├── style.css
│   │   ├── net/feed.ts           # ws + reconnect + snapshot replay + stale
│   │   ├── net/demo.ts           # ?demo=1 synthetic events
│   │   ├── scene/layout.ts       # phyllotaxis + deterministic scatter (pure)
│   │   ├── scene/palette.ts      # catHue + shared colors (pure)
│   │   ├── scene/textures.ts     # canvas-generated glow sprite texture
│   │   ├── scene/sky.ts          # stars, moon, aurora pulse, signal-lost
│   │   ├── scene/ground.ts       # meadow disc + block ripple rings
│   │   ├── scene/flora.ts        # instanced grasses/mushrooms/blooms/wisps
│   │   ├── scene/fireflies.ts    # mempool particle swarm
│   │   └── scene/grove.ts        # composition root + render loop
│   └── test/
│       ├── layout.test.ts
│       └── palette.test.ts
└── deploy/
    ├── Caddyfile
    ├── chia-grove.service
    └── deploy.sh
```

Event flow: `CoinsetPoller` → handlers in `index.ts` → `classifyBlock()` → `Hub.publish()` → ring buffer + every WebSocket → frontend `GroveFeed` → `grove.ts` scene systems.

---

### Task 1: Workspace scaffold

**Files:**

- Create: `package.json`, `tsconfig.base.json`, `vitest.config.ts`, `.gitignore`
- Create: `shared/package.json`, `server/package.json`, `server/tsconfig.json`, `web/package.json`, `web/tsconfig.json`

- [ ] **Step 1: Write root config files**

`package.json`:

```json
{
  "name": "chia-grove",
  "private": true,
  "type": "module",
  "workspaces": ["shared", "server", "web"],
  "scripts": {
    "test": "vitest run",
    "dev:server": "npm run dev -w server",
    "dev:web": "npm run dev -w web",
    "build": "npm run build -w web",
    "start": "npm run start -w server"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "skipLibCheck": true,
    "noEmit": true,
    "esModuleInterop": true
  }
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["server/test/**/*.test.ts", "web/test/**/*.test.ts"],
    passWithNoTests: true,
  },
});
```

`.gitignore`:

```
node_modules/
dist/
*.log
.superpowers/
```

- [ ] **Step 2: Write package manifests**

`shared/package.json` (TS source is consumed directly by tsx/vite/vitest — no build step):

```json
{
  "name": "@grove/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts"
}
```

`server/package.json`:

```json
{
  "name": "@grove/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts"
  },
  "dependencies": {
    "@fastify/static": "^8.0.0",
    "@fastify/websocket": "^11.0.0",
    "@grove/shared": "*",
    "chia-wallet-sdk": "^0.33.0",
    "fastify": "^5.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0"
  }
}
```

`server/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src", "test"]
}
```

`web/package.json`:

```json
{
  "name": "@grove/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "@grove/shared": "*",
    "three": "^0.170.0"
  },
  "devDependencies": {
    "@types/three": "^0.170.0",
    "vite": "^6.0.0"
  }
}
```

`web/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "lib": ["ES2022", "DOM"] },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Install and verify**

Run: `cd /Users/don/src/dkackman/chia-grove && npm install && npm test`
Expected: install succeeds (downloads the napi prebuilt binary); vitest prints "No test files found" and exits 0 (`passWithNoTests`).

Also add `@types/node` if `npm install` warns it is missing for the server tsconfig: `npm install -D -w server @types/node`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: scaffold npm workspaces (shared/server/web)"
```

---

### Task 2: Shared grove event types

**Files:**

- Create: `shared/src/index.ts`

These types are the entire server↔browser contract. Types only — no test.

- [ ] **Step 1: Write the types**

`shared/src/index.ts`:

```ts
export type SproutKind = "xch" | "cat" | "nft" | "did";

export interface BlockEvent {
  type: "block";
  height: number;
  headerHash: string; // hex, no 0x
  timestamp: number; // unix seconds
  spendCount: number;
  fees: string; // mojos
}

export interface SproutEvent {
  type: "sprout";
  kind: SproutKind;
  height: number;
  coinId: string; // hex, no 0x
  amount: string; // mojos
  mint?: boolean; // spent coin's parent was a singleton launcher
  assetId?: string; // CAT only, hex
  launcherId?: string; // NFT only, hex
  imageUrl?: string; // NFT only, first http(s) data URI
}

export interface AmbientEvent {
  type: "ambient";
  peakHeight: number;
  mempoolSize: number;
  mempoolCost: string;
  mempoolFees: string;
  netspace: string; // bytes
}

export interface ReorgEvent {
  type: "reorg";
  forkHeight: number;
}

export type GroveEvent = BlockEvent | SproutEvent | AmbientEvent | ReorgEvent;

export interface Snapshot {
  type: "snapshot";
  events: GroveEvent[];
}

export type WireMessage = GroveEvent | Snapshot;
```

- [ ] **Step 2: Commit**

```bash
git add shared
git commit -m "feat(shared): grove event wire types"
```

---

### Task 3: Ring buffer

**Files:**

- Create: `server/src/web/ring-buffer.ts`
- Test: `server/test/ring-buffer.test.ts`

- [ ] **Step 1: Write the failing test**

`server/test/ring-buffer.test.ts`:

```ts
import { expect, test } from "vitest";
import { RingBuffer } from "../src/web/ring-buffer.js";

test("keeps insertion order", () => {
  const buffer = new RingBuffer<number>(5);
  buffer.push(1);
  buffer.push(2);
  buffer.push(3);
  expect(buffer.snapshot()).toEqual([1, 2, 3]);
});

test("drops oldest beyond capacity", () => {
  const buffer = new RingBuffer<number>(3);
  for (const n of [1, 2, 3, 4, 5]) buffer.push(n);
  expect(buffer.snapshot()).toEqual([3, 4, 5]);
});

test("snapshot is a copy", () => {
  const buffer = new RingBuffer<number>(3);
  buffer.push(1);
  const snap = buffer.snapshot();
  snap.push(99);
  expect(buffer.snapshot()).toEqual([1]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- ring-buffer`
Expected: FAIL — cannot find module `../src/web/ring-buffer.js`.

- [ ] **Step 3: Write the implementation**

`server/src/web/ring-buffer.ts`:

```ts
export class RingBuffer<T> {
  private items: T[] = [];

  constructor(private readonly capacity: number) {}

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.capacity) this.items.shift();
  }

  snapshot(): T[] {
    return [...this.items];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- ring-buffer`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/web/ring-buffer.ts server/test/ring-buffer.test.ts
git commit -m "feat(server): event ring buffer"
```

---

### Task 4: Classifier (spends → grove events)

**Files:**

- Create: `server/src/classify/classify.ts`
- Test: `server/test/classify.test.ts`

The only logic-dense module. Tests use the SDK's in-memory `Simulator` + `Clvm` to construct _real_ standard/CAT/NFT/DID coin spends — no network, fully deterministic. The patterns below are lifted from the SDK's own napi test suite (`napi/__test__/nfts.spec.ts`, `cats.spec.ts` in the chia-wallet-sdk repo).

Key SDK facts (verified against `chia-wallet-sdk@0.33.0` typings):

- `new Clvm()`; `clvm.deserializeWithBackrefs(bytes): Program`; `program.puzzle(): Puzzle`
- `puzzle.parseNft(coin, solution): ParsedNft | null` → `.nft.info.launcherId: Buffer`, `.nft.info.metadata: Program` → `.parseNftMetadata(): NftMetadata | null` → `.dataUris: string[]`
- `puzzle.parseCat(coin, solution): ParsedCat | null` → `.cat.info.assetId: Buffer`
- `puzzle.parseDid(coin, solution): ParsedDid | null`
- `Constants.singletonLauncherHash(): Buffer`
- `CoinSpend`: `.coin: Coin` (`.coinId(): Buffer`, `.parentCoinInfo: Buffer`, `.puzzleHash: Buffer`, `.amount: bigint`), `.puzzleReveal: Buffer`, `.solution: Buffer`
- Simulator/Clvm builders used by tests: `sim.bls(amount)`, `clvm.spendStandardCoin(coin, pk, spend)`, `clvm.delegatedSpend(conditions)`, `clvm.standardSpend(pk, spend)`, `clvm.createCoin(puzzleHash, amount, hint?)`, `clvm.coinSpends(): CoinSpend[]`, `clvm.mintNfts(parentCoinId, mints)`, `clvm.createEveDid(parentCoinId, p2PuzzleHash)`, `clvm.spendNft(nft, spend)`, `clvm.spendDid(did, spend)`, `clvm.spendCats(catSpends)`, `clvm.runCatTail(program, solution)`, `clvm.nil()`, `clvm.alloc(value)`, `standardPuzzleHash(pk)`

Mint detection: an NFT/DID mint spends a **singleton launcher** coin in the same block; the eve singleton's `parentCoinInfo` equals that launcher's coin ID. So: collect coin IDs of launcher spends in the block, flag sprouts whose parent is in that set. Launcher spends themselves are excluded from sprouts (plumbing, not activity).

- [ ] **Step 1: Write the failing tests**

`server/test/classify.test.ts`:

```ts
import { expect, test } from "vitest";
import {
  Cat,
  CatInfo,
  CatSpend,
  Clvm,
  Coin,
  Constants,
  NftMint,
  Simulator,
  standardPuzzleHash,
  type CoinSpend,
  type PublicKey,
} from "chia-wallet-sdk";
import { classifyBlock, type BlockInput } from "../src/classify/classify.js";
import type { SproutEvent } from "@grove/shared";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

function block(spends: CoinSpend[], height = 100): BlockInput {
  return {
    height,
    headerHash: "aa".repeat(32),
    timestamp: 1_718_000_000,
    fees: 25n,
    spends,
  };
}

function sprouts(spends: CoinSpend[]): SproutEvent[] {
  return classifyBlock(block(spends)).filter((e): e is SproutEvent => e.type === "sprout");
}

// Mirrors the createDid helper in the SDK's own nfts.spec.ts.
function createDid(clvm: Clvm, parentCoinId: Buffer, pk: PublicKey) {
  const p2PuzzleHash = standardPuzzleHash(pk);
  const eveDid = clvm.createEveDid(parentCoinId, p2PuzzleHash);
  clvm.spendDid(
    eveDid.did,
    clvm.standardSpend(
      pk,
      clvm.delegatedSpend([
        clvm.createCoin(eveDid.did.info.innerPuzzleHash(), 1n, clvm.alloc([p2PuzzleHash])),
      ])
    )
  );
  return {
    did: eveDid.did.child(p2PuzzleHash, eveDid.did.info.metadata),
    parentConditions: eveDid.parentConditions,
  };
}

test("emits a block event first with counts and fees", () => {
  const sim = new Simulator();
  const clvm = new Clvm();
  const alice = sim.bls(1000n);
  clvm.spendStandardCoin(
    alice.coin,
    alice.pk,
    clvm.delegatedSpend([clvm.createCoin(alice.puzzleHash, 1000n)])
  );
  const events = classifyBlock(block(clvm.coinSpends()));
  expect(events[0]).toEqual({
    type: "block",
    height: 100,
    headerHash: "aa".repeat(32),
    timestamp: 1_718_000_000,
    spendCount: 1,
    fees: "25",
  });
});

test("standard spend classifies as xch with mojo amount", () => {
  const sim = new Simulator();
  const clvm = new Clvm();
  const alice = sim.bls(1000n);
  clvm.spendStandardCoin(
    alice.coin,
    alice.pk,
    clvm.delegatedSpend([clvm.createCoin(alice.puzzleHash, 1000n)])
  );
  const result = sprouts(clvm.coinSpends());
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({
    kind: "xch",
    amount: "1000",
    height: 100,
    coinId: hex(alice.coin.coinId()),
  });
  expect(result[0].mint).toBeUndefined();
});

test("cat spend carries deterministic assetId", () => {
  const sim = new Simulator();
  const clvm = new Clvm();
  const alice = sim.bls(1n);
  const tail = clvm.nil();
  const assetId = tail.treeHash();
  const catInfo = new CatInfo(assetId, null, alice.puzzleHash);

  clvm.spendStandardCoin(
    alice.coin,
    alice.pk,
    clvm.delegatedSpend([clvm.createCoin(catInfo.puzzleHash(), 1n)])
  );
  const eve = new Cat(new Coin(alice.coin.coinId(), catInfo.puzzleHash(), 1n), null, catInfo);
  clvm.spendCats([
    new CatSpend(
      eve,
      clvm.standardSpend(
        alice.pk,
        clvm.delegatedSpend([
          clvm.createCoin(alice.puzzleHash, 1n, clvm.alloc([alice.puzzleHash])),
          clvm.runCatTail(tail, clvm.nil()),
        ])
      )
    ),
  ]);

  const result = sprouts(clvm.coinSpends());
  const cats = result.filter((s) => s.kind === "cat");
  expect(cats).toHaveLength(1);
  expect(cats[0].assetId).toBe(hex(assetId));
});

test("nft mint flow yields nft sprout with mint flag and did sprout; launcher spends excluded", () => {
  const sim = new Simulator();
  const clvm = new Clvm();
  const alice = sim.bls(2n);

  const { did, parentConditions: didParentConditions } = createDid(
    clvm,
    alice.coin.coinId(),
    alice.pk
  );
  clvm.spendStandardCoin(
    alice.coin,
    alice.pk,
    clvm.delegatedSpend(didParentConditions.concat([clvm.createCoin(alice.puzzleHash, 0n)]))
  );

  const mintCoin = new Coin(alice.coin.coinId(), alice.puzzleHash, 0n);
  const {
    nfts: [nft],
    parentConditions: mintParentConditions,
  } = clvm.mintNfts(mintCoin.coinId(), [
    new NftMint(
      clvm.nil(),
      Constants.nftMetadataUpdaterDefaultHash(),
      alice.puzzleHash,
      alice.puzzleHash,
      300,
      null
    ),
  ]);
  clvm.spendStandardCoin(mintCoin, alice.pk, clvm.delegatedSpend(mintParentConditions));
  clvm.spendNft(
    nft,
    clvm.standardSpend(
      alice.pk,
      clvm.delegatedSpend([
        clvm.createCoin(alice.puzzleHash, 1n, clvm.alloc([alice.puzzleHash])),
        clvm.transferNft(did.info.launcherId, [], did.info.innerPuzzleHash()),
      ])
    )
  );
  clvm.spendDid(
    did,
    clvm.standardSpend(
      alice.pk,
      clvm.delegatedSpend([
        clvm.createCoin(alice.puzzleHash, 1n, clvm.alloc([alice.puzzleHash])),
        clvm.createPuzzleAnnouncement(nft.info.launcherId),
      ])
    )
  );

  const spends = clvm.coinSpends();
  const result = sprouts(spends);

  const launcherHash = hex(Constants.singletonLauncherHash());
  const launcherSpendCount = spends.filter((s) => hex(s.coin.puzzleHash) === launcherHash).length;
  expect(launcherSpendCount).toBeGreaterThan(0);

  const nftSprouts = result.filter((s) => s.kind === "nft");
  expect(nftSprouts).toHaveLength(1);
  expect(nftSprouts[0].mint).toBe(true);
  expect(nftSprouts[0].launcherId).toBe(hex(nft.info.launcherId));
  expect(nftSprouts[0].imageUrl).toBeUndefined(); // nil metadata

  expect(result.filter((s) => s.kind === "did").length).toBeGreaterThan(0);
  expect(result.filter((s) => s.kind === "xch").length).toBeGreaterThan(0);
  // no sprout is a launcher spend
  expect(result).toHaveLength(spends.length - launcherSpendCount);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- classify`
Expected: FAIL — cannot find module `../src/classify/classify.js`.

- [ ] **Step 3: Write the implementation**

`server/src/classify/classify.ts`:

```ts
import { Clvm, Constants, type CoinSpend } from "chia-wallet-sdk";
import type { GroveEvent, SproutEvent } from "@grove/shared";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const LAUNCHER_HASH = hex(Constants.singletonLauncherHash());

export interface BlockInput {
  height: number;
  headerHash: string;
  timestamp: number;
  fees: bigint;
  spends: CoinSpend[];
}

export function classifyBlock(block: BlockInput): GroveEvent[] {
  const clvm = new Clvm();

  const launcherCoinIds = new Set(
    block.spends
      .filter((s) => hex(s.coin.puzzleHash) === LAUNCHER_HASH)
      .map((s) => hex(s.coin.coinId()))
  );

  const events: GroveEvent[] = [
    {
      type: "block",
      height: block.height,
      headerHash: block.headerHash,
      timestamp: block.timestamp,
      spendCount: block.spends.length,
      fees: block.fees.toString(),
    },
  ];

  for (const spend of block.spends) {
    if (hex(spend.coin.puzzleHash) === LAUNCHER_HASH) continue;
    events.push(classifySpend(clvm, spend, block.height, launcherCoinIds));
  }
  return events;
}

function classifySpend(
  clvm: Clvm,
  spend: CoinSpend,
  height: number,
  launcherCoinIds: Set<string>
): SproutEvent {
  const base: SproutEvent = {
    type: "sprout",
    kind: "xch",
    height,
    coinId: hex(spend.coin.coinId()),
    amount: spend.coin.amount.toString(),
  };
  const mint = launcherCoinIds.has(hex(spend.coin.parentCoinInfo)) ? true : undefined;

  try {
    const puzzle = clvm.deserializeWithBackrefs(spend.puzzleReveal).puzzle();
    const solution = clvm.deserializeWithBackrefs(spend.solution);

    const nft = puzzle.parseNft(spend.coin, solution);
    if (nft) {
      const meta = nft.nft.info.metadata.parseNftMetadata();
      const imageUrl = meta?.dataUris.find(
        (u) => u.startsWith("https://") || u.startsWith("http://")
      );
      return {
        ...base,
        kind: "nft",
        mint,
        launcherId: hex(nft.nft.info.launcherId),
        ...(imageUrl ? { imageUrl } : {}),
      };
    }

    const cat = puzzle.parseCat(spend.coin, solution);
    if (cat) return { ...base, kind: "cat", assetId: hex(cat.cat.info.assetId) };

    const did = puzzle.parseDid(spend.coin, solution);
    if (did) return { ...base, kind: "did", mint };
  } catch {
    // unparseable puzzle → treat as plain xch
  }
  return base;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- classify`
Expected: 4 tests PASS. If `parseNft`/`parseCat` signature errors appear, re-check the installed `chia-wallet-sdk` version is >= 0.33.0 (`npm ls chia-wallet-sdk`).

- [ ] **Step 5: Commit**

```bash
git add server/src/classify server/test/classify.test.ts
git commit -m "feat(server): classify block spends into grove events"
```

---

### Task 5: Coinset poller

**Files:**

- Create: `server/src/ingest/types.ts`, `server/src/ingest/coinset-poller.ts`, `server/src/ingest/coinset-view.ts`
- Test: `server/test/coinset-poller.test.ts`

The poller is written against a narrow `RpcView` interface so tests use a scripted fake. `coinset-view.ts` adapts the SDK's `RpcClient` to that interface — thin glue, exercised in Task 7's manual verification rather than unit tests.

- [ ] **Step 1: Write the interfaces**

`server/src/ingest/types.ts`:

```ts
import type { CoinSpend } from "chia-wallet-sdk";

export interface ChainState {
  peakHeight: number;
  peakHeaderHash: string;
  mempoolSize: number;
  mempoolCost: bigint;
  mempoolFees: bigint;
  space: bigint;
}

export interface BlockInfo {
  height: number;
  headerHash: string;
  prevHash: string;
  timestamp: bigint | null; // null for non-transaction blocks
  fees: bigint | null;
}

export interface RpcView {
  getState(): Promise<ChainState>;
  getBlockInfo(height: number): Promise<BlockInfo>;
  getSpends(headerHash: string): Promise<CoinSpend[]>;
}

export interface BlockData {
  height: number;
  headerHash: string;
  timestamp: number;
  fees: bigint;
  spends: CoinSpend[];
}

export interface ChainHandlers {
  onBlock(block: BlockData): void;
  onAmbient(state: ChainState): void;
  onReorg(forkHeight: number): void;
}

export interface ChainSource {
  start(): void;
  stop(): void;
}
```

- [ ] **Step 2: Write the failing tests**

`server/test/coinset-poller.test.ts`:

```ts
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CoinsetPoller } from "../src/ingest/coinset-poller.js";
import type { BlockData, BlockInfo, ChainState, RpcView } from "../src/ingest/types.js";

interface FakeBlock {
  height: number;
  headerHash: string;
  prevHash: string;
  timestamp: bigint | null;
}

class FakeRpc implements RpcView {
  blocks = new Map<number, FakeBlock>();
  peak = 0;
  failState = false;

  chain(hashes: Array<{ h: number; hash: string; tx?: boolean }>): void {
    for (const { h, hash, tx = true } of hashes) {
      const prev = this.blocks.get(h - 1);
      this.blocks.set(h, {
        height: h,
        headerHash: hash,
        prevHash: prev?.headerHash ?? "genesis",
        timestamp: tx ? BigInt(1_700_000_000 + h) : null,
      });
      this.peak = Math.max(this.peak, h);
    }
  }

  async getState(): Promise<ChainState> {
    if (this.failState) throw new Error("boom");
    const peak = this.blocks.get(this.peak)!;
    return {
      peakHeight: peak.height,
      peakHeaderHash: peak.headerHash,
      mempoolSize: 7,
      mempoolCost: 100n,
      mempoolFees: 5n,
      space: 30n * 2n ** 60n,
    };
  }

  async getBlockInfo(height: number): Promise<BlockInfo> {
    const b = this.blocks.get(height);
    if (!b) throw new Error(`no block at ${height}`);
    return { ...b, fees: 1n };
  }

  async getSpends(): Promise<never[]> {
    return [];
  }
}

function collect() {
  const blocks: BlockData[] = [];
  const ambients: ChainState[] = [];
  const reorgs: number[] = [];
  return {
    blocks,
    ambients,
    reorgs,
    handlers: {
      onBlock: (b: BlockData) => blocks.push(b),
      onAmbient: (s: ChainState) => ambients.push(s),
      onReorg: (f: number) => reorgs.push(f),
    },
  };
}

test("backfills the last N transaction blocks on first tick", async () => {
  const rpc = new FakeRpc();
  rpc.chain(Array.from({ length: 20 }, (_, i) => ({ h: i, hash: `h${i}` })));
  const sink = collect();
  const poller = new CoinsetPoller(rpc, sink.handlers, { backfillBlocks: 5 });
  await poller.tick();
  expect(sink.blocks.map((b) => b.height)).toEqual([15, 16, 17, 18, 19]);
  expect(sink.ambients).toHaveLength(1);
});

test("walks multi-block jumps and skips non-transaction blocks", async () => {
  const rpc = new FakeRpc();
  rpc.chain([{ h: 0, hash: "h0" }]);
  const sink = collect();
  const poller = new CoinsetPoller(rpc, sink.handlers, { backfillBlocks: 1 });
  await poller.tick();
  rpc.chain([
    { h: 1, hash: "h1" },
    { h: 2, hash: "h2", tx: false },
    { h: 3, hash: "h3" },
  ]);
  await poller.tick();
  expect(sink.blocks.map((b) => b.height)).toEqual([0, 1, 3]);
});

test("detects a reorg, emits fork height, and re-walks the new chain", async () => {
  const rpc = new FakeRpc();
  rpc.chain([
    { h: 0, hash: "h0" },
    { h: 1, hash: "h1" },
    { h: 2, hash: "h2" },
  ]);
  const sink = collect();
  const poller = new CoinsetPoller(rpc, sink.handlers, { backfillBlocks: 3 });
  await poller.tick();

  // replace blocks 1-2 with a competing chain and extend it
  rpc.blocks.set(1, {
    height: 1,
    headerHash: "h1b",
    prevHash: "h0",
    timestamp: BigInt(1_700_000_101),
  });
  rpc.blocks.set(2, {
    height: 2,
    headerHash: "h2b",
    prevHash: "h1b",
    timestamp: BigInt(1_700_000_102),
  });
  rpc.chain([{ h: 3, hash: "h3b" }]);
  await poller.tick();

  expect(sink.reorgs).toEqual([0]);
  expect(sink.blocks.map((b) => b.headerHash)).toEqual(["h0", "h1", "h2", "h1b", "h2b", "h3b"]);
});

test("backs off exponentially on failure and recovers", async () => {
  vi.useFakeTimers();
  const rpc = new FakeRpc();
  rpc.chain([{ h: 0, hash: "h0" }]);
  const sink = collect();
  const poller = new CoinsetPoller(rpc, sink.handlers, {
    pollIntervalMs: 1000,
    backfillBlocks: 1,
    maxBackoffMs: 8000,
  });

  rpc.failState = true;
  poller.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(poller.delayMs).toBe(2000);
  await vi.advanceTimersByTimeAsync(2000);
  expect(poller.delayMs).toBe(4000);
  await vi.advanceTimersByTimeAsync(4000);
  await vi.advanceTimersByTimeAsync(8000);
  expect(poller.delayMs).toBe(8000); // capped

  rpc.failState = false;
  await vi.advanceTimersByTimeAsync(8000);
  expect(poller.delayMs).toBe(1000); // reset on success
  expect(sink.blocks.map((b) => b.height)).toEqual([0]);
  poller.stop();
  vi.useRealTimers();
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- coinset-poller`
Expected: FAIL — cannot find module `../src/ingest/coinset-poller.js`.

- [ ] **Step 4: Write the poller**

`server/src/ingest/coinset-poller.ts`:

```ts
import type { ChainHandlers, ChainSource, RpcView } from "./types.js";

export interface PollerOptions {
  pollIntervalMs?: number;
  backfillBlocks?: number;
  maxBackoffMs?: number;
}

const KNOWN_HASHES = 64;

export class CoinsetPoller implements ChainSource {
  /** height -> headerHash for recent blocks, used for reorg detection */
  private known = new Map<number, string>();
  private lastHeight = -1;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  private readonly interval: number;
  private readonly backfill: number;
  private readonly maxBackoff: number;

  /** current delay; exposed for tests and observability */
  delayMs: number;

  constructor(
    private readonly rpc: RpcView,
    private readonly handlers: ChainHandlers,
    options: PollerOptions = {}
  ) {
    this.interval = options.pollIntervalMs ?? 3000;
    this.backfill = options.backfillBlocks ?? 30;
    this.maxBackoff = options.maxBackoffMs ?? 60_000;
    this.delayMs = this.interval;
  }

  start(): void {
    this.stopped = false;
    void this.loop();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private async loop(): Promise<void> {
    try {
      await this.tick();
      this.delayMs = this.interval;
    } catch (error) {
      this.delayMs = Math.min(this.delayMs * 2, this.maxBackoff);
      console.warn(`poll failed (retry in ${this.delayMs}ms):`, error);
    }
    if (!this.stopped) {
      this.timer = setTimeout(() => void this.loop(), this.delayMs);
    }
  }

  /** One poll cycle. Public so tests can drive it directly. */
  async tick(): Promise<void> {
    const state = await this.rpc.getState();
    this.handlers.onAmbient(state);
    if (this.lastHeight < 0) {
      this.lastHeight = Math.max(-1, state.peakHeight - this.backfill);
    }
    await this.walkTo(state.peakHeight);
  }

  private async walkTo(peak: number): Promise<void> {
    let height = this.lastHeight + 1;
    while (height <= peak) {
      const info = await this.rpc.getBlockInfo(height);

      const prevKnown = this.known.get(height - 1);
      if (prevKnown !== undefined && info.prevHash !== prevKnown) {
        const fork = await this.findFork(height - 1);
        this.handlers.onReorg(fork);
        for (const h of [...this.known.keys()]) {
          if (h > fork) this.known.delete(h);
        }
        this.lastHeight = fork;
        height = fork + 1;
        continue;
      }

      this.known.set(height, info.headerHash);
      this.trimKnown();

      if (info.timestamp !== null) {
        const spends = await this.rpc.getSpends(info.headerHash);
        this.handlers.onBlock({
          height,
          headerHash: info.headerHash,
          timestamp: Number(info.timestamp),
          fees: info.fees ?? 0n,
          spends,
        });
      }
      this.lastHeight = height;
      height += 1;
    }
  }

  /** Walk back from `from` until our recorded hash matches the chain. */
  private async findFork(from: number): Promise<number> {
    for (let height = from; height >= 0; height--) {
      const knownHash = this.known.get(height);
      if (knownHash === undefined) return height; // beyond memory
      const info = await this.rpc.getBlockInfo(height);
      if (info.headerHash === knownHash) return height;
    }
    return -1;
  }

  private trimKnown(): void {
    while (this.known.size > KNOWN_HASHES) {
      this.known.delete(Math.min(...this.known.keys()));
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- coinset-poller`
Expected: 4 tests PASS. (Note for the reorg test: blocks h1/h2 are re-emitted as h1b/h2b after the `reorg` event — the frontend treats post-reorg blocks as fresh plantings.)

- [ ] **Step 6: Write the RpcClient adapter**

`server/src/ingest/coinset-view.ts`:

```ts
import type { RpcClient } from "chia-wallet-sdk";
import type { BlockInfo, ChainState, RpcView } from "./types.js";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const unhex = (h: string) => Uint8Array.from(Buffer.from(h, "hex"));

export function coinsetView(rpc: RpcClient): RpcView {
  return {
    async getState(): Promise<ChainState> {
      const res = await rpc.getBlockchainState();
      const state = res.blockchainState;
      if (!res.success || !state) {
        throw new Error(`getBlockchainState: ${res.error ?? "no state"}`);
      }
      return {
        peakHeight: state.peak.height,
        peakHeaderHash: hex(state.peak.headerHash),
        mempoolSize: state.mempoolSize,
        mempoolCost: state.mempoolCost,
        mempoolFees: state.mempoolFees,
        space: state.space,
      };
    },

    async getBlockInfo(height: number): Promise<BlockInfo> {
      const res = await rpc.getBlockRecordByHeight(height);
      const record = res.blockRecord;
      if (!res.success || !record) {
        throw new Error(`getBlockRecordByHeight(${height}): ${res.error ?? "no record"}`);
      }
      return {
        height: record.height,
        headerHash: hex(record.headerHash),
        prevHash: hex(record.prevHash),
        timestamp: record.timestamp,
        fees: record.fees,
      };
    },

    async getSpends(headerHash: string) {
      const res = await rpc.getBlockSpends(unhex(headerHash));
      if (!res.success || !res.blockSpends) {
        throw new Error(`getBlockSpends: ${res.error ?? "no spends"}`);
      }
      return res.blockSpends;
    },
  };
}
```

- [ ] **Step 7: Type-check and commit**

Run: `npx tsc -p server/tsconfig.json`
Expected: no errors. (If `record.timestamp` is typed `bigint | undefined` rather than `bigint | null` in the installed version, coerce with `?? null` in the adapter.)

```bash
git add server/src/ingest server/test/coinset-poller.test.ts
git commit -m "feat(server): coinset poller with backfill, reorg rewind, and backoff"
```

---

### Task 6: WebSocket hub and Fastify app

**Files:**

- Create: `server/src/web/hub.ts`, `server/src/web/server.ts`
- Test: `server/test/hub.test.ts`

The hub owns fan-out and backpressure. It is tested with fake sockets; the Fastify app is thin glue (verified in Task 7).

Buffer policy: `ambient` events are high-frequency and idempotent — they are **not** stored in the ring buffer (the snapshot would be all ambients); instead only the latest one is kept and appended to each snapshot. `block`/`sprout`/`reorg` go in the buffer. Backpressure: a client over 64 KiB of unsent data skips `ambient` events; over 1 MiB it is disconnected.

- [ ] **Step 1: Write the failing tests**

`server/test/hub.test.ts`:

```ts
import { expect, test } from "vitest";
import { Hub, type WireSocket } from "../src/web/hub.js";
import { RingBuffer } from "../src/web/ring-buffer.js";
import type { AmbientEvent, BlockEvent, GroveEvent } from "@grove/shared";

class FakeSocket implements WireSocket {
  sent: string[] = [];
  bufferedAmount = 0;
  readyState = 1; // OPEN
  closed = false;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  parsed(): unknown[] {
    return this.sent.map((s) => JSON.parse(s));
  }
}

const blockEvent = (height: number): BlockEvent => ({
  type: "block",
  height,
  headerHash: "ab".repeat(32),
  timestamp: 1_718_000_000,
  spendCount: 3,
  fees: "0",
});

const ambientEvent: AmbientEvent = {
  type: "ambient",
  peakHeight: 5,
  mempoolSize: 10,
  mempoolCost: "100",
  mempoolFees: "1",
  netspace: "999",
};

function makeHub() {
  return new Hub(new RingBuffer<GroveEvent>(500));
}

test("new client receives snapshot of buffered events plus latest ambient", () => {
  const hub = makeHub();
  hub.publish([blockEvent(1), ambientEvent, blockEvent(2)]);
  const socket = new FakeSocket();
  hub.add(socket);
  expect(socket.parsed()[0]).toEqual({
    type: "snapshot",
    events: [blockEvent(1), blockEvent(2), ambientEvent],
  });
});

test("publish fans out to connected clients", () => {
  const hub = makeHub();
  const a = new FakeSocket();
  const b = new FakeSocket();
  hub.add(a);
  hub.add(b);
  hub.publish([blockEvent(1)]);
  expect(a.parsed()[1]).toEqual(blockEvent(1));
  expect(b.parsed()[1]).toEqual(blockEvent(1));
});

test("slow client skips ambient but still gets blocks", () => {
  const hub = makeHub();
  const slow = new FakeSocket();
  hub.add(slow);
  slow.bufferedAmount = 100 * 1024; // over soft limit
  hub.publish([ambientEvent, blockEvent(1)]);
  const types = slow.parsed().map((m) => (m as GroveEvent).type);
  expect(types).toEqual(["snapshot", "block"]);
});

test("hopelessly behind client is disconnected", () => {
  const hub = makeHub();
  const dead = new FakeSocket();
  hub.add(dead);
  dead.bufferedAmount = 2 * 1024 * 1024; // over hard limit
  hub.publish([blockEvent(1)]);
  expect(dead.closed).toBe(true);
  hub.publish([blockEvent(2)]);
  expect(dead.parsed().filter((m) => (m as GroveEvent).type === "block")).toHaveLength(0);
});

test("removed client receives nothing", () => {
  const hub = makeHub();
  const socket = new FakeSocket();
  hub.add(socket);
  hub.remove(socket);
  hub.publish([blockEvent(1)]);
  expect(socket.sent).toHaveLength(1); // just the snapshot
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- hub`
Expected: FAIL — cannot find module `../src/web/hub.js`.

- [ ] **Step 3: Write the hub**

`server/src/web/hub.ts`:

```ts
import type { AmbientEvent, GroveEvent } from "@grove/shared";
import type { RingBuffer } from "./ring-buffer.js";

const SOFT_LIMIT = 64 * 1024;
const HARD_LIMIT = 1024 * 1024;
const OPEN = 1;

/** Minimal surface of the ws WebSocket used by the hub (test seam). */
export interface WireSocket {
  send(data: string): void;
  close(): void;
  readonly bufferedAmount: number;
  readonly readyState: number;
}

export class Hub {
  private clients = new Set<WireSocket>();
  private lastAmbient: AmbientEvent | null = null;

  constructor(private readonly buffer: RingBuffer<GroveEvent>) {}

  add(socket: WireSocket): void {
    const events: GroveEvent[] = this.buffer.snapshot();
    if (this.lastAmbient) events.push(this.lastAmbient);
    socket.send(JSON.stringify({ type: "snapshot", events }));
    this.clients.add(socket);
  }

  remove(socket: WireSocket): void {
    this.clients.delete(socket);
  }

  publish(events: GroveEvent[]): void {
    for (const event of events) {
      if (event.type === "ambient") this.lastAmbient = event;
      else this.buffer.push(event);

      const data = JSON.stringify(event);
      for (const socket of [...this.clients]) {
        if (socket.readyState !== OPEN || socket.bufferedAmount > HARD_LIMIT) {
          socket.close();
          this.clients.delete(socket);
          continue;
        }
        if (event.type === "ambient" && socket.bufferedAmount > SOFT_LIMIT) {
          continue;
        }
        socket.send(data);
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- hub`
Expected: 5 tests PASS.

- [ ] **Step 5: Write the Fastify app factory**

`server/src/web/server.ts`:

```ts
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import type { Hub, WireSocket } from "./hub.js";

export async function buildServer(hub: Hub): Promise<FastifyInstance> {
  const app = fastify({ logger: false });
  await app.register(websocket);

  app.get("/healthz", async () => ({ ok: true }));

  app.register(async (instance) => {
    instance.get("/ws", { websocket: true }, (socket) => {
      const wire = socket as unknown as WireSocket;
      hub.add(wire);
      socket.on("close", () => hub.remove(wire));
      socket.on("error", () => hub.remove(wire));
    });
  });

  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../web/dist");
  if (existsSync(dist)) {
    await app.register(fastifyStatic, { root: dist });
  }

  return app;
}
```

- [ ] **Step 6: Type-check and commit**

Run: `npx tsc -p server/tsconfig.json && npm test`
Expected: clean compile; all server tests PASS.

```bash
git add server/src/web server/test/hub.test.ts
git commit -m "feat(server): websocket hub with backpressure and fastify app"
```

---

### Task 7: Server entry point (wiring)

**Files:**

- Create: `server/src/index.ts`

- [ ] **Step 1: Write the entry point**

`server/src/index.ts`:

```ts
import { RpcClient } from "chia-wallet-sdk";
import type { GroveEvent } from "@grove/shared";
import { classifyBlock } from "./classify/classify.js";
import { CoinsetPoller } from "./ingest/coinset-poller.js";
import { coinsetView } from "./ingest/coinset-view.js";
import { Hub } from "./web/hub.js";
import { RingBuffer } from "./web/ring-buffer.js";
import { buildServer } from "./web/server.js";

const PORT = Number(process.env.PORT ?? 8080);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 3000);
const BACKFILL_BLOCKS = Number(process.env.BACKFILL_BLOCKS ?? 30);

const hub = new Hub(new RingBuffer<GroveEvent>(500));

const poller = new CoinsetPoller(
  coinsetView(RpcClient.mainnet()),
  {
    onBlock(block) {
      hub.publish(classifyBlock(block));
      console.log(`block ${block.height} (${block.spends.length} spends)`);
    },
    onAmbient(state) {
      hub.publish([
        {
          type: "ambient",
          peakHeight: state.peakHeight,
          mempoolSize: state.mempoolSize,
          mempoolCost: state.mempoolCost.toString(),
          mempoolFees: state.mempoolFees.toString(),
          netspace: state.space.toString(),
        },
      ]);
    },
    onReorg(forkHeight) {
      console.warn(`reorg back to ${forkHeight}`);
      hub.publish([{ type: "reorg", forkHeight }]);
    },
  },
  { pollIntervalMs: POLL_INTERVAL_MS, backfillBlocks: BACKFILL_BLOCKS }
);

const app = await buildServer(hub);
await app.listen({ port: PORT, host: "0.0.0.0" });
poller.start();
console.log(`chia-grove server on :${PORT}`);
```

- [ ] **Step 2: Manual verification against mainnet (requires network)**

Run: `npm run dev:server`
Expected within ~30 s: `chia-grove server on :8080`, then `block <height> (<n> spends)` lines for ~30 backfilled blocks, then a fresh block roughly every 20–60 s.

Run: `curl -s localhost:8080/healthz`
Expected: `{"ok":true}`

Run: `npx wscat -c ws://localhost:8080/ws --no-color | head -c 400` (or any ws client)
Expected: a `{"type":"snapshot","events":[...]}` line containing block and sprout events.

Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add server/src/index.ts
git commit -m "feat(server): wire poller, classifier, and hub into entry point"
```

---

### Task 8: Web scaffold, feed, and demo mode

**Files:**

- Create: `web/vite.config.ts`, `web/index.html`, `web/src/style.css`, `web/src/main.ts`
- Create: `web/src/net/feed.ts`, `web/src/net/demo.ts`

Demo mode (`?demo=1`) is the visual dev harness for all remaining tasks — it must come before the scene. The feed dispatches `GroveEvent`s to listeners and tracks status (`connecting/live/stale/demo`); snapshots replay over ~3 s so the grove visibly grows in.

- [ ] **Step 1: Write Vite config and HTML shell**

`web/vite.config.ts` (proxies `/ws` to the dev server):

```ts
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/ws": { target: "ws://localhost:8080", ws: true },
    },
  },
});
```

`web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Chia Grove</title>
    <link rel="stylesheet" href="/src/style.css" />
  </head>
  <body>
    <canvas id="grove"></canvas>
    <div id="status" hidden></div>
    <div id="card" hidden></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`web/src/style.css`:

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html,
body {
  height: 100%;
  overflow: hidden;
  background: #020806;
}

#grove {
  display: block;
  width: 100%;
  height: 100%;
}

#status {
  position: fixed;
  top: 14px;
  right: 16px;
  font:
    12px/1.4 ui-monospace,
    monospace;
  color: rgba(185, 255, 217, 0.5);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  pointer-events: none;
}

#card {
  position: fixed;
  bottom: 24px;
  left: 24px;
  max-width: 300px;
  padding: 14px 16px;
  border-radius: 10px;
  background: rgba(4, 17, 10, 0.88);
  border: 1px solid rgba(61, 220, 132, 0.25);
  backdrop-filter: blur(6px);
  font:
    13px/1.5 ui-monospace,
    monospace;
  color: #b9ffd9;
}

#card h3 {
  font-size: 14px;
  margin-bottom: 6px;
  color: #eafff2;
}

#card img {
  width: 100%;
  border-radius: 6px;
  margin: 8px 0;
  display: block;
}

#card a {
  color: #5ef0a0;
}

#card .dim {
  color: rgba(185, 255, 217, 0.55);
  word-break: break-all;
}
```

- [ ] **Step 2: Write the demo event generator**

`web/src/net/demo.ts`:

```ts
import type { GroveEvent, SproutEvent, SproutKind } from "@grove/shared";

const randomHex = (bytes: number): string =>
  Array.from({ length: bytes * 2 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join(
    ""
  );

// a few stable fake CAT asset ids so colonies form by color
const DEMO_ASSET_IDS = Array.from({ length: 6 }, () => randomHex(32));

function randomKind(): SproutKind {
  const roll = Math.random();
  if (roll < 0.85) return "xch";
  if (roll < 0.94) return "cat";
  if (roll < 0.98) return "nft";
  return "did";
}

function sprout(height: number): SproutEvent {
  const kind = randomKind();
  const event: SproutEvent = {
    type: "sprout",
    kind,
    height,
    coinId: randomHex(32),
    // log-uniform mojo amounts from 1000 to ~100 XCH
    amount: String(Math.floor(10 ** (3 + Math.random() * 11))),
  };
  if (kind === "cat") {
    event.assetId = DEMO_ASSET_IDS[Math.floor(Math.random() * DEMO_ASSET_IDS.length)];
  }
  if (kind === "nft") {
    event.launcherId = randomHex(32);
    if (Math.random() < 0.25) event.mint = true;
  }
  return event;
}

function blockWithSprouts(height: number): GroveEvent[] {
  const count = 2 + Math.floor(Math.random() * 14);
  return [
    {
      type: "block",
      height,
      headerHash: randomHex(32),
      timestamp: Math.floor(Date.now() / 1000),
      spendCount: count,
      fees: String(Math.floor(Math.random() * 1e9)),
    },
    ...Array.from({ length: count }, () => sprout(height)),
  ];
}

export function startDemo(dispatch: (event: GroveEvent) => void): void {
  let height = 7_000_000;
  let mempool = 60;

  // synthetic snapshot: 30 past blocks, replayed quickly
  const backlog: GroveEvent[] = [];
  for (let i = 0; i < 30; i++) backlog.push(...blockWithSprouts(height++));
  backlog.forEach((event, i) => setTimeout(() => dispatch(event), i * 12));

  setInterval(() => {
    for (const event of blockWithSprouts(height++)) dispatch(event);
  }, 8000);

  setInterval(() => {
    mempool = Math.max(5, Math.min(400, mempool + (Math.random() - 0.5) * 40));
    dispatch({
      type: "ambient",
      peakHeight: height,
      mempoolSize: Math.floor(mempool),
      mempoolCost: String(Math.floor(mempool * 5e9)),
      mempoolFees: String(Math.floor(mempool * 1e7)),
      netspace: String(33n * 2n ** 60n),
    });
  }, 2000);
}
```

- [ ] **Step 3: Write the feed**

`web/src/net/feed.ts`:

```ts
import type { GroveEvent, WireMessage } from "@grove/shared";
import { startDemo } from "./demo.js";

export type FeedStatus = "connecting" | "live" | "stale" | "demo";

const STALE_AFTER_MS = 2 * 60 * 1000;
const SNAPSHOT_REPLAY_MS = 3000;

export class GroveFeed {
  private listeners: Array<(event: GroveEvent) => void> = [];
  private statusListeners: Array<(status: FeedStatus) => void> = [];
  private staleTimer: number | undefined;
  private retryMs = 1000;

  onEvent(listener: (event: GroveEvent) => void): void {
    this.listeners.push(listener);
  }

  onStatus(listener: (status: FeedStatus) => void): void {
    this.statusListeners.push(listener);
  }

  start(): void {
    if (new URLSearchParams(location.search).get("demo") === "1") {
      this.setStatus("demo");
      startDemo((event) => this.dispatch(event));
      return;
    }
    this.connect();
  }

  private connect(): void {
    this.setStatus("connecting");
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);

    ws.onmessage = (message) => {
      const parsed = JSON.parse(message.data as string) as WireMessage;
      if (parsed.type === "snapshot") this.replay(parsed.events);
      else this.dispatch(parsed);
      this.setStatus("live");
      this.resetStaleTimer();
      this.retryMs = 1000;
    };

    ws.onclose = () => {
      this.setStatus("stale");
      setTimeout(() => this.connect(), this.retryMs + Math.random() * 1000);
      this.retryMs = Math.min(this.retryMs * 2, 30_000);
    };
  }

  /** Spread snapshot events over a few seconds so the grove grows in. */
  private replay(events: GroveEvent[]): void {
    const step = SNAPSHOT_REPLAY_MS / Math.max(events.length, 1);
    events.forEach((event, i) => setTimeout(() => this.dispatch(event), i * step));
  }

  private dispatch(event: GroveEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private setStatus(status: FeedStatus): void {
    for (const listener of this.statusListeners) listener(status);
  }

  private resetStaleTimer(): void {
    clearTimeout(this.staleTimer);
    this.staleTimer = window.setTimeout(() => this.setStatus("stale"), STALE_AFTER_MS);
  }
}
```

- [ ] **Step 4: Write a placeholder main.ts (scene arrives in Task 10)**

`web/src/main.ts`:

```ts
import { GroveFeed } from "./net/feed.js";

const status = document.getElementById("status") as HTMLDivElement;

const feed = new GroveFeed();
feed.onStatus((s) => {
  status.hidden = s === "live";
  status.textContent = s === "demo" ? "demo" : s === "stale" ? "signal lost" : "";
});
feed.onEvent((event) => console.log(event));
feed.start();
```

- [ ] **Step 5: Manual verification**

Run: `npm run dev:web`, open `http://localhost:5173/?demo=1`.
Expected: console logs a burst of ~30 blocks' worth of events, then a block group every 8 s and ambient every 2 s; "demo" badge top-right.

With `npm run dev:server` also running, open `http://localhost:5173/` (no query): console shows a snapshot replay of real mainnet events, then live events.

- [ ] **Step 6: Commit**

```bash
git add web
git commit -m "feat(web): vite scaffold, grove feed with reconnect, demo mode"
```

---

### Task 9: Pure frontend helpers (layout, palette, formatting)

**Files:**

- Create: `web/src/scene/layout.ts`, `web/src/scene/palette.ts`, `web/src/ui/format.ts`
- Test: `web/test/layout.test.ts`, `web/test/palette.test.ts`

All pure functions — no three.js imports — so they run in plain node vitest.

- [ ] **Step 1: Write the failing tests**

`web/test/layout.test.ts`:

```ts
import { expect, test } from "vitest";
import { blockPosition, sproutOffset } from "../src/scene/layout.js";

test("block positions spiral outward monotonically", () => {
  const r = (i: number) => Math.hypot(blockPosition(i).x, blockPosition(i).z);
  expect(r(1)).toBeGreaterThan(r(0));
  expect(r(50)).toBeGreaterThan(r(10));
  expect(r(0)).toBeGreaterThanOrEqual(6); // center clearing
});

test("consecutive blocks land at well-separated angles", () => {
  const a = blockPosition(10);
  const b = blockPosition(11);
  expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(2);
});

test("sprout offset is deterministic per coin id and within cluster", () => {
  const coinId = "deadbeef" + "00".repeat(28);
  const first = sproutOffset(coinId);
  const second = sproutOffset(coinId);
  expect(first).toEqual(second);
  expect(Math.hypot(first.x, first.z)).toBeLessThanOrEqual(1.8);
  const other = sproutOffset("cafebabe" + "00".repeat(28));
  expect(other).not.toEqual(first);
});
```

`web/test/palette.test.ts`:

```ts
import { expect, test } from "vitest";
import { catHue } from "../src/scene/palette.js";
import { mojosToXch } from "../src/ui/format.js";

test("catHue is deterministic and in range", () => {
  const assetId = "a1b2c3d4" + "00".repeat(28);
  expect(catHue(assetId)).toBe(catHue(assetId));
  expect(catHue(assetId)).toBeGreaterThanOrEqual(0);
  expect(catHue(assetId)).toBeLessThan(360);
  expect(catHue(assetId)).not.toBe(catHue("ffeeddcc" + "00".repeat(28)));
});

test("mojosToXch formats correctly", () => {
  expect(mojosToXch("1000000000000")).toBe("1");
  expect(mojosToXch("1500000000000")).toBe("1.5");
  expect(mojosToXch("1")).toBe("0.000000000001");
  expect(mojosToXch("123450000000000")).toBe("123.45");
  expect(mojosToXch("0")).toBe("0");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- web/test`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementations**

`web/src/scene/layout.ts`:

```ts
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ≈ 2.39996 rad
const CLEARING_RADIUS = 6;
const SPREAD = 2.2;
const CLUSTER_RADIUS = 1.8;

export interface XZ {
  x: number;
  z: number;
}

/** Phyllotaxis: block index → spiral position (sunflower-seed packing). */
export function blockPosition(index: number): XZ {
  const angle = index * GOLDEN_ANGLE;
  const radius = CLEARING_RADIUS + SPREAD * Math.sqrt(index);
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}

/** Deterministic PRNG (mulberry32) so plant scatter is stable per coin. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Scatter offset within a block's cluster, derived from the coin id. */
export function sproutOffset(coinIdHex: string): XZ {
  const rand = mulberry32(parseInt(coinIdHex.slice(0, 8), 16));
  const angle = rand() * Math.PI * 2;
  const radius = Math.sqrt(rand()) * CLUSTER_RADIUS;
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}
```

`web/src/scene/palette.ts`:

```ts
/** Deterministic hue (degrees) for a CAT asset id, so colonies share color. */
export function catHue(assetIdHex: string): number {
  return parseInt(assetIdHex.slice(0, 8), 16) % 360;
}

export const COLORS = {
  background: 0x020806,
  fog: 0x04110a,
  ground: 0x07150c,
  grass: 0x2fae66,
  grassEmissive: 0x0c3a1f,
  bloom: 0xfff2c9,
  bloomEmissive: 0xffd166,
  wisp: 0x9b5cff,
  firefly: 0xeaffbf,
  ripple: 0x3ddc84,
  moon: 0xcfe0ff,
} as const;
```

`web/src/ui/format.ts`:

```ts
/** Mojo string → XCH decimal string (1 XCH = 1e12 mojos). */
export function mojosToXch(mojos: string): string {
  const padded = mojos.padStart(13, "0");
  const whole = padded.slice(0, -12).replace(/^0+(?=\d)/, "");
  const frac = padded.slice(-12).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

export function shortHex(hex: string): string {
  return `${hex.slice(0, 8)}…${hex.slice(-6)}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all server + web tests PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/scene/layout.ts web/src/scene/palette.ts web/src/ui/format.ts web/test
git commit -m "feat(web): phyllotaxis layout, palette, and formatting helpers"
```

---

### Task 10: Scene bootstrap (renderer, sky, ground, camera drift)

**Files:**

- Create: `web/src/scene/textures.ts`, `web/src/scene/sky.ts`, `web/src/scene/ground.ts`, `web/src/scene/grove.ts`
- Modify: `web/src/main.ts`

Visual task — verified with the demo-mode browser, no unit tests. All animation is keyed to absolute clock time, so a hidden tab (browser pauses rAF automatically) catches up naturally when revealed.

- [ ] **Step 1: Write the texture helpers**

`web/src/scene/textures.ts`:

```ts
import * as THREE from "three";

/** Soft radial glow dot, tintable via material color. */
export function glowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.35, "rgba(255,255,255,0.55)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

/** Wide horizontal aurora band with vertical falloff. */
export function auroraTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const vertical = ctx.createLinearGradient(0, 0, 0, 128);
  vertical.addColorStop(0, "rgba(0,0,0,0)");
  vertical.addColorStop(0.45, "rgba(61,220,132,0.8)");
  vertical.addColorStop(0.65, "rgba(95,200,255,0.5)");
  vertical.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = vertical;
  ctx.fillRect(0, 0, 512, 128);
  return new THREE.CanvasTexture(canvas);
}
```

- [ ] **Step 2: Write the sky**

`web/src/scene/sky.ts`:

```ts
import * as THREE from "three";
import { COLORS } from "./palette.js";
import { auroraTexture, glowTexture } from "./textures.js";

export interface Sky {
  update(dt: number, t: number): void;
  pulse(): void;
  setNetspace(bytes: string): void;
  setSignalLost(lost: boolean): void;
}

export function createSky(scene: THREE.Scene): Sky {
  // starfield dome
  const starCount = 900;
  const positions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(0.15 + Math.random() * 0.85); // bias upward
    const radius = 180;
    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = radius * Math.cos(phi);
    positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const stars = new THREE.Points(
    starGeometry,
    new THREE.PointsMaterial({
      size: 1.1,
      map: glowTexture(),
      color: 0x9fb8aa,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  scene.add(stars);

  // moon
  const moonMaterial = new THREE.SpriteMaterial({
    map: glowTexture(),
    color: COLORS.moon,
    transparent: true,
    depthWrite: false,
  });
  const moon = new THREE.Sprite(moonMaterial);
  moon.position.set(-60, 58, -95);
  moon.scale.setScalar(26);
  scene.add(moon);

  const moonLight = new THREE.DirectionalLight(0xbfd8ff, 0.55);
  moonLight.position.copy(moon.position);
  scene.add(moonLight);

  // aurora band on the horizon
  const aurora = new THREE.Mesh(
    new THREE.PlaneGeometry(420, 90),
    new THREE.MeshBasicMaterial({
      map: auroraTexture(),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  aurora.position.set(0, 42, -160);
  scene.add(aurora);

  let auroraEnergy = 0;
  let moonTarget = 0.9;
  let signalLost = false;

  return {
    update(dt, t) {
      auroraEnergy = Math.max(0, auroraEnergy - dt / 4);
      aurora.material.opacity = auroraEnergy * 0.35;
      aurora.position.x = Math.sin(t * 0.05) * 30;

      const target = signalLost ? moonTarget * 0.35 : moonTarget;
      moonMaterial.opacity += (target - moonMaterial.opacity) * Math.min(dt, 1);
      moonLight.intensity = 0.15 + moonMaterial.opacity * 0.5;

      stars.rotation.y = t * 0.004;
    },
    pulse() {
      auroraEnergy = 1;
    },
    setNetspace(bytes) {
      const eib = Number(BigInt(bytes) >> 50n) / 1024;
      moonTarget = Math.min(1.05, Math.max(0.55, 0.55 + (eib - 10) * 0.0125));
    },
    setSignalLost(lost) {
      signalLost = lost;
    },
  };
}
```

- [ ] **Step 3: Write the ground**

`web/src/scene/ground.ts`:

```ts
import * as THREE from "three";
import { COLORS } from "./palette.js";

const RIPPLE_SECONDS = 3.5;
const POOL = 6;

export interface Ground {
  ripple(x: number, z: number): void;
  update(dt: number): void;
}

export function createGround(scene: THREE.Scene): Ground {
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(70, 64),
    new THREE.MeshStandardMaterial({ color: COLORS.ground, roughness: 1 })
  );
  disc.rotation.x = -Math.PI / 2;
  scene.add(disc);

  interface Ripple {
    mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
    age: number;
    active: boolean;
  }
  const ripples: Ripple[] = Array.from({ length: POOL }, () => {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1, 64),
      new THREE.MeshBasicMaterial({
        color: COLORS.ripple,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.06;
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, age: 0, active: false };
  });
  let next = 0;

  return {
    ripple(x, z) {
      const r = ripples[next];
      next = (next + 1) % POOL;
      r.mesh.position.set(x, 0.06, z);
      r.age = 0;
      r.active = true;
      r.mesh.visible = true;
    },
    update(dt) {
      for (const r of ripples) {
        if (!r.active) continue;
        r.age += dt;
        const progress = r.age / RIPPLE_SECONDS;
        if (progress >= 1) {
          r.active = false;
          r.mesh.visible = false;
          continue;
        }
        const scale = 1 + progress * 22;
        r.mesh.scale.set(scale, scale, 1);
        r.mesh.material.opacity = 0.45 * (1 - progress);
      }
    },
  };
}
```

- [ ] **Step 4: Write the composition root (flora/fireflies arrive in Tasks 11–12; stub them here as no-ops so this compiles and renders)**

`web/src/scene/grove.ts`:

```ts
import * as THREE from "three";
import type { GroveEvent, SproutEvent } from "@grove/shared";
import type { GroveFeed } from "../net/feed.js";
import { createGround } from "./ground.js";
import { blockPosition, type XZ } from "./layout.js";
import { COLORS } from "./palette.js";
import { createSky } from "./sky.js";

/** Spiral slots wrap so the grove never grows beyond the meadow. */
const MAX_BLOCK_SLOTS = 300;

// NOTE: no explicit return-type annotation — the inferred type must include
// the handler setters added via Object.assign (Tasks 11-13 rely on them).
export function startGrove(canvas: HTMLCanvasElement, feed: GroveFeed) {
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.setSize(innerWidth, innerHeight);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.background);
  scene.fog = new THREE.FogExp2(COLORS.fog, 0.016);

  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 500);

  scene.add(new THREE.HemisphereLight(0x23402e, 0x050a06, 0.7));

  const sky = createSky(scene);
  const ground = createGround(scene);

  // wired up in Tasks 11-12:
  let onSprout = (_event: SproutEvent, _blockPos: XZ) => {};
  let onAmbientExtra = (_mempoolSize: number, _mempoolCost: string) => {};
  let onBlockExtra = (_pos: XZ) => {};
  let onReorgExtra = () => {};
  let extraUpdate = (_dt: number, _t: number) => {};

  let blockIndex = 0;
  let currentBlockPos = blockPosition(0);

  feed.onEvent((event: GroveEvent) => {
    switch (event.type) {
      case "block":
        currentBlockPos = blockPosition(blockIndex);
        blockIndex = (blockIndex + 1) % MAX_BLOCK_SLOTS;
        ground.ripple(currentBlockPos.x, currentBlockPos.z);
        sky.pulse();
        onBlockExtra(currentBlockPos);
        break;
      case "sprout":
        onSprout(event, currentBlockPos);
        break;
      case "ambient":
        sky.setNetspace(event.netspace);
        onAmbientExtra(event.mempoolSize, event.mempoolCost);
        break;
      case "reorg":
        ground.ripple(0, 0);
        onReorgExtra();
        break;
    }
  });

  feed.onStatus((status) => sky.setSignalLost(status === "stale"));

  const clock = new THREE.Clock();
  function frame(): void {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;

    const angle = reducedMotion ? 0.8 : t * 0.02;
    const radius = 34 + (reducedMotion ? 0 : Math.sin(t * 0.07) * 2.5);
    camera.position.set(
      Math.cos(angle) * radius,
      13.5 + Math.sin(t * 0.05) * 0.8,
      Math.sin(angle) * radius
    );
    camera.lookAt(0, 2.5, 0);

    sky.update(dt, t);
    ground.update(dt);
    extraUpdate(dt, t);
    renderer.render(scene, camera);
  }
  frame();

  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // hooks consumed by later tasks (kept on the handle object via closure setters)
  return Object.assign(
    { renderer, camera, scene },
    {
      setSproutHandler: (fn: typeof onSprout) => (onSprout = fn),
      setAmbientHandler: (fn: typeof onAmbientExtra) => (onAmbientExtra = fn),
      setBlockHandler: (fn: typeof onBlockExtra) => (onBlockExtra = fn),
      setReorgHandler: (fn: typeof onReorgExtra) => (onReorgExtra = fn),
      setUpdateHandler: (fn: typeof extraUpdate) => (extraUpdate = fn),
      reducedMotion,
    }
  );
}

export type GroveRuntime = ReturnType<typeof startGrove>;
```

- [ ] **Step 5: Wire main.ts**

Replace `web/src/main.ts` with:

```ts
import { GroveFeed } from "./net/feed.js";
import { startGrove } from "./scene/grove.js";

const canvas = document.getElementById("grove") as HTMLCanvasElement;
const status = document.getElementById("status") as HTMLDivElement;

const feed = new GroveFeed();
feed.onStatus((s) => {
  status.hidden = s === "live";
  status.textContent = s === "demo" ? "demo" : s === "stale" ? "signal lost" : "";
});

startGrove(canvas, feed);
feed.start();
```

- [ ] **Step 6: Manual verification**

Run: `npm run dev:web`, open `http://localhost:5173/?demo=1`.
Expected: dark green meadow disc under a starfield with a glowing moon; slow orbital camera drift; a green ripple expands across the ground every ~8 s (demo block cadence); a faint aurora pulse rolls on the horizon with each ripple. No flora yet.

Check the console for errors; `vite build` must also pass: `npm run build`.

- [ ] **Step 7: Commit**

```bash
git add web/src
git commit -m "feat(web): scene bootstrap with sky, ground ripples, drifting camera"
```

---

### Task 11: Flora systems (grasses, mushrooms, blooms, wisps)

**Files:**

- Create: `web/src/scene/flora.ts`
- Modify: `web/src/main.ts`

One `InstancedMesh` per flora kind (grass / mushroom / bloom) with ring-recycled slots; wisps and NFT glow halos are individual sprites (low caps). Slot metadata (the originating `SproutEvent`) is retained for Task 13's picker. Growth eases in over ~1.6 s from `bornAt`; reusing a slot replaces the oldest plant (with 2400 grasses an individual swap is imperceptible — accepted simplification of "composting"). Reorg gust = brief global scale dip (Task 12 wires it).

- [ ] **Step 1: Write the flora module**

`web/src/scene/flora.ts`:

```ts
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { SproutEvent } from "@grove/shared";
import { sproutOffset, type XZ } from "./layout.js";
import { catHue, COLORS } from "./palette.js";
import { glowTexture } from "./textures.js";

const GROW_SECONDS = 1.6;
const CAPS = { grass: 2400, mushroom: 400, bloom: 120, wisp: 80 } as const;

interface Slot {
  meta: SproutEvent | null;
  bornAt: number;
  x: number;
  z: number;
  height: number;
}

const easeOutCubic = (p: number) => 1 - (1 - p) ** 3;

function makeSlots(cap: number): Slot[] {
  return Array.from({ length: cap }, () => ({
    meta: null,
    bornAt: 0,
    x: 0,
    z: 0,
    height: 1,
  }));
}

class InstancedKind {
  readonly mesh: THREE.InstancedMesh;
  readonly slots: Slot[];
  private next = 0;
  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();

  constructor(
    scene: THREE.Scene,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    cap: number
  ) {
    this.mesh = new THREE.InstancedMesh(geometry, material, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.slots = makeSlots(cap);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < cap; i++) this.mesh.setMatrixAt(i, zero);
    scene.add(this.mesh);
  }

  plant(
    meta: SproutEvent,
    x: number,
    z: number,
    height: number,
    t: number,
    color?: THREE.Color
  ): number {
    const i = this.next;
    this.next = (this.next + 1) % this.slots.length;
    this.slots[i] = { meta, bornAt: t, x, z, height };
    if (color) {
      this.mesh.setColorAt(i, color);
      this.mesh.instanceColor!.needsUpdate = true;
    }
    return i;
  }

  update(t: number, gustDip: number): void {
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (!slot.meta) continue;
      const progress = Math.min((t - slot.bornAt) / GROW_SECONDS, 1);
      const eased = easeOutCubic(progress);
      const width = Math.min(1, eased * 1.3);
      this.matrix.compose(
        new THREE.Vector3(slot.x, 0, slot.z),
        this.quaternion,
        new THREE.Vector3(width, eased * slot.height * gustDip, width)
      );
      this.mesh.setMatrixAt(i, this.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  metaAt(index: number): SproutEvent | null {
    return this.slots[index]?.meta ?? null;
  }
}

function grassGeometry(): THREE.BufferGeometry {
  const cone = new THREE.ConeGeometry(0.07, 1, 5);
  cone.translate(0, 0.5, 0);
  return cone;
}

function mushroomGeometry(): THREE.BufferGeometry {
  const stem = new THREE.CylinderGeometry(0.05, 0.08, 0.5, 6);
  stem.translate(0, 0.25, 0);
  const cap = new THREE.SphereGeometry(0.24, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  cap.translate(0, 0.5, 0);
  return mergeGeometries([stem, cap]);
}

function bloomGeometry(): THREE.BufferGeometry {
  const core = new THREE.IcosahedronGeometry(0.18, 1);
  core.translate(0, 0.85, 0);
  const stalk = new THREE.CylinderGeometry(0.025, 0.04, 0.7, 5);
  stalk.translate(0, 0.35, 0);
  return mergeGeometries([core, stalk]);
}

/** XCH amount (mojos, string) → grass height. log scale, dust→blade, whale→stalk. */
function xchHeight(amount: string): number {
  const mojos = Number(amount);
  return Math.min(3.2, 0.4 + 0.55 * Math.log10(1 + mojos / 1e9));
}

export class FloraSystem {
  private readonly grass: InstancedKind;
  private readonly mushroom: InstancedKind;
  private readonly bloom: InstancedKind;
  private readonly wisps: Array<{
    sprite: THREE.Sprite;
    meta: SproutEvent | null;
    bornAt: number;
    phase: number;
  }>;
  private readonly bloomGlows: THREE.Sprite[];
  private nextWisp = 0;
  private gustUntil = 0;
  private readonly color = new THREE.Color();

  constructor(scene: THREE.Scene) {
    this.grass = new InstancedKind(
      scene,
      grassGeometry(),
      new THREE.MeshStandardMaterial({
        color: COLORS.grass,
        emissive: COLORS.grassEmissive,
        roughness: 0.8,
      }),
      CAPS.grass
    );
    this.mushroom = new InstancedKind(
      scene,
      mushroomGeometry(),
      new THREE.MeshStandardMaterial({
        color: 0xffffff, // tinted per-instance from assetId
        emissive: 0x10101a,
        roughness: 0.6,
      }),
      CAPS.mushroom
    );
    this.bloom = new InstancedKind(
      scene,
      bloomGeometry(),
      new THREE.MeshStandardMaterial({
        color: COLORS.bloom,
        emissive: COLORS.bloomEmissive,
        emissiveIntensity: 1.3,
        roughness: 0.4,
      }),
      CAPS.bloom
    );

    const glowMap = glowTexture();
    this.bloomGlows = Array.from({ length: CAPS.bloom }, () => {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowMap,
          color: COLORS.bloomEmissive,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      scene.add(sprite);
      return sprite;
    });

    this.wisps = Array.from({ length: CAPS.wisp }, () => {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowMap,
          color: COLORS.wisp,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      sprite.scale.setScalar(0.9);
      scene.add(sprite);
      return { sprite, meta: null, bornAt: 0, phase: Math.random() * 10 };
    });
  }

  plant(event: SproutEvent, blockPos: XZ, t: number): void {
    const offset = sproutOffset(event.coinId);
    const x = blockPos.x + offset.x;
    const z = blockPos.z + offset.z;

    switch (event.kind) {
      case "xch": {
        // subtle per-blade hue/lightness jitter, seeded by coin id
        const jitter = (parseInt(event.coinId.slice(8, 12), 16) % 100) / 100;
        this.color.setHSL(0.36 + jitter * 0.05, 0.55, 0.3 + jitter * 0.12);
        this.grass.plant(event, x, z, xchHeight(event.amount), t, this.color);
        break;
      }
      case "cat": {
        this.color.setHSL(catHue(event.assetId ?? "0".repeat(64)) / 360, 0.6, 0.55);
        this.mushroom.plant(event, x, z, 1, t, this.color);
        break;
      }
      case "nft": {
        const index = this.bloom.plant(event, x, z, event.mint ? 1.35 : 1, t);
        const glow = this.bloomGlows[index];
        glow.position.set(x, 0.85, z);
        glow.material.opacity = event.mint ? 0.9 : 0.55;
        glow.scale.setScalar(event.mint ? 2.6 : 1.7);
        break;
      }
      case "did": {
        const wisp = this.wisps[this.nextWisp];
        this.nextWisp = (this.nextWisp + 1) % CAPS.wisp;
        wisp.meta = event;
        wisp.bornAt = t;
        wisp.sprite.position.set(x, 0, z);
        break;
      }
    }
  }

  gust(t: number): void {
    this.gustUntil = t + 2;
  }

  update(t: number): void {
    const gustDip =
      t < this.gustUntil ? 0.82 + 0.18 * Math.abs(Math.sin((this.gustUntil - t) * 6)) : 1;
    this.grass.update(t, gustDip);
    this.mushroom.update(t, gustDip);
    this.bloom.update(t, gustDip);

    for (const glow of this.bloomGlows) {
      if (glow.material.opacity > 0.55) {
        glow.material.opacity = Math.max(0.55, glow.material.opacity - 0.002);
      }
    }
    for (const wisp of this.wisps) {
      if (!wisp.meta) continue;
      const progress = Math.min((t - wisp.bornAt) / 2, 1);
      wisp.sprite.material.opacity = easeOutCubic(progress) * 0.85;
      wisp.sprite.position.y = easeOutCubic(progress) * 1.4 + Math.sin(t * 1.3 + wisp.phase) * 0.25;
    }
  }

  /** Objects the picker may raycast, with metadata lookup. */
  pickables(): THREE.Object3D[] {
    return [
      this.grass.mesh,
      this.mushroom.mesh,
      this.bloom.mesh,
      ...this.wisps.filter((w) => w.meta).map((w) => w.sprite),
    ];
  }

  metaFor(object: THREE.Object3D, instanceId: number | undefined): SproutEvent | null {
    if (object === this.grass.mesh) return this.grass.metaAt(instanceId ?? -1);
    if (object === this.mushroom.mesh) return this.mushroom.metaAt(instanceId ?? -1);
    if (object === this.bloom.mesh) return this.bloom.metaAt(instanceId ?? -1);
    const wisp = this.wisps.find((w) => w.sprite === object);
    return wisp?.meta ?? null;
  }
}
```

- [ ] **Step 2: Wire flora into the runtime**

In `web/src/main.ts`, after `startGrove(...)`:

```ts
import { FloraSystem } from "./scene/flora.js";

// replace `startGrove(canvas, feed);` with:
const grove = startGrove(canvas, feed);
const flora = new FloraSystem(grove.scene);
const clockRef = { t: 0 };
grove.setSproutHandler((event, blockPos) => flora.plant(event, blockPos, clockRef.t));
grove.setReorgHandler(() => flora.gust(clockRef.t));
grove.setUpdateHandler((_dt, t) => {
  clockRef.t = t;
  flora.update(t);
});
```

(Keep the existing feed/status code; `grove.scene` and the handler setters come from Task 10's `startGrove` return value.)

- [ ] **Step 3: Manual verification**

Run: `npm run dev:web`, open `http://localhost:5173/?demo=1`.
Expected: within seconds the meadow fills in a spiral pattern — green grass blades of varied height (most plants), colored mushroom clusters where the same demo asset ids repeat (same color = same asset), occasional glowing golden blooms (mints noticeably bigger/brighter), violet wisps bobbing above the ground. New cluster sprouts with each ripple. `npm run build` passes.

- [ ] **Step 4: Commit**

```bash
git add web/src
git commit -m "feat(web): instanced asset-aware flora (grass, mushrooms, blooms, wisps)"
```

---

### Task 12: Fireflies and ambient wiring

**Files:**

- Create: `web/src/scene/fireflies.ts`
- Modify: `web/src/main.ts`

Firefly count tracks mempool size; orbit speed tracks mempool cost; a block landing sends a contingent diving to the new planting.

- [ ] **Step 1: Write the fireflies module**

`web/src/scene/fireflies.ts`:

```ts
import * as THREE from "three";
import type { XZ } from "./layout.js";
import { COLORS } from "./palette.js";
import { glowTexture } from "./textures.js";

const MAX = 400;
const DIVE_SECONDS = 2;

interface Fly {
  cx: number;
  cz: number;
  baseY: number;
  orbitRadius: number;
  speed: number;
  phase: number;
  diveUntil: number;
  diveX: number;
  diveZ: number;
}

export class Fireflies {
  private readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly flies: Fly[];
  private visible = 60;
  private agitation = 1;

  constructor(
    scene: THREE.Scene,
    private readonly max = MAX
  ) {
    this.positions = new Float32Array(this.max * 3);
    this.flies = Array.from({ length: this.max }, () => ({
      cx: (Math.random() - 0.5) * 70,
      cz: (Math.random() - 0.5) * 70,
      baseY: 1.5 + Math.random() * 6,
      orbitRadius: 1 + Math.random() * 4,
      speed: 0.3 + Math.random() * 0.8,
      phase: Math.random() * Math.PI * 2,
      diveUntil: 0,
      diveX: 0,
      diveZ: 0,
    }));

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size: 0.35,
        map: glowTexture(),
        color: COLORS.firefly,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  setMempool(size: number, cost: string): void {
    this.visible = Math.max(20, Math.min(this.max, 20 + size));
    const costNum = Number(BigInt(cost) / 1_000_000_000n); // ~CLVM cost in billions
    this.agitation = Math.max(0.5, Math.min(3, 0.5 + costNum / 400));
  }

  diveTo(target: XZ, t: number): void {
    let sent = 0;
    for (const fly of this.flies) {
      if (sent >= 50) break;
      if (Math.random() < 0.25) {
        fly.diveUntil = t + DIVE_SECONDS;
        fly.diveX = target.x + (Math.random() - 0.5) * 3;
        fly.diveZ = target.z + (Math.random() - 0.5) * 3;
        sent++;
      }
    }
  }

  scatter(): void {
    for (const fly of this.flies) {
      fly.diveUntil = 0;
      fly.phase += (Math.random() - 0.5) * 2;
    }
  }

  update(t: number): void {
    for (let i = 0; i < this.visible; i++) {
      const fly = this.flies[i];
      const angle = fly.phase + t * fly.speed * this.agitation;
      let x = fly.cx + Math.cos(angle) * fly.orbitRadius;
      let z = fly.cz + Math.sin(angle * 0.8) * fly.orbitRadius;
      let y = fly.baseY + Math.sin(t * 0.9 + fly.phase) * 0.8;

      if (t < fly.diveUntil) {
        const pull = 1 - (fly.diveUntil - t) / DIVE_SECONDS;
        x += (fly.diveX - x) * pull;
        z += (fly.diveZ - z) * pull;
        y += (0.8 - y) * pull;
      }

      this.positions[i * 3] = x;
      this.positions[i * 3 + 1] = y;
      this.positions[i * 3 + 2] = z;
    }
    this.points.geometry.setDrawRange(0, this.visible);
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}
```

- [ ] **Step 2: Wire into main.ts**

In `web/src/main.ts`, extend the Task 11 wiring:

```ts
import { Fireflies } from "./scene/fireflies.js";

const fireflies = new Fireflies(grove.scene, grove.reducedMotion ? 150 : 400);
grove.setAmbientHandler((mempoolSize, mempoolCost) =>
  fireflies.setMempool(mempoolSize, mempoolCost)
);
grove.setBlockHandler((pos) => fireflies.diveTo(pos, clockRef.t));
grove.setReorgHandler(() => {
  flora.gust(clockRef.t);
  fireflies.scatter();
});
grove.setUpdateHandler((_dt, t) => {
  clockRef.t = t;
  flora.update(t);
  fireflies.update(t);
});
```

(The reorg and update handlers replace the ones set in Task 11 — they now do both jobs.)

- [ ] **Step 3: Manual verification**

Run: `npm run dev:web`, open `http://localhost:5173/?demo=1`.
Expected: a swarm of soft yellow-green fireflies wandering above the meadow; the swarm visibly thickens/thins over time (demo mempool drifts every 2 s); when a ripple fires, a contingent of fireflies dives toward the new planting and then resumes wandering. `npm run build` passes.

- [ ] **Step 4: Commit**

```bash
git add web/src
git commit -m "feat(web): mempool firefly swarm with block dives"
```

---

### Task 13: Hover/click interaction and detail card

**Files:**

- Create: `web/src/ui/picker.ts`, `web/src/ui/detail-card.ts`
- Modify: `web/src/main.ts`

- [ ] **Step 1: Write the detail card**

`web/src/ui/detail-card.ts`:

```ts
import type { SproutEvent } from "@grove/shared";
import { mojosToXch, shortHex } from "./format.js";

const KIND_LABELS: Record<SproutEvent["kind"], string> = {
  xch: "XCH spend",
  cat: "CAT transfer",
  nft: "NFT",
  did: "DID",
};

let hideTimer: number | undefined;

export function showCard(event: SproutEvent): void {
  const card = document.getElementById("card") as HTMLDivElement;
  const title = event.kind === "nft" && event.mint ? "NFT mint" : KIND_LABELS[event.kind];

  card.innerHTML = `
    <h3>${title}</h3>
    ${event.imageUrl ? `<img src="${event.imageUrl}" alt="NFT" loading="lazy" />` : ""}
    <div>${mojosToXch(event.amount)} XCH · block ${event.height}</div>
    <div class="dim">coin ${shortHex(event.coinId)}</div>
    ${event.assetId ? `<div class="dim">asset ${shortHex(event.assetId)}</div>` : ""}
    ${event.launcherId ? `<div class="dim">launcher ${shortHex(event.launcherId)}</div>` : ""}
    <div><a href="https://www.spacescan.io/coin/0x${event.coinId}"
      target="_blank" rel="noopener">view on spacescan ↗</a></div>
  `;
  card.hidden = false;

  clearTimeout(hideTimer);
  hideTimer = window.setTimeout(hideCard, 12_000);
}

export function hideCard(): void {
  const card = document.getElementById("card") as HTMLDivElement;
  card.hidden = true;
  clearTimeout(hideTimer);
}
```

- [ ] **Step 2: Write the picker**

`web/src/ui/picker.ts`:

```ts
import * as THREE from "three";
import type { FloraSystem } from "../scene/flora.js";
import { hideCard, showCard } from "./detail-card.js";

export function attachPicker(
  canvas: HTMLCanvasElement,
  camera: THREE.PerspectiveCamera,
  flora: FloraSystem
): void {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hovering = false;

  function intersect(eventX: number, eventY: number) {
    pointer.set((eventX / innerWidth) * 2 - 1, -(eventY / innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(flora.pickables(), false);
    for (const hit of hits) {
      const meta = flora.metaFor(hit.object, hit.instanceId);
      if (meta) return meta;
    }
    return null;
  }

  canvas.addEventListener("pointermove", (event) => {
    hovering = intersect(event.clientX, event.clientY) !== null;
    canvas.style.cursor = hovering ? "pointer" : "default";
  });

  canvas.addEventListener("click", (event) => {
    const meta = intersect(event.clientX, event.clientY);
    if (meta) showCard(meta);
    else hideCard();
  });
}
```

- [ ] **Step 3: Wire into main.ts**

Add to `web/src/main.ts`:

```ts
import { attachPicker } from "./ui/picker.js";

attachPicker(canvas, grove.camera, flora);
```

- [ ] **Step 4: Manual verification**

Run: `npm run dev:web`, open `http://localhost:5173/?demo=1`.
Expected: cursor becomes a pointer over plants/blooms/wisps; clicking one opens the card bottom-left with kind, XCH amount, coin id, block height, and a spacescan link (demo coin ids will 404 on spacescan — that's expected); clicking empty ground dismisses it; the card auto-hides after 12 s. Also verify against real data (server running, no `?demo=1`) — click an NFT bloom and confirm the NFT image renders when the event carried an `imageUrl`.

- [ ] **Step 5: Run all tests and commit**

Run: `npm test && npm run build`
Expected: all tests PASS, build clean.

```bash
git add web/src
git commit -m "feat(web): hover/click picking with coin detail card"
```

---

### Task 14: Deployment assets and README

**Files:**

- Create: `deploy/Caddyfile`, `deploy/chia-grove.service`, `deploy/deploy.sh`, `README.md`

- [ ] **Step 1: Write deployment files**

`deploy/Caddyfile` (replace the domain when deploying):

```caddyfile
grove.example.com {
    reverse_proxy localhost:8080
}
```

`deploy/chia-grove.service`:

```ini
[Unit]
Description=Chia Grove
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=grove
WorkingDirectory=/opt/chia-grove
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5
Environment=PORT=8080
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

`deploy/deploy.sh`:

```bash
#!/usr/bin/env bash
# Build locally, sync to the droplet, install prod deps, restart.
# Usage: deploy/deploy.sh user@host
set -euo pipefail

HOST="${1:?usage: deploy/deploy.sh user@host}"
TARGET=/opt/chia-grove

npm run build

rsync -az --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude .superpowers \
  ./ "$HOST:$TARGET/"

ssh "$HOST" "cd $TARGET && npm ci --omit=dev && sudo systemctl restart chia-grove"
echo "deployed to $HOST"
```

Run: `chmod +x deploy/deploy.sh`

- [ ] **Step 2: Write the README**

`README.md`:

````markdown
# Chia Grove

An ambient 3D visualization of live Chia mainnet activity. Every block
sprouts luminous flora in a nocturnal meadow — what grows depends on what
happened on chain, classified per-spend with the
[chia-wallet-sdk](https://github.com/xch-dev/chia-wallet-sdk) napi binding:

| On chain     | In the grove                                      |
| ------------ | ------------------------------------------------- |
| XCH spend    | Grass blade, height scales with amount            |
| CAT transfer | Mushroom, color derived from the asset id         |
| NFT activity | Glowing bloom (mints burst); click to see the NFT |
| DID activity | Violet will-o'-wisp                               |
| Mempool      | Firefly swarm density and agitation               |
| Netspace     | Moonlight brightness                              |
| New block    | Light ripple + aurora pulse                       |

Click any plant for coin details and a spacescan.io link.

## Architecture

One Node process polls [coinset.org](https://coinset.org) for new blocks,
classifies every spend (`Puzzle.parseNft/parseCat/parseDid`), and pushes
compact events over a WebSocket to the Three.js frontend it also serves.
No database, no full node, runs on the smallest droplet.

Design docs: `docs/superpowers/specs/`, plan: `docs/superpowers/plans/`.

## Development

```sh
npm install
npm run dev:server   # ingest + ws on :8080 (needs network)
npm run dev:web      # vite on :5173, proxies /ws
```
````

Open http://localhost:5173/?demo=1 for synthetic events (no server needed).

```sh
npm test             # vitest: classifier, poller, hub, layout
npm run build        # production frontend bundle (web/dist)
```

## Deployment (Ubuntu droplet)

1. Install Node 20+ and Caddy; create the `grove` user and `/opt/chia-grove`.
2. Copy `deploy/chia-grove.service` to `/etc/systemd/system/`, enable it.
3. Point `deploy/Caddyfile`'s domain at the droplet, install as `/etc/caddy/Caddyfile`.
4. `deploy/deploy.sh grove@your-droplet`

Environment: `PORT` (8080), `POLL_INTERVAL_MS` (3000), `BACKFILL_BLOCKS` (30).

````

- [ ] **Step 3: Final verification**

Run: `npm test && npm run build && npx tsc -p server/tsconfig.json && npx tsc -p web/tsconfig.json`
Expected: everything green.

- [ ] **Step 4: Commit**

```bash
git add deploy README.md
git commit -m "docs: README and droplet deployment assets"
````

---

## Spec coverage self-check (for the final reviewer)

- Asset-aware flora (XCH/CAT/NFT/DID) — Tasks 4, 11
- Phyllotaxis spiral + center clearing + wrap/compost — Tasks 9, 10, 11
- Fireflies = mempool size/cost; dive on block — Task 12
- Moon = netspace; aurora pulse per peak; block ripple — Tasks 10, 12
- Hover/click card, NFT image, spacescan link, drift camera — Tasks 10, 13
- Snapshot backfill (~30 blocks) + accelerated replay — Tasks 6, 8
- Reorg detection → visible gust — Tasks 5, 11, 12
- Backoff, stale "signal lost" moon dimming — Tasks 5, 8, 10
- Backpressure (ambient dropped first, hopeless clients cut) — Task 6
- `prefers-reduced-motion`, pixel-ratio clamp, hidden-tab pause — Tasks 10, 12
- Demo mode (`?demo=1`) — Task 8
- Deploy: droplet + Caddy + systemd, no secrets — Task 14
- Phase-2 peer seam — `ChainSource`/`RpcView` interfaces, Task 5
