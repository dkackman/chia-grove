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
    events.forEach((event, i) =>
      setTimeout(() => this.dispatch(event), i * step)
    );
  }

  private dispatch(event: GroveEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private setStatus(status: FeedStatus): void {
    for (const listener of this.statusListeners) listener(status);
  }

  private resetStaleTimer(): void {
    clearTimeout(this.staleTimer);
    this.staleTimer = window.setTimeout(
      () => this.setStatus("stale"),
      STALE_AFTER_MS
    );
  }
}
