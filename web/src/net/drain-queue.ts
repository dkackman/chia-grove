export interface FrameScheduler {
  /** Run cb on the next animation frame. */
  schedule(cb: () => void): void;
}

// requestAnimationFrame is throttled — or fully suspended — in a hidden or
// backgrounded tab. A live feed keeps receiving batches the whole time, so
// without a fallback the queue would grow unbounded until the tab regains
// focus. This guarantees draining still ticks, just at a coarser cadence,
// even when rAF never fires.
const HIDDEN_TICK_MS = 1000;

export const rafScheduler: FrameScheduler = {
  schedule: (cb) => {
    let fired = false;
    const fire = (): void => {
      if (fired) return;
      fired = true;
      cb();
    };
    requestAnimationFrame(fire);
    setTimeout(fire, HIDDEN_TICK_MS);
  },
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

  /** Drop everything not yet drained. A caller that's about to enqueue a
   * fresh, self-contained batch (e.g. a reconnect's Snapshot replay) calls
   * this first so leftovers from before don't get dispatched a second time
   * once appended behind the new batch. Safe even with a frame already
   * scheduled: drainFrame() re-checks the (now empty) state when it runs. */
  clear(): void {
    this.items = [];
    this.head = 0;
    this.scheduled = false;
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
