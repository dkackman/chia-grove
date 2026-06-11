import { expect, test } from "vitest";
import { Hub, type WireSocket } from "../src/web/hub.js";
import { RingBuffer } from "../src/web/ring-buffer.js";
import type { AmbientEvent, BlockEvent, GroveEvent } from "@grove/shared";

class FakeSocket implements WireSocket {
  sent: string[] = [];
  bufferedAmount = 0;
  readyState = 1; // OPEN
  closed = false;
  terminated = false;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  terminate(): void {
    this.terminated = true;
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

test("add ignores sockets that are not open", () => {
  const hub = makeHub();
  const socket = new FakeSocket();
  socket.readyState = 3; // CLOSED
  hub.add(socket);
  expect(socket.sent).toHaveLength(0);
  hub.publish([blockEvent(1)]);
  expect(socket.sent).toHaveLength(0);
});

test("hard-limit eviction uses terminate, not graceful close", () => {
  const hub = makeHub();
  const dead = new FakeSocket();
  hub.add(dead);
  dead.bufferedAmount = 2 * 1024 * 1024;
  hub.publish([blockEvent(1)]);
  expect(dead.terminated).toBe(true);
});
