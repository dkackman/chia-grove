# Event Batching (optimization #6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The server sends one batched WebSocket message per block instead of one message per event, and the client drains events through a frame-budgeted queue — cutting per-message overhead and smoothing the synchronous burst when a big block arrives.

**Architecture:** A new `Batch` wire message (`{ type: "batch", events }`) lets `Hub.publish` stringify + send once per call. The client funnels both the connect snapshot and live batches into a single FIFO `DrainQueue` that releases ~60 events per animation frame, replacing the old per-event `setTimeout` replay and the synchronous live dispatch. Because the wire format changes, `PROTOCOL_VERSION` bumps to `2`; Phase 3's reload guard makes soaked clients auto-reload into the new bundle.

**Tech Stack:** TypeScript, Fastify WebSocket, Vitest (node env), `requestAnimationFrame`, npm workspaces, Node 24.

## Global Constraints

- Node ≥ 24.
- `PROTOCOL_VERSION` lives only in `shared/src/index.ts`; bumping it is the activation switch for this protocol change.
- Backpressure semantics are preserved: a hopelessly-behind socket (`> 1 MB` buffered) is terminated; a standalone **ambient** batch is dropped for a slow socket (`> 64 KB`); block/reorg batches are never dropped.
- Web tests run in the **node** environment (no DOM/rAF); the queue must take an injectable scheduler so it is unit-testable.
- Adding a type to `WireMessage` breaks any consumer that doesn't handle it — so a `WireMessage` change ships in the same task as its handler (lesson from Phase 3).

## Prerequisite

