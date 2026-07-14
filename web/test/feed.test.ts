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

test("stale status fires after STALE_AFTER_MS of silence, refreshed by each message", () => {
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

  vi.advanceTimersByTime(60_000); // now 120s since the refresh
  expect(statuses.at(-1)).toBe("stale");
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
  ws.message({ type: "snapshot", events: [freshEvent] }); // same feed, same underlying queue
  fireFrame();
  expect(received).toEqual([freshEvent]);
});
