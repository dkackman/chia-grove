/**
 * Pure, DOM-free FIFO for events the scene holds back — unit-testable.
 *
 * A live block that pulls mempool motes into its slot is held while they
 * whirl down; it, and every event behind it (to keep order), lands once the
 * hold expires. Draining is budgeted per call so a backlog built up behind a
 * hold never lands in one frame, and dequeuing advances a head index rather
 * than `shift()`ing (which is O(n) per event).
 */
export class HoldQueue<T> {
  private items: (T | undefined)[] = [];
  private head = 0;
  private holdUntil = 0;
  /** the event whose migration already ran — it isn't held a second time */
  private migrated: T | null = null;

  constructor(private readonly holdSeconds: number) {}

  get length(): number {
    return this.items.length - this.head;
  }

  /** True while a migration hold is in force at time `t`. */
  holding(t: number): boolean {
    return t < this.holdUntil;
  }

  push(event: T): void {
    this.items.push(event);
  }

  /**
   * Hand up to `budget` queued events to `handle` in order, stopping early
   * while a hold is in force. `startsHold(event)` is asked once per event as it
   * reaches the front: returning true starts a hold of `holdSeconds` from `t`
   * and leaves the event queued. Pass `t = Infinity` to break any hold (e.g. a
   * hidden tab, where the frame clock is frozen). Returns how many were handled.
   */
  release(
    t: number,
    budget: number,
    handle: (event: T) => void,
    startsHold: (event: T) => boolean
  ): number {
    let n = 0;
    while (this.head < this.items.length && t >= this.holdUntil && n < budget) {
      const event = this.items[this.head] as T;
      if (event !== this.migrated && startsHold(event)) {
        this.migrated = event;
        this.holdUntil = t + this.holdSeconds;
        break;
      }
      this.items[this.head++] = undefined;
      n++;
      handle(event);
    }
    this.compact();
    return n;
  }

  private compact(): void {
    if (this.head === this.items.length) {
      this.items.length = 0;
      this.head = 0;
    } else if (this.head > 1024 && this.head * 2 > this.items.length) {
      this.items = this.items.slice(this.head);
      this.head = 0;
    }
  }
}
