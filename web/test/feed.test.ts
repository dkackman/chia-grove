import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { GroveEvent, WireMessage } from "@grove/shared";
import { PROTOCOL_VERSION } from "@grove/shared";
import { GroveFeed, type FeedStatus } from "../src/net/feed.js";

// GroveFeed talks to real browser globals (WebSocket, location, sessionStorage,
// window.setTimeout, requestAnimationFrame via DrainQueue's rafScheduler) that
// don't exist in vitest's default node environment — this file stubs exactly
// what feed.ts touches, mirroring the vi.stubGlobal pattern drain-queue.test.ts
// already uses for requestAnimationFrame.

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  closeCalled = false;

  constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  close(): void {
    if (this.closeCalled) return;
    this.closeCalled = true;
    this.onclose?.();
  }

  message(msg: WireMessage): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

function fakeSessionStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
}

let rafCb: (() => void) | undefined;

/** Simulates the browser firing the pending requestAnimationFrame callback
 *  DrainQueue's rafScheduler registered — the only way to actually drain
 *  events through GroveFeed's real (non-injectable) queue in a test. */
function fireFrame(): void {
  const cb = rafCb;
  rafCb = undefined;
  cb?.();
}

function stubLocation(overrides: Partial<{ protocol: string; host: string; search: string }> = {}) {
  vi.stubGlobal("location", {
    protocol: "http:",
    host: "localhost:5173",
    search: "",
    reload,
    ...overrides,
  });
}

let session: ReturnType<typeof fakeSessionStorage>;
let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
  rafCb = undefined;
  reload = vi.fn();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal("window", globalThis); // so window.setTimeout is the faked timer
  stubLocation();
  session = fakeSessionStorage();
  vi.stubGlobal("sessionStorage", session);
  // requestAnimationFrame doesn't exist in plain Node; rafScheduler.schedule()
  // calls it unconditionally, so it must be stubbed or DrainQueue.enqueue()
  // throws as soon as a message arrives.
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
    rafCb = cb;
    return 0;
  });
  vi.spyOn(Math, "random").mockReturnValue(0); // deterministic reconnect jitter
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function latestSocket(): FakeWebSocket {
  return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
}

const hello = (protocolVersion: number): WireMessage => ({
  type: "hello",
  protocolVersion,
  appVersion: "1.0.0",
});

test("connects to ws:// on http and wss:// on https", () => {
  stubLocation({ protocol: "http:" });
  new GroveFeed().start();
  expect(latestSocket().url).toBe("ws://localhost:5173/ws");

  stubLocation({ protocol: "https:" });
  new GroveFeed().start();
  expect(latestSocket().url).toBe("wss://localhost:5173/ws");
});

test("closes the socket if no message arrives within the handshake timeout", () => {
  const feed = new GroveFeed();
  const statuses: FeedStatus[] = [];
  feed.onStatus((s) => statuses.push(s));
  feed.start();
  const ws = latestSocket();
  ws.onopen?.();

  vi.advanceTimersByTime(9_999);
  expect(ws.closeCalled).toBe(false);
  vi.advanceTimersByTime(1);
  expect(ws.closeCalled).toBe(true);
  expect(statuses.at(-1)).toBe("stale");
});

test("a message before the handshake timeout cancels it", () => {
  const feed = new GroveFeed();
  feed.start();
  const ws = latestSocket();
  ws.onopen?.();
  vi.advanceTimersByTime(9_000);
  ws.message(hello(PROTOCOL_VERSION));
  vi.advanceTimersByTime(5_000); // well past the original 10s mark
  expect(ws.closeCalled).toBe(false);
});

test("status goes connecting -> live on the first message", () => {
  const feed = new GroveFeed();
  const statuses: FeedStatus[] = [];
  feed.onStatus((s) => statuses.push(s));
  feed.start();
  expect(statuses).toEqual(["connecting"]);
  const ws = latestSocket();
  ws.onopen?.();
  ws.message(hello(PROTOCOL_VERSION));
  expect(statuses).toEqual(["connecting", "live"]);
});

test("a malformed frame is dropped without throwing or changing status", () => {
  const feed = new GroveFeed();
  const statuses: FeedStatus[] = [];
  feed.onStatus((s) => statuses.push(s));
  feed.start();
  const ws = latestSocket();
  expect(() => ws.onmessage?.({ data: "not json" })).not.toThrow();
  expect(statuses).toEqual(["connecting"]);
});