Depends on Phase 3 (PR #6) being **merged to `main`** (provides `PROTOCOL_VERSION`, `Hello`, and the client reload guard). Branch off clean `main`:

```bash
git checkout main && git pull && git checkout -b feat/event-batching
```

## Deploy ordering (important)

Do **not** tag/deploy this until Phase 3 (`v0.2.0`) has **soaked** in production — that's what lets already-open clients carry the reload guard so they auto-reload when this bumps `PROTOCOL_VERSION → 2`. Implementing and merging is fine anytime; only the release tag (`v0.3.0`) waits for the soak.

## Verification model

- `DrainQueue` and `Hub.publish` batching are unit-tested (TDD).
- `feed.ts` integration is thin glue over the tested queue; it can't run in the node test env (uses `WebSocket`/`requestAnimationFrame`), so it's covered by typecheck + build + the manual check below.
- Behavior change to record in the PR: the connect snapshot now drains at the queue budget (~3 s for a full 10 000-event buffer, near-instant for a small one) rather than always spreading over a fixed 3 s.

---

### Task 1: `Batch` message type in shared

**Files:**

- Modify: `shared/src/index.ts`

**Interfaces:**

- Produces: `export interface Batch { type: "batch"; events: GroveEvent[] }`. Added to `WireMessage` in Task 4 (with its client handler). Consumed by Task 2 (Hub) directly.

This is a type definition (no behavior); Tasks 2 and 4 exercise it. Defining it first lets the Hub import it.

- [ ] **Step 1: Add the `Batch` interface**

In `shared/src/index.ts`, after the `Snapshot` interface, add:

```ts
// One framed message carrying a publish call's events (a block plus its
// sprouts, or a standalone ambient/reorg). Sent in place of per-event messages
// to cut WebSocket framing overhead; the client drains it across frames.
export interface Batch {
  type: "batch";
  events: GroveEvent[];
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean (exit 0). (`Batch` is exported-but-unused — not an error.)

- [ ] **Step 3: Commit**

```bash
git add shared/src/index.ts
git commit -m "feat: add Batch wire message type

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Server batches each publish into one message

**Files:**

- Modify: `server/src/web/hub.ts`
- Modify: `server/test/hub.test.ts`

**Interfaces:**

- Consumes: `Batch` (Task 1).
- Produces: `Hub.publish` sends exactly one `batch` message per call (one `JSON.stringify`, one `send` per client); ambient-only batches remain droppable.

- [ ] **Step 1: Update the Hub tests to expect batching (failing first)**

In `server/test/hub.test.ts`, replace the "publish fans out", "slow client skips ambient", and "hopelessly behind" tests with:

```ts
test("publish fans out one batch to connected clients", () => {
  const hub = makeHub();
  const a = new FakeSocket();
  const b = new FakeSocket();
  hub.add(a);
  hub.add(b);
  hub.publish([blockEvent(1)]);
  // index 0 = hello, 1 = snapshot, 2 = the batch
  expect(a.parsed()[2]).toEqual({ type: "batch", events: [blockEvent(1)] });
  expect(b.parsed()[2]).toEqual({ type: "batch", events: [blockEvent(1)] });
});

test("a block and its sprouts arrive as a single batch", () => {
  const hub = makeHub();
  const socket = new FakeSocket();
  hub.add(socket);
  const events = [blockEvent(1), blockEvent(2)];
  hub.publish(events);
  expect(socket.parsed()[2]).toEqual({ type: "batch", events });
});

test("slow client skips a standalone ambient batch but still gets blocks", () => {
  const hub = makeHub();
  const slow = new FakeSocket();
  hub.add(slow);
  slow.bufferedAmount = 100 * 1024; // over soft limit
  hub.publish([ambientEvent]); // ambient-only -> droppable, skipped
  hub.publish([blockEvent(1)]); // not droppable -> sent
  const types = slow.parsed().map((m) => (m as { type: string }).type);
  expect(types).toEqual(["hello", "snapshot", "batch"]);
});

test("hopelessly behind client is disconnected and receives nothing more", () => {
  const hub = makeHub();
  const dead = new FakeSocket();
  hub.add(dead);
  dead.bufferedAmount = 2 * 1024 * 1024; // over hard limit
  hub.publish([blockEvent(1)]);
  expect(dead.closed).toBe(true);
  const before = dead.sent.length;
  hub.publish([blockEvent(2)]);
  expect(dead.sent.length).toBe(before);
});
```

- [ ] **Step 2: Run the Hub tests to verify failures**

Run: `npx vitest run server/test/hub.test.ts`
Expected: FAIL — current `publish` sends per-event messages, not a `batch`.

- [ ] **Step 3: Implement batching in `publish`**

In `server/src/web/hub.ts`, add `Batch` to the type import:

```ts
import type { AmbientEvent, GroveEvent, Hello, Batch } from "@grove/shared";
```

Replace the `publish` method with:

```ts
  publish(events: GroveEvent[]): void {
    if (events.length === 0) return;
    for (const event of events) {
      if (event.type === "ambient") this.lastAmbient = event;
      else this.buffer.push(event);
    }
    // One framed message per publish call (one stringify, one send per client).
    // Ambient is published on its own and stays droppable under backpressure;
    // block/reorg batches are only dropped by terminating a dead socket.
    const batch: Batch = { type: "batch", events };
    const data = JSON.stringify(batch);
    const droppable = events.every((e) => e.type === "ambient");
    for (const socket of [...this.clients]) {
      if (socket.readyState !== OPEN || socket.bufferedAmount > HARD_LIMIT) {
        socket.terminate();
        this.clients.delete(socket);
        continue;
      }
      if (droppable && socket.bufferedAmount > SOFT_LIMIT) continue;
      socket.send(data);
    }
  }
```

- [ ] **Step 4: Run the Hub tests + typecheck**

Run: `npx vitest run server/test/hub.test.ts && npm run typecheck`
Expected: all Hub tests pass; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add server/src/web/hub.ts server/test/hub.test.ts
git commit -m "feat: batch each publish into one ws message

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Client `DrainQueue`

**Files:**

- Create: `web/src/net/drain-queue.ts`
- Create: `web/test/drain-queue.test.ts`

**Interfaces:**

- Produces: `FrameScheduler { schedule(cb: () => void): void }`, `rafScheduler` (real `requestAnimationFrame`), and `class DrainQueue<T>` with `constructor(sink: (item: T) => void, budget: number, scheduler: FrameScheduler)` and `enqueue(items: T[]): void`. Consumed by `feed.ts` (Task 4).

- [ ] **Step 1: Write the failing tests**

Create `web/test/drain-queue.test.ts`:

```ts
import { expect, test } from "vitest";
import { DrainQueue, type FrameScheduler } from "../src/net/drain-queue.js";

function manualScheduler() {
  const frames: Array<() => void> = [];
  const scheduler: FrameScheduler = { schedule: (cb) => frames.push(cb) };
  return {
    scheduler,
    runFrame: () => frames.shift()?.(),
    pending: () => frames.length,
  };
}

test("drains at most budget items per frame, in order", () => {
  const out: number[] = [];
  const { scheduler, runFrame } = manualScheduler();
  const q = new DrainQueue<number>((n) => out.push(n), 3, scheduler);
  q.enqueue([1, 2, 3, 4, 5]);
  runFrame();
  expect(out).toEqual([1, 2, 3]);
  runFrame();
  expect(out).toEqual([1, 2, 3, 4, 5]);
});

test("preserves order across enqueues between frames", () => {
  const out: number[] = [];
  const { scheduler, runFrame } = manualScheduler();
  const q = new DrainQueue<number>((n) => out.push(n), 2, scheduler);
  q.enqueue([1, 2]);
  runFrame();
  q.enqueue([3, 4]);
  runFrame();
  expect(out).toEqual([1, 2, 3, 4]);
});

test("stops scheduling once fully drained", () => {
  const out: number[] = [];
  const { scheduler, runFrame, pending } = manualScheduler();
  const q = new DrainQueue<number>((n) => out.push(n), 10, scheduler);
  q.enqueue([1, 2]);
  runFrame();
  expect(out).toEqual([1, 2]);
  expect(pending()).toBe(0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run web/test/drain-queue.test.ts`
Expected: FAIL — cannot resolve `../src/net/drain-queue.js`.

- [ ] **Step 3: Implement the queue**

Create `web/src/net/drain-queue.ts`:

```ts
export interface FrameScheduler {
  /** Run cb on the next animation frame. */
  schedule(cb: () => void): void;
}

export const rafScheduler: FrameScheduler = {
  schedule: (cb) => requestAnimationFrame(cb),
};

/**
 * FIFO queue that releases at most `budget` items per scheduled frame, so a
 * burst (a big block, or the connect snapshot) is spread across frames instead
 * of dispatched in one tick. Uses a head index rather than Array.shift so
 * draining a large queue stays O(n) overall.
 */
export class DrainQueue<T> {
  private items: T[] = [];
  private head = 0;
  private scheduled = false;

  constructor(
    private readonly sink: (item: T) => void,
    private readonly budget: number,
    private readonly scheduler: FrameScheduler
  ) {}

  enqueue(items: T[]): void {
    for (const item of items) this.items.push(item);
    this.ensureScheduled();
  }

  private ensureScheduled(): void {
    if (this.scheduled || this.head >= this.items.length) return;
    this.scheduled = true;
    this.scheduler.schedule(() => this.drainFrame());
  }

  private drainFrame(): void {
    this.scheduled = false;
    const end = Math.min(this.head + this.budget, this.items.length);
    for (; this.head < end; this.head++) this.sink(this.items[this.head]);
    if (this.head >= this.items.length) {
      this.items = [];
      this.head = 0;
    }
    this.ensureScheduled();
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run web/test/drain-queue.test.ts`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add web/src/net/drain-queue.ts web/test/drain-queue.test.ts
git commit -m "feat: frame-budgeted DrainQueue for event dispatch

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Client consumes batches through the queue

**Files:**

- Modify: `shared/src/index.ts` (add `Batch` to `WireMessage`)
- Modify: `web/src/net/feed.ts`

**Interfaces:**

- Consumes: `Batch` + `WireMessage` (shared), `DrainQueue`/`rafScheduler` (Task 3).
- Produces: snapshot and batch events flow through one `DrainQueue`; the per-event `replay()` is removed.

- [ ] **Step 1: Confirm `WireMessage` has no other consumers before narrowing**

Run: `grep -rn "WireMessage" shared/src web/src server/src`
Expected: referenced only in `shared/src/index.ts` (definition) and `web/src/net/feed.ts` (the parse cast). If anything else consumes it, handle that consumer too. (The server never parses `WireMessage`; the demo path uses `GroveEvent` directly.)

- [ ] **Step 2: Update `WireMessage` to the messages the server actually sends**

In `shared/src/index.ts`, change:

```ts
export type WireMessage = GroveEvent | Snapshot | Hello;
```

to:

```ts
export type WireMessage = Snapshot | Hello | Batch;
```

(The server now sends only `hello`, `snapshot`, and `batch` — never bare events.)

- [ ] **Step 3: Wire the queue into feed.ts**

In `web/src/net/feed.ts`:

Replace the imports/constants block:

```ts
import type { GroveEvent, WireMessage } from "@grove/shared";
import { PROTOCOL_VERSION } from "@grove/shared";
import { protocolAction } from "./protocol-guard.js";
import { startDemo } from "./demo.js";

export type FeedStatus = "connecting" | "live" | "stale" | "demo";

const STALE_AFTER_MS = 2 * 60 * 1000;
const SNAPSHOT_REPLAY_MS = 3000;
const RELOAD_KEY = "grove.proto-reloaded";
```

with:

```ts
import type { GroveEvent, WireMessage } from "@grove/shared";
import { PROTOCOL_VERSION } from "@grove/shared";
import { protocolAction } from "./protocol-guard.js";
import { DrainQueue, rafScheduler } from "./drain-queue.js";
import { startDemo } from "./demo.js";

export type FeedStatus = "connecting" | "live" | "stale" | "demo";

const STALE_AFTER_MS = 2 * 60 * 1000;
const RELOAD_KEY = "grove.proto-reloaded";
// Events released per animation frame: ~60 keeps a 10k-event snapshot filling
// in over ~3 s at 60 fps while smoothing big live blocks across a few frames.
const DRAIN_BUDGET = 60;
```

Add the queue field after the existing private fields (e.g. after `private started = false;`):

```ts
  private readonly queue = new DrainQueue<GroveEvent>(
    (event) => this.dispatch(event),
    DRAIN_BUDGET,
    rafScheduler
  );
```

Replace the `onmessage` body's parse/handling lines:

```ts
const parsed = JSON.parse(message.data as string) as WireMessage;
if (parsed.type === "hello") this.handleHello(parsed.protocolVersion);
else if (parsed.type === "snapshot") this.replay(parsed.events);
else this.dispatch(parsed);
```

with:

```ts
const parsed = JSON.parse(message.data as string) as WireMessage;
if (parsed.type === "hello") this.handleHello(parsed.protocolVersion);
else this.queue.enqueue(parsed.events); // snapshot or batch
```

Delete the now-unused `replay` method entirely:

```ts
  /** Spread snapshot events over a few seconds so the grove grows in. */
  private replay(events: GroveEvent[]): void {
    const step = SNAPSHOT_REPLAY_MS / Math.max(events.length, 1);
    events.forEach((event, i) => setTimeout(() => this.dispatch(event), i * step));
  }
```

(The demo path still calls `this.dispatch` directly via `startDemo` — unchanged.)

- [ ] **Step 4: Web suite + typecheck + build**

Run: `npx vitest run web/ && npm run typecheck && npm run build`
Expected: web tests pass; typecheck clean; build succeeds. (If typecheck flags `dispatch` or `GroveEvent` as unused, ensure `dispatch` is still used by the queue sink and the demo path — it is.)

- [ ] **Step 5: Commit**

```bash
git add shared/src/index.ts web/src/net/feed.ts
git commit -m "feat: drain snapshot and batch events through a frame-budgeted queue

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Activate protocol v2

**Files:**

- Modify: `shared/src/index.ts` (`PROTOCOL_VERSION`)
- Modify: `server/test/hub.test.ts` (hello assertion)
- Modify: `server/test/server.test.ts` (healthz assertion)

**Interfaces:** none (constant bump + test literals).

- [ ] **Step 1: Update the version-literal tests (failing first)**

In `server/test/hub.test.ts`, in the "first message on connect is the hello handshake" test, change `protocolVersion: 1` to `protocolVersion: 2`.

In `server/test/server.test.ts`, in the healthz test, change `protocolVersion: 1` to `protocolVersion: 2`.

Run: `npx vitest run server/test/hub.test.ts server/test/server.test.ts`
Expected: FAIL — constant is still `1`.

- [ ] **Step 2: Bump the constant**

In `shared/src/index.ts`, change:

```ts
export const PROTOCOL_VERSION = 1;
```

to:

```ts
export const PROTOCOL_VERSION = 2;
```

Run: `npx vitest run server/test/hub.test.ts server/test/server.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add shared/src/index.ts server/test/hub.test.ts server/test/server.test.ts
git commit -m "feat: bump PROTOCOL_VERSION to 2 for batched wire format

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Full verification + checkpoint

- [ ] **Step 1: Run every gate**

Run: `npm run lint && npm run typecheck && npx vitest run && npm run build`
Expected: lint clean, typecheck clean, all tests pass, build succeeds.

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin feat/event-batching
gh pr create --base main --fill
```

Confirm the `CI / build` check goes green on the PR.

- [ ] **Step 3: PR description note**

Record in the PR: this bumps `PROTOCOL_VERSION → 2`, so **deploy (`v0.3.0`) only after Phase 3 (`v0.2.0`) has soaked**; the snapshot now drains at the queue budget rather than a fixed 3 s spread.

- [ ] **Step 4: Manual verification (post-deploy, operator)**

After `v0.3.0` deploys: open the site, confirm blocks still render and grow in smoothly; in devtools Network → WS, confirm one `batch` frame per block instead of many. `curl -s https://chia-grove.com/healthz` reports `"protocolVersion":2`.

---

## Self-Review

**Spec coverage (the #6 design approved during brainstorming):**

- "Unified frame-budgeted drain queue (snapshot + live), ~60/frame, order preserved" → Task 3 (`DrainQueue`) + Task 4 (feed enqueues both). ✓
- "Server batches a block into one WS message (one stringify, one send)" → Task 2. ✓
- "Ambient stays its own droppable message; hard-limit terminate preserved" → Task 2 (`droppable = every ambient`; terminate unchanged). ✓
- "New `Batch` wire type" → Task 1 + Task 4 (`WireMessage`). ✓
- "Replaces 10k-setTimeout snapshot replay and synchronous live burst" → Task 4 (removes `replay`; enqueues instead). ✓
- "Bump `PROTOCOL_VERSION → 2`; guard handles transition" → Task 5. ✓
- "DrainQueue as a separate tested unit with injectable scheduler" → Task 3. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full content; commands have expected output. ✓

**Type/name consistency:** `Batch { type, events }` defined in Task 1, used in Task 2 (`Hub`) and Task 4 (`WireMessage`); `DrainQueue(sink, budget, scheduler)` / `FrameScheduler` / `rafScheduler` defined in Task 3 and constructed that way in Task 4; `DRAIN_BUDGET` introduced where used. ✓

**Ordering safety:** `Batch` joins `WireMessage` only in Task 4 (with its handler), so no commit leaves the client unable to compile (the Phase 3 lesson). `PROTOCOL_VERSION` bump (Task 5) lands after both sides speak the batched format. ✓
