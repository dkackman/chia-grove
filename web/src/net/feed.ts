import type { GroveEvent, WireMessage } from "@grove/shared";
import { PROTOCOL_VERSION } from "@grove/shared";
import { protocolAction } from "./protocol-guard.js";
import { DrainQueue, rafScheduler } from "./drain-queue.js";
import { startDemo } from "./demo.js";
import { SeenBlocks } from "./seen-blocks.js";

/**
 * "connecting" is only the very first attempt. Once a connection has been lost
 * the feed stays "stale" across every retry until a message arrives again, so
 * the status never flaps between stale and connecting.
 */
export type FeedStatus = "connecting" | "live" | "stale" | "demo";

/** Extra detail for a status: while stale, when the next retry fires
 *  (epoch ms, `Date.now()` clock), or undefined while an attempt is in flight. */
export interface FeedStatusInfo {
  retryAt?: number;
}

// The server publishes an ambient event every poll (~10 s), so two minutes of
// silence means the socket is dead even if the browser hasn't noticed.
const STALE_AFTER_MS = 2 * 60 * 1000;
// On returning to a visible tab, a socket quiet for longer than this is
// presumed dead (e.g. the machine slept) and is replaced straight away.
const RESUME_STALE_MS = 30 * 1000;
// A connection can open without ever completing the Hello handshake (a hung
// reverse proxy, a server that accepted the socket but never wrote). Without
// this, nothing ever arms resetStaleTimer() and onclose never fires either,
// leaving the client stuck on "connecting" forever with no retry.
const HANDSHAKE_TIMEOUT_MS = 10 * 1000;
const RELOAD_KEY = "grove.proto-reloaded";
// Events released per animation frame: ~120 keeps a 10k-event snapshot filling
// in over ~1.5 s at 60 fps while smoothing big live blocks across a few frames.
const DRAIN_BUDGET = 120;
const MIN_RETRY_MS = 1000;
const MAX_RETRY_MS = 30_000;

export class GroveFeed {
  private listeners: Array<(event: GroveEvent) => void> = [];
  private statusListeners: Array<(status: FeedStatus, info: FeedStatusInfo) => void> = [];
  private status: FeedStatus | undefined;
  private statusInfo: FeedStatusInfo = {};
  private ws: WebSocket | undefined;
  private staleTimer: number | undefined;
  private retryTimer: number | undefined;
  private retryMs = MIN_RETRY_MS;
  /** Tear down the current socket as lost, without waiting for its onclose. */
  private abandon: () => void = () => {};
  private lastMessageAt = 0;
  private started = false;
  private readonly seen = new SeenBlocks();
  private readonly queue = new DrainQueue<GroveEvent>(
    (event) => this.dispatch(event),
    DRAIN_BUDGET,
    rafScheduler
  );

  onEvent(listener: (event: GroveEvent) => void): void {
    this.listeners.push(listener);
  }

  onStatus(listener: (status: FeedStatus, info: FeedStatusInfo) => void): void {
    this.statusListeners.push(listener);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    if (new URLSearchParams(location.search).get("demo") === "1") {
      this.setStatus("demo");
      startDemo((event) => this.dispatch(event));
      return;
    }
    if (typeof window.addEventListener === "function") {
      window.addEventListener("online", () => this.reconnectNow());
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") this.reconnectNow();
      });
    }
    this.connect();
  }

  /**
   * Skip the backoff wait: called when the network comes back or the tab
   * becomes visible. A socket that's still connecting is left alone; an open
   * one is only replaced if it has gone quiet (likely dead after a sleep).
   */
  private reconnectNow(): void {
    if (this.ws) {
      if (this.lastMessageAt === 0 || Date.now() - this.lastMessageAt <= RESUME_STALE_MS) return;
      this.abandon(); // schedules a retry, which we cut short below
    }
    this.retryMs = MIN_RETRY_MS;
    if (this.retryTimer !== undefined) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
      this.connect();
    }
  }

  private connect(): void {
    this.retryTimer = undefined;
    // First-ever attempt shows "connecting"; retries stay "stale" (no flapping).
    this.setStatus(
      this.status === undefined || this.status === "connecting" ? "connecting" : "stale"
    );
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    this.lastMessageAt = 0;

    let handshakeTimer: number | undefined;
    // Runs once per socket, whichever comes first: the browser's close event,
    // or our own decision that the socket is dead (handshake/stale timeout,
    // resume after sleep). For the latter we don't wait for onclose — a
    // half-open socket's close handshake can take minutes to give up.
    const lost = (): void => {
      clearTimeout(handshakeTimer);
      if (this.ws !== ws) return; // a socket we already replaced
      this.ws = undefined;
      ws.onopen = ws.onmessage = ws.onclose = null;
      clearTimeout(this.staleTimer);
      // Drop anything left un-drained from this connection — the reconnect
      // below enqueues a fresh, self-contained Snapshot, which would
      // otherwise land behind these leftovers and get dispatched twice.
      this.queue.clear();
      const delay = this.retryMs + Math.random() * 1000;
      this.retryTimer = window.setTimeout(() => this.connect(), delay);
      this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS);
      this.setStatus("stale", { retryAt: Date.now() + delay });
    };
    this.abandon = () => {
      lost();
      ws.close();
    };

    ws.onopen = () => {
      handshakeTimer = window.setTimeout(() => this.abandon(), HANDSHAKE_TIMEOUT_MS);
    };

    ws.onmessage = (message) => {
      clearTimeout(handshakeTimer);
      let parsed: WireMessage;
      try {
        parsed = JSON.parse(message.data as string) as WireMessage;
      } catch {
        return; // drop a malformed frame rather than throw uncaught in the handler
      }
      if (parsed.type === "hello") this.handleHello(parsed.protocolVersion);
      else if (parsed.type === "snapshot")
        this.queue.enqueue(this.seen.filterSnapshot(parsed.events));
      else this.queue.enqueue(parsed.events);
      this.lastMessageAt = Date.now();
      this.setStatus("live");
      this.resetStaleTimer();
      this.retryMs = MIN_RETRY_MS;
    };

    // Reconnection is driven entirely by onclose (which always follows a fatal
    // error); this exists only so connection errors leave a diagnostic trail.
    ws.onerror = (event) => console.warn("grove feed socket error", event);
    ws.onclose = lost;
  }

  private dispatch(event: GroveEvent): void {
    this.seen.record(event);
    for (const listener of this.listeners) listener(event);
  }

  /** Reload once if the server's protocol differs from this bundle's. */
  private handleHello(serverProtocol: number): void {
    const already = sessionStorage.getItem(RELOAD_KEY) === "1";
    switch (protocolAction(serverProtocol, PROTOCOL_VERSION, already)) {
      case "reload":
        sessionStorage.setItem(RELOAD_KEY, "1");
        location.reload();
        break;
      case "clear":
        sessionStorage.removeItem(RELOAD_KEY);
        break;
      case "none":
        break;
    }
  }

  /** Notify listeners only when the status (or its retry deadline) changes. */
  private setStatus(status: FeedStatus, info: FeedStatusInfo = {}): void {
    if (status === this.status && info.retryAt === this.statusInfo.retryAt) return;
    this.status = status;
    this.statusInfo = info;
    for (const listener of this.statusListeners) listener(status, info);
  }

  /** No message for STALE_AFTER_MS: close the socket so onclose's retry runs
   *  (the server sends no ping, so a half-open socket would otherwise hang). */
  private resetStaleTimer(): void {
    clearTimeout(this.staleTimer);
    this.staleTimer = window.setTimeout(() => this.abandon(), STALE_AFTER_MS);
  }
}
