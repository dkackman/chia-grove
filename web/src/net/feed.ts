import type { GroveEvent, WireMessage } from "@grove/shared";
import { PROTOCOL_VERSION } from "@grove/shared";
import { protocolAction } from "./protocol-guard.js";
import { DrainQueue, rafScheduler } from "./drain-queue.js";
import { startDemo } from "./demo.js";

export type FeedStatus = "connecting" | "live" | "stale" | "demo";

const STALE_AFTER_MS = 2 * 60 * 1000;
// A connection can open without ever completing the Hello handshake (a hung
// reverse proxy, a server that accepted the socket but never wrote). Without
// this, nothing ever arms resetStaleTimer() and onclose never fires either,
// leaving the client stuck on "connecting" forever with no retry.
const HANDSHAKE_TIMEOUT_MS = 10 * 1000;
const RELOAD_KEY = "grove.proto-reloaded";
// Events released per animation frame: ~120 keeps a 10k-event snapshot filling
// in over ~1.5 s at 60 fps while smoothing big live blocks across a few frames.
const DRAIN_BUDGET = 120;

export class GroveFeed {
  private listeners: Array<(event: GroveEvent) => void> = [];
  private statusListeners: Array<(status: FeedStatus) => void> = [];
  private staleTimer: number | undefined;
  private retryMs = 1000;
  private started = false;
  private readonly queue = new DrainQueue<GroveEvent>(
    (event) => this.dispatch(event),
    DRAIN_BUDGET,
    rafScheduler
  );

  onEvent(listener: (event: GroveEvent) => void): void {
    this.listeners.push(listener);
  }

  onStatus(listener: (status: FeedStatus) => void): void {
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
    this.connect();
  }

  private connect(): void {
    this.setStatus("connecting");
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);

    let handshakeTimer: number | undefined;
    ws.onopen = () => {
      handshakeTimer = window.setTimeout(() => ws.close(), HANDSHAKE_TIMEOUT_MS);
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
      else this.queue.enqueue(parsed.events); // snapshot or batch
      this.setStatus("live");
      this.resetStaleTimer();
      this.retryMs = 1000;
    };

    ws.onclose = () => {
      clearTimeout(handshakeTimer);
      clearTimeout(this.staleTimer);
      // Drop anything left un-drained from this connection — the reconnect
      // below enqueues a fresh, self-contained Snapshot, which would
      // otherwise land behind these leftovers and get dispatched twice.
      this.queue.clear();
      this.setStatus("stale");
      setTimeout(() => this.connect(), this.retryMs + Math.random() * 1000);
      this.retryMs = Math.min(this.retryMs * 2, 30_000);
    };
  }

  private dispatch(event: GroveEvent): void {
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

  private setStatus(status: FeedStatus): void {
    for (const listener of this.statusListeners) listener(status);
  }

  private resetStaleTimer(): void {
    clearTimeout(this.staleTimer);
    this.staleTimer = window.setTimeout(() => this.setStatus("stale"), STALE_AFTER_MS);
  }
}
