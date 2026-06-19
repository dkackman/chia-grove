export interface FrameScheduler {
  /** Run cb on the next animation frame. */
  schedule(cb: () => void): void;
}

export const rafScheduler: FrameScheduler = {
  schedule: (cb) => requestAnimationFrame(cb),
};

/**
 * FIFO queue that releases at most `budget` items per scheduled frame, so a
 * burst (a big block, or the connect snapshot) is spread across frames instead
 * of dispatched in one tick. Uses a head index rather than Array.shift so
 * draining a large queue stays O(n) overall.
 */
export class DrainQueue<T> {
  private items: T[] = [];
  private head = 0;
  private scheduled = false;

  constructor(
    private readonly sink: (item: T) => void,
    private readonly budget: number,
    private readonly scheduler: FrameScheduler
  ) {}

  enqueue(items: T[]): void {
    for (const item of items) this.items.push(item);
    this.ensureScheduled();
  }

  private ensureScheduled(): void {
    if (this.scheduled || this.head >= this.items.length) return;
    this.scheduled = true;
    this.scheduler.schedule(() => this.drainFrame());
  }

  private drainFrame(): void {
    this.scheduled = false;
    const end = Math.min(this.head + this.budget, this.items.length);
    for (; this.head < end; this.head++) this.sink(this.items[this.head]);
    if (this.head >= this.items.length) {
      this.items = [];
      this.head = 0;
    }
    this.ensureScheduled();
  }
}