test("reconnects with exponential backoff capped at 30s", () => {
  const feed = new GroveFeed();
  feed.start();
  const expectedDelays = [1000, 2000, 4000, 8000, 16000, 30000, 30000];
  for (const delay of expectedDelays) {
    const ws = latestSocket();
    const countBefore = FakeWebSocket.instances.length;
    ws.close();
    vi.advanceTimersByTime(delay - 1);
    expect(FakeWebSocket.instances.length).toBe(countBefore);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances.length).toBe(countBefore + 1);
  }
});

test("a live message resets the reconnect backoff back to 1s", () => {
  const feed = new GroveFeed();
  feed.start();
  latestSocket().close(); // schedules the next connect at 1000ms, retryMs becomes 2000
  vi.advanceTimersByTime(1000);

  const ws = latestSocket();
  ws.onopen?.();
  ws.message(hello(PROTOCOL_VERSION)); // resets retryMs to 1000

  const countBefore = FakeWebSocket.instances.length;
  ws.close();
  vi.advanceTimersByTime(999);
  expect(FakeWebSocket.instances.length).toBe(countBefore); // not 2000ms-scheduled
  vi.advanceTimersByTime(1);
  expect(FakeWebSocket.instances.length).toBe(countBefore + 1);
});

test("STALE_AFTER_MS of silence closes the socket and schedules a retry", () => {
  const feed = new GroveFeed();
  const statuses: FeedStatus[] = [];
  feed.onStatus((s) => statuses.push(s));
  feed.start();
  const ws = latestSocket();
  ws.onopen?.();
  ws.message(hello(PROTOCOL_VERSION));

  vi.advanceTimersByTime(60_000);
  ws.message({ type: "batch", events: [] }); // refreshes the stale timer
  vi.advanceTimersByTime(60_000); // 120s since the first message, only 60s since the refresh
  expect(statuses.at(-1)).toBe("live");
  expect(ws.closeCalled).toBe(false);

  vi.advanceTimersByTime(60_000); // now 120s since the refresh
  expect(statuses.at(-1)).toBe("stale");
  expect(ws.closeCalled).toBe(true);
  const count = FakeWebSocket.instances.length;
  vi.advanceTimersByTime(1000);
  expect(FakeWebSocket.instances.length).toBe(count + 1);
});

test("retries stay stale instead of flapping back to connecting", () => {
  const feed = new GroveFeed();
  const statuses: FeedStatus[] = [];
  feed.onStatus((s) => statuses.push(s));
  feed.start();
  latestSocket().close();
  vi.advanceTimersByTime(1000); // retry #1
  latestSocket().close();
  vi.advanceTimersByTime(2000); // retry #2
  expect(statuses.filter((s) => s === "connecting")).toHaveLength(1);
  expect(statuses.slice(1).every((s) => s === "stale")).toBe(true);
  latestSocket().message(hello(PROTOCOL_VERSION));
  expect(statuses.at(-1)).toBe("live");
});

test("stale status carries the retry deadline", () => {
  const feed = new GroveFeed();
  const infos: Array<{ retryAt?: number }> = [];
  feed.onStatus((_s, info) => infos.push(info));
  feed.start();
  const t0 = Date.now();
  latestSocket().close();
  expect(infos.at(-1)?.retryAt).toBe(t0 + 1000);
  vi.advanceTimersByTime(1000);
  expect(infos.at(-1)?.retryAt).toBeUndefined(); // attempt in flight
});

function stubEventTargets() {
  const winListeners = new Map<string, () => void>();
  const docListeners = new Map<string, () => void>();
  const doc = {
    visibilityState: "visible",
    addEventListener: (type: string, cb: () => void) => void docListeners.set(type, cb),
  };
  vi.stubGlobal(
    "addEventListener",
    (type: string, cb: () => void) => void winListeners.set(type, cb)
  );
  vi.stubGlobal("document", doc);
  return { winListeners, docListeners, doc };
}

test("going online cancels the backoff wait and reconnects immediately", () => {
  const { winListeners } = stubEventTargets();
  const feed = new GroveFeed();
  feed.start();
  for (let i = 0; i < 4; i++) {
    latestSocket().close();
    vi.advanceTimersByTime(30_000);
  }
  latestSocket().close(); // long backoff now pending
  const count = FakeWebSocket.instances.length;
  winListeners.get("online")?.();
  expect(FakeWebSocket.instances.length).toBe(count + 1);
  vi.advanceTimersByTime(60_000); // the cancelled retry must not fire a second socket
  expect(FakeWebSocket.instances.length).toBe(count + 1);
});

