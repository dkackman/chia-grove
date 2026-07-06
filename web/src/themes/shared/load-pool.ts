/**
 * A concurrency-limited queue for async media loads. Jobs that no longer matter
 * by the time they reach the front (e.g. a painting slot recycled before its
 * texture was ever fetched) are dropped without loading.
 *
 * This exists because the snapshot replay plants hundreds of NFTs through a small
 * fixed pool of painting slots in ~3 s. Fetching art for every one of them — most
 * of which are recycled out of view before anyone sees them — bursts past the
 * /img proxy's per-IP rate limit (429s) and wastes bandwidth. Capping concurrency
 * and skipping stale jobs collapses that to roughly the handful of survivors.
 */
export interface PooledLoad {
  /** Re-checked when the job reaches the front; false → dropped without loading. */
  stillWanted: () => boolean;
  /** Performs the load; must call done() exactly once when it settles (ok or fail). */
  start: (done: () => void) => void;
  /** Called instead of start() when the job is dropped — release any reservation. */
  onDrop?: () => void;
}

export class LoadPool {
  private queue: PooledLoad[] = [];
  private head = 0; // index of the next job to consider
  private active = 0;

  /**
   * @param timeoutMs Optional safety net: a job whose start() never calls
   * done() (a stalled fetch, a video whose loadedmetadata/seeked/error never
   * fires) would otherwise hold its slot forever, silently shrinking the
   * pool's effective concurrency for the rest of the session. Left
   * undefined, a stalled job holds its slot indefinitely (prior behavior).
   */
  constructor(
    private readonly concurrency: number,
    private readonly timeoutMs?: number
  ) {}

  submit(job: PooledLoad): void {
    this.queue.push(job);
    this.pump();
  }

  private pump(): void {
    while (this.active < this.concurrency && this.head < this.queue.length) {
      const job = this.queue[this.head++];
      if (!job.stillWanted()) {
        job.onDrop?.(); // slot recycled before we got to it — let it clean up
        continue;
      }
      this.active++;
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (): void => {
        if (settled) return; // ignore a double done() (or a timeout after done())
        settled = true;
        clearTimeout(timer);
        this.active--;
        this.pump();
      };
      if (this.timeoutMs !== undefined) timer = setTimeout(finish, this.timeoutMs);
      job.start(finish);
    }
    // fully consumed → release the backing array. Advancing a head index rather
    // than Array.shift keeps draining a snapshot-replay burst O(n) overall.
    if (this.head >= this.queue.length) {
      this.queue = [];
      this.head = 0;
    }
  }
}
