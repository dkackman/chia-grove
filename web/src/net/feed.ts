import type { GroveEvent, WireMessage } from "@grove/shared";
import { PROTOCOL_VERSION } from "@grove/shared";
import { protocolAction } from "./protocol-guard.js";
import { startDemo } from "./demo.js";

export type FeedStatus = "connecting" | "live" | "stale" | "demo";

const STALE_AFTER_MS = 2 * 60 * 1000;
const SNAPSHOT_REPLAY_MS = 3000;
const RELOAD_KEY = "grove.proto-reloaded";

export class GroveFeed {
  private listeners: Array<(event: GroveEvent) => void> = [];
  private statusListeners: Array<(status: FeedStatus) => void> = [];
  private staleTimer: number | undefined;
  private retryMs = 1000;
  private started = false;

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

    ws.onmessage = (message) => {
      const parsed = JSON.parse(message.data as string) as WireMessage;
      if (parsed.type === "hello") this.handleHello(parsed.protocolVersion);
      else if (parsed.type === "snapshot") this.replay(parsed.events);
      else this.dispatch(parsed);
      this.setStatus("live");
      this.resetStaleTimer();
      this.retryMs = 1000;
    };

    ws.onclose = () => {
      clearTimeout(this.staleTimer);
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
