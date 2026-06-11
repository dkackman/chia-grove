import type { AmbientEvent, GroveEvent } from "@grove/shared";
import type { RingBuffer } from "./ring-buffer.js";

const SOFT_LIMIT = 64 * 1024;
const HARD_LIMIT = 1024 * 1024;
const OPEN = 1;

/** Minimal surface of the ws WebSocket used by the hub (test seam). */
export interface WireSocket {
  send(data: string): void;
  close(): void;
  terminate(): void;
  readonly bufferedAmount: number;
  readonly readyState: number;
}

export class Hub {
  private clients = new Set<WireSocket>();
  private lastAmbient: AmbientEvent | null = null;

  constructor(private readonly buffer: RingBuffer<GroveEvent>) {}

  add(socket: WireSocket): void {
    if (socket.readyState !== OPEN) return;
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
          socket.terminate();
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