test("online while a socket is healthy does not double-connect", () => {
  const { winListeners } = stubEventTargets();
  const feed = new GroveFeed();
  feed.start();
  latestSocket().message(hello(PROTOCOL_VERSION));
  const count = FakeWebSocket.instances.length;
  winListeners.get("online")?.();
  expect(FakeWebSocket.instances.length).toBe(count);
});

test("becoming visible replaces a socket that went quiet (e.g. after sleep)", () => {
  const { docListeners } = stubEventTargets();
  const feed = new GroveFeed();
  feed.start();
  const ws = latestSocket();
  ws.message(hello(PROTOCOL_VERSION));
  vi.advanceTimersByTime(45_000);
  const count = FakeWebSocket.instances.length;
  docListeners.get("visibilitychange")?.();
  expect(ws.closeCalled).toBe(true);
  expect(FakeWebSocket.instances.length).toBe(count + 1);
});

test("a reconnect snapshot only dispatches blocks the client hasn't seen", () => {
  const feed = new GroveFeed();
  const received: GroveEvent[] = [];
  feed.onEvent((e) => received.push(e));
  feed.start();
  const block = (height: number): GroveEvent => ({
    type: "block",
    height,
    headerHash: `h${height}`,
    timestamp: 0,
    spendCount: 0,
    fees: "0",
  });
  latestSocket().message({ type: "snapshot", events: [block(1), block(2)] });
  fireFrame();
  expect(received).toHaveLength(2);

  latestSocket().close();
  vi.advanceTimersByTime(1000);
  latestSocket().message({ type: "snapshot", events: [block(1), block(2), block(3)] });
  fireFrame();
  expect(received.map((e) => (e.type === "block" ? e.height : -1))).toEqual([1, 2, 3]);
});

test("hello triggers a reload on protocol mismatch when the reload guard is unset", () => {
  const feed = new GroveFeed();
  feed.start();
  const ws = latestSocket();
  ws.message(hello(PROTOCOL_VERSION + 1));
  expect(reload).toHaveBeenCalledTimes(1);
  expect(session.getItem("grove.proto-reloaded")).toBe("1");
});

test("a repeated mismatch after the reload guard is set does not reload again", () => {
  session.setItem("grove.proto-reloaded", "1"); // mirrors feed.ts's private RELOAD_KEY
  const feed = new GroveFeed();
  feed.start();
  const ws = latestSocket();
  ws.message(hello(PROTOCOL_VERSION + 1));
  expect(reload).not.toHaveBeenCalled();
});

test("a matching protocol version clears the reload guard without reloading", () => {
  session.setItem("grove.proto-reloaded", "1");
  const feed = new GroveFeed();
  feed.start();
  const ws = latestSocket();
  ws.message(hello(PROTOCOL_VERSION));
  expect(reload).not.toHaveBeenCalled();
  expect(session.getItem("grove.proto-reloaded")).toBeNull();
});

test("a socket error is surfaced as a console diagnostic, not silently dropped", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  new GroveFeed().start();
  const ws = latestSocket();
  expect(ws.onerror).toBeTypeOf("function");
  ws.onerror?.(new Error("boom"));
  expect(warn).toHaveBeenCalledTimes(1);
});

test("close() clears the drain queue so undrained events never dispatch", () => {
  const feed = new GroveFeed();
  const received: GroveEvent[] = [];
  feed.onEvent((e) => received.push(e));
  feed.start();
  const ws = latestSocket();
  ws.onopen?.();

  const staleEvent: GroveEvent = { type: "reorg", forkHeight: 1 };
  ws.message({ type: "snapshot", events: [staleEvent] }); // enqueued, not yet drained
  ws.close(); // queue.clear() runs synchronously here

  fireFrame(); // fire whatever frame was pending from the stale enqueue, if any
  expect(received).toHaveLength(0);

  const freshEvent: GroveEvent = { type: "reorg", forkHeight: 2 };
  vi.advanceTimersByTime(1000); // reconnect
  latestSocket().message({ type: "snapshot", events: [freshEvent] }); // same feed, same queue
  fireFrame();
  expect(received).toEqual([freshEvent]);
});
