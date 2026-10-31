/**
 * Book-keeping for NFT art that is queued or mid-load (DOM-free, unit-tested).
 *
 * A job is "live" from begin() until it settles — success, failure, a LoadPool
 * drop or timeout — or until a reorg orphans the block it came from. Only a
 * load whose job is still live when it lands may hang; anything else (a fetch
 * that outlived its timeout, a load for an orphaned height) is discarded. The
 * per-launcher entry also guards the async window so a burst of events for the
 * same brand-new NFT doesn't hang duplicate frames.
 */
export interface ArtJob {
  readonly launcher: string;
  readonly height: number;
  live: boolean;
}

export class InFlightArt {
  private jobs = new Map<string, ArtJob>();

  get size(): number {
    return this.jobs.size;
  }

  /** True while a live job is queued or loading for this launcher. */
  has(launcher: string): boolean {
    return this.jobs.has(launcher);
  }

  begin(launcher: string, height: number): ArtJob {
    const job: ArtJob = { launcher, height, live: true };
    this.jobs.set(launcher, job);
    return job;
  }

  /**
   * Settle a job (its load landed, failed, was dropped or timed out). Returns
   * whether it was still live — i.e. whether a landed result may be hung.
   * Idempotent: a second settle (a late load after its timeout) returns false.
   */
  settle(job: ArtJob): boolean {
    const wasLive = job.live;
    job.live = false;
    if (this.jobs.get(job.launcher) === job) this.jobs.delete(job.launcher);
    return wasLive;
  }

  /** A reorg undid every block from `forkHeight` up: kill jobs from those heights. */
  cancelFrom(forkHeight: number): ArtJob[] {
    const cancelled: ArtJob[] = [];
    for (const job of this.jobs.values()) {
      if (job.height >= forkHeight) cancelled.push(job);
    }
    for (const job of cancelled) this.settle(job);
    return cancelled;
  }
}

/**
 * Whether a landed art load should hang: only if its job was still live when
 * it settled and the NFT didn't reach the wall by another route meanwhile.
 */
export function shouldHangLoaded(settledLive: boolean, alreadyHung: boolean): boolean {
  return settledLive && !alreadyHung;
}
