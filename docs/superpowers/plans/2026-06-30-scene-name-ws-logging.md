# Scene Name WS Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Log which theme (scene) each browser client is viewing alongside the existing WebSocket connect log line, so scene popularity is queryable in Axiom.

**Architecture:** The client appends the active scene id as a `?scene=` query param on the `/ws` connection URL (no protocol/message changes, since the scene is fixed for the whole life of a connection — switching themes reloads the page). The server's `/ws` route reads it off the upgrade request and includes it in the log line it already emits on connect.

**Tech Stack:** TypeScript, Fastify + `@fastify/websocket`, pino (Axiom transport already wired up), Vitest.

## Global Constraints

- No changes to `shared/` — no new `WireMessage` type, no protocol version bump.
- The scene value is not validated against an allowlist server-side; it's a log field, not a security boundary.
- Follow existing repo conventions: pure logic extracted into small standalone modules for unit testing (see `web/src/net/protocol-guard.ts`), query params read via `(request.query as { ... }).field` (see `server/src/web/img-proxy.ts:226`).

---

### Task 1: Client sends scene as a WS query param

**Files:**

- Create: `web/src/net/ws-url.ts`
- Test: `web/test/ws-url.test.ts`
- Modify: `web/src/net/feed.ts:15,35-49` (constructor + `connect()`)
- Modify: `web/src/main.ts:14` (construct `GroveFeed` with the active theme id)

**Interfaces:**

- Produces: `buildWsUrl(protocol: string, host: string, scene?: string): string`, exported from `web/src/net/ws-url.ts`. `protocol` is `"ws"` or `"wss"`, `host` is `location.host` (may include a port, e.g. `localhost:5173`).
- `GroveFeed`'s constructor signature becomes `constructor(scene?: string)`.

- [ ] **Step 1: Write the failing test for `buildWsUrl`**

Create `web/test/ws-url.test.ts`:

