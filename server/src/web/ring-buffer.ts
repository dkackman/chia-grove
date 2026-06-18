/**
 * Fixed-capacity ring buffer with O(1) push. Writes overwrite the oldest slot
 * once full rather than shifting the whole array (the old Array.shift() was
 * O(n) per push — costly at large capacity under airdrop-block event volume).
 */
export class RingBuffer<T> {
  private items: T[] = [];
  private head = 0; // index of the next write
  private size = 0; // number of valid items, ≤ capacity

  constructor(private readonly capacity: number) {}

  push(item: T): void {
    this.items[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
  }

  snapshot(): T[] {
    // oldest item sits at 0 while filling, then at head (the next-write slot)
    // once the buffer has wrapped; walk size items forward from there
    const start = this.size < this.capacity ? 0 : this.head;
    const out: T[] = new Array(this.size);
    for (let i = 0; i < this.size; i++) {
      out[i] = this.items[(start + i) % this.capacity];
    }
    return out;
  }
}
