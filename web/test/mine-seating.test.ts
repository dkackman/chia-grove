import { expect, test } from "vitest";
import {
  BlockCursor,
  ChunkSeats,
  SpecialSeats,
  SEAT_HEIGHT,
  SPECIAL_BUDGET,
  FLOOR_TILES,
  MAX_BLOCK_SLOTS,
  TORCH_MARGIN,
  seatCell,
  spiralRadius,
  torchRadius,
  cellKey,
} from "../src/themes/mine/layout.js";

type Seat = { col: number; row: number; layer: number };

/** Every layer a seat of `height` occupies, as "col,row,layer" keys. */
function occupied(seat: Seat, height: number): string[] {
  return Array.from({ length: height }, (_, i) => `${cellKey(seat)},${seat.layer + i}`);
}

test("all-cube seating reduces exactly to seatCell", () => {
  const s = new ChunkSeats();
  for (let i = 0; i < FLOOR_TILES * 3; i++) expect(s.next(1)).toEqual(seatCell(i));
});

test("mixed specials never share a voxel, even past 49 per block", () => {
  const s = new ChunkSeats();
  const used = new Set<string>();
  const heights = [SEAT_HEIGHT.cat, SEAT_HEIGHT.nft, SEAT_HEIGHT.did];
  for (let i = 0; i < 300; i++) {
    const h = heights[i % 3];
    const seat = s.next(h)!;
    for (const key of occupied(seat, h)) {
      expect(used.has(key)).toBe(false);
      used.add(key);
    }
  }
});

test("a painting's column is raised by three layers before anything stacks on it", () => {
  const s = new ChunkSeats();
  const painting = s.next(SEAT_HEIGHT.nft)!; // center, layer 1
  expect(painting).toEqual({ col: 0, row: 0, layer: 1 });
  for (let i = 1; i < FLOOR_TILES; i++) s.next(1); // fill the rest of layer 1
  for (let i = 0; i < FLOOR_TILES - 1; i++) s.next(1); // and layer 2 (off-center)
  // the center column's top is 4; every other column is at 3 → next goes elsewhere
  const next = s.next(1)!;
  expect(next.layer).toBe(3);
  expect(cellKey(next)).not.toBe("0,0");
});

test("the per-block budget caps seating", () => {
  const s = new ChunkSeats();
  for (let i = 0; i < SPECIAL_BUDGET; i++) expect(s.next(1)).not.toBeNull();
  expect(s.next(1)).toBeNull();
});

test("lapping back onto a slot returns its previous specials and restarts seating", () => {
  const seats = new SpecialSeats();
  expect(seats.startChunk(7).size).toBe(0);
  seats.next(1, "a");
  seats.next(3, "b");
  seats.startChunk(8);
  seats.next(1, "c");
  const stale = seats.startChunk(7); // the spiral wrapped
  expect([...stale].sort()).toEqual(["a", "b"]);
  // fresh footprint: first seat is the center at layer 1 again
  expect(seats.next(1, "d")).toEqual({ col: 0, row: 0, layer: 1 });
  // and the next lap only sees what this lap seated
  expect([...seats.startChunk(7)]).toEqual(["d"]);
});

test("torch ring sits just outside the island and grows with it", () => {
  expect(torchRadius(1)).toBeCloseTo(spiralRadius(1) + TORCH_MARGIN, 5);
  expect(torchRadius(0)).toBe(torchRadius(1));
  expect(torchRadius(50)).toBeGreaterThan(torchRadius(10));
  expect(torchRadius(MAX_BLOCK_SLOTS)).toBeCloseTo(spiralRadius(MAX_BLOCK_SLOTS) + TORCH_MARGIN, 5);
});

test("BlockCursor advances, wraps, and tracks fill", () => {
  const c = new BlockCursor();
  for (let h = 100; h < 100 + MAX_BLOCK_SLOTS; h++) c.advance(h);
  expect(c.filled).toBe(MAX_BLOCK_SLOTS);
  expect(c.index).toBe(0);
  expect(c.advance(100 + MAX_BLOCK_SLOTS)).toBe(0); // lap 2 reuses slot 0
});

test("reorg rewinds the cursor to the fork's slot", () => {
  const c = new BlockCursor();
  for (let h = 10; h < 20; h++) c.advance(h); // slots 0..9
  expect(c.rewind(15)).toBe(5); // heights 15..19 invalidated
  expect(c.index).toBe(5);
  expect(c.filled).toBe(5);
  expect(c.advance(15)).toBe(5); // replacement block rebuilds the fork chunk
});

test("reorg with forkHeight 0 rewinds everything; one above the tip is a no-op", () => {
  const c = new BlockCursor();
  for (let h = 10; h < 20; h++) c.advance(h);
  expect(c.rewind(20)).toBeNull();
  expect(c.index).toBe(10);
  expect(c.rewind(0)).toBe(0);
  expect(c.filled).toBe(0);
});

test("a reorg after lapping keeps the island full (older terrain covers the slots)", () => {
  const c = new BlockCursor();
  for (let h = 0; h < MAX_BLOCK_SLOTS + 5; h++) c.advance(h); // slots ..199, 0..4
  expect(c.rewind(MAX_BLOCK_SLOTS + 2)).toBe(2);
  expect(c.filled).toBe(MAX_BLOCK_SLOTS);
});

test("a reorg back across the wrap point rewinds onto the previous lap's slots", () => {
  const c = new BlockCursor();
  for (let h = 0; h < MAX_BLOCK_SLOTS + 3; h++) c.advance(h); // slots ..199, 0, 1, 2
  expect(c.rewind(MAX_BLOCK_SLOTS - 2)).toBe(MAX_BLOCK_SLOTS - 2); // slot 198
  // slots 198/199 only ever held invalidated blocks → genuinely bare again
  expect(c.filled).toBe(MAX_BLOCK_SLOTS - 2);
  expect(c.advance(MAX_BLOCK_SLOTS - 2)).toBe(MAX_BLOCK_SLOTS - 2);
});