```ts
import { expect, test } from "vitest";
import { buildWsUrl } from "../src/net/ws-url.js";

test("appends scene as a query param when provided", () => {
  expect(buildWsUrl("wss", "example.com", "grove")).toBe("wss://example.com/ws?scene=grove");
});

test("omits the query string when scene is not provided", () => {
  expect(buildWsUrl("ws", "localhost:5173", undefined)).toBe("ws://localhost:5173/ws");
});

test("URL-encodes scene values that need it", () => {
  expect(buildWsUrl("wss", "example.com", "big board")).toBe(
    "wss://example.com/ws?scene=big%20board"
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run web/test/ws-url.test.ts`
Expected: FAIL — `Cannot find module '../src/net/ws-url.js'` (the module doesn't exist yet).

- [ ] **Step 3: Implement `buildWsUrl`**

Create `web/src/net/ws-url.ts`:

```ts
/**
 * Build the WebSocket connection URL, optionally carrying the active scene
 * as a query param so the server can log it at connect time. Pure so it's
 * unit-testable without a browser location/WebSocket global.
 */
export function buildWsUrl(protocol: string, host: string, scene?: string): string {
  const base = `${protocol}://${host}/ws`;
  return scene ? `${base}?scene=${encodeURIComponent(scene)}` : base;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run web/test/ws-url.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add web/src/net/ws-url.ts web/test/ws-url.test.ts
git commit -m "feat(web): add buildWsUrl helper for scene-tagged WS connections"
```

- [ ] **Step 6: Wire `GroveFeed` to accept and use the scene**

In `web/src/net/feed.ts`, add the import and change the constructor and `connect()`:

```ts
import { buildWsUrl } from "./ws-url.js";
```

Change:

```ts
  private readonly queue = new DrainQueue<GroveEvent>(
    (event) => this.dispatch(event),
    DRAIN_BUDGET,
    rafScheduler
  );

  onEvent(listener: (event: GroveEvent) => void): void {
```

to:

```ts
  private readonly queue = new DrainQueue<GroveEvent>(
    (event) => this.dispatch(event),
    DRAIN_BUDGET,
    rafScheduler
  );

  constructor(private readonly scene?: string) {}

  onEvent(listener: (event: GroveEvent) => void): void {
```

Change `connect()` (currently at `web/src/net/feed.ts:46-49`):

```ts
  private connect(): void {
    this.setStatus("connecting");
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
```

to:

```ts
  private connect(): void {
    this.setStatus("connecting");
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(buildWsUrl(proto, location.host, this.scene));
```

- [ ] **Step 7: Pass the active theme id into `GroveFeed`**

In `web/src/main.ts`, change:

```ts
const feed = new GroveFeed();
```

to:

```ts
const feed = new GroveFeed(theme.id);
```

- [ ] **Step 8: Typecheck the web workspace**

Run: `npx tsc -p web/tsconfig.json`
Expected: no errors.

- [ ] **Step 9: Run the full web test suite**

Run: `npx vitest run web/test/`
Expected: PASS, no regressions (existing suite plus the 3 new `ws-url` tests).

- [ ] **Step 10: Commit**

```bash
git add web/src/net/feed.ts web/src/main.ts
git commit -m "feat(web): send active scene id on WS connect"
```

---

### Task 2: Server logs the scene from the WS query param

**Files:**

- Modify: `server/src/web/server.ts:52-68` (the `/ws` route registration)
- Test: `server/test/server.test.ts`

**Interfaces:**

- Consumes: `buildServer(hub: Hub, media: MediaIndex, logger: Logger): Promise<FastifyInstance>` (unchanged signature).
- No new exports — this task only changes what gets logged on WS connect.

- [ ] **Step 1: Write the failing tests**

Replace the contents of `server/test/server.test.ts` with:

```ts
import { Writable } from "node:stream";
import { expect, test } from "vitest";
import pino from "pino";
import { buildServer } from "../src/web/server.js";
import { Hub } from "../src/web/hub.js";
import { RingBuffer } from "../src/web/ring-buffer.js";
import { MediaIndex } from "../src/web/media-index.js";
import type { GroveEvent } from "@grove/shared";

const silent = pino({ level: "silent" });

/** A pino instance that captures each emitted line for assertions, instead of writing to stdout. */
function capturingLogger(): { logger: pino.Logger; lines: () => Record<string, unknown>[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  const logger = pino({ level: "info" }, stream);
  return {
    logger,
    lines: () => chunks.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

test("healthz responds ok", async () => {
  const app = await buildServer(
    new Hub(new RingBuffer<GroveEvent>(10), "test"),
    new MediaIndex(10),
    silent
  );
  const res = await app.inject({ method: "GET", url: "/healthz" });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({
    ok: true,
    appVersion: "dev",
    gitSha: "",
    protocolVersion: 5,
  });
  await app.close();
});

test("ws connect logs the scene query param", async () => {
  const { logger, lines } = capturingLogger();
  const app = await buildServer(
    new Hub(new RingBuffer<GroveEvent>(10), "test"),
    new MediaIndex(10),
    logger
  );
  await app.ready();

  const ws = await app.injectWS("/ws?scene=grove");
  ws.terminate();
  await app.close();

  const connected = lines().find((l) => l.msg === "ws: client connected");
  expect(connected?.scene).toBe("grove");
});

test("ws connect logs no scene when the query param is absent", async () => {
  const { logger, lines } = capturingLogger();
  const app = await buildServer(
    new Hub(new RingBuffer<GroveEvent>(10), "test"),
    new MediaIndex(10),
    logger
  );
  await app.ready();

  const ws = await app.injectWS("/ws");
  ws.terminate();
  await app.close();

  const connected = lines().find((l) => l.msg === "ws: client connected");
  expect(connected?.scene).toBeUndefined();
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `npx vitest run server/test/server.test.ts`
Expected: `healthz responds ok` PASSes; `ws connect logs the scene query param` FAILs because `connected?.scene` is `undefined`, not `"grove"` (the route doesn't read the query param yet).

- [ ] **Step 3: Read and log the scene query param**

In `server/src/web/server.ts`, change the `/ws` route registration (currently lines 52-68):

```ts
app.register(async (instance) => {
  instance.get("/ws", { websocket: true }, (socket) => {
    // ws.WebSocket satisfies WireSocket structurally (send/close/terminate/
    // bufferedAmount/readyState); the double cast bridges the nominal types.
    const wire = socket as unknown as WireSocket;
    hub.add(wire);
    logger.info({ clients: hub.size }, "ws: client connected");
    socket.on("close", () => {
      hub.remove(wire);
      logger.info({ clients: hub.size }, "ws: client disconnected");
    });
    socket.on("error", () => {
      hub.remove(wire);
      logger.info({ clients: hub.size }, "ws: client error");
    });
  });
});
```

to:

```ts
app.register(async (instance) => {
  instance.get("/ws", { websocket: true }, (socket, request) => {
    // ws.WebSocket satisfies WireSocket structurally (send/close/terminate/
    // bufferedAmount/readyState); the double cast bridges the nominal types.
    const wire = socket as unknown as WireSocket;
    const scene = (request.query as { scene?: string }).scene;
    hub.add(wire);
    logger.info({ clients: hub.size, scene }, "ws: client connected");
    socket.on("close", () => {
      hub.remove(wire);
      logger.info({ clients: hub.size }, "ws: client disconnected");
    });
    socket.on("error", () => {
      hub.remove(wire);
      logger.info({ clients: hub.size }, "ws: client error");
    });
  });
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run server/test/server.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Typecheck the server workspace**

Run: `npx tsc -p server/tsconfig.json`
Expected: no errors.

- [ ] **Step 6: Run the full server test suite**

Run: `npx vitest run server/test/`
Expected: PASS, no regressions.

- [ ] **Step 7: Commit**

```bash
git add server/src/web/server.ts server/test/server.test.ts
git commit -m "feat(server): log scene query param on WS connect"
```
