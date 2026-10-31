/**
 * Adaptive-quality governor: watches rendered-frame intervals and steps render
 * quality down when the device can't keep up, and back up (slowly) when it can.
 * Pure (no DOM, no three) so it's unit-testable; `createRenderLoop` applies the
 * levels it picks.
 */

export interface QualityLevel {
  /** Upper bound on the renderer pixel ratio (also capped by devicePixelRatio). */
  maxPixelRatio: number;
  /** Whether the post-processing bloom pass runs. */
  bloom: boolean;
}

export const QUALITY_LEVELS: readonly QualityLevel[] = [
  { maxPixelRatio: 1.75, bloom: true },
  { maxPixelRatio: 1.25, bloom: true },
  { maxPixelRatio: 1, bloom: true },
  { maxPixelRatio: 1, bloom: false },
];

export interface GovernorOptions {
  /** Smoothed frame time above which quality steps down. */
  slowMs?: number;
  /** Smoothed frame time below which the device counts as keeping up. */
  fastMs?: number;
  /** How long frames must stay slow before stepping down. */
  degradeAfterMs?: number;
  /** How long frames must stay fast before stepping back up (doubles on each relapse). */
  recoverAfterMs?: number;
  /** Ceiling for the relapse-doubled recovery wait. */
  maxRecoverAfterMs?: number;
  /** Frame gaps longer than this (hidden tab, debugger, GC hitch) are ignored. */
  ignoreGapMs?: number;
}

export class QualityGovernor {
  private levelIndex = 0;
  private ema = 0;
  private samples = 0;
  private slowSince: number | null = null;
  private fastSince: number | null = null;
  private recoverAfter: number;
  private lastChangeWasUp = false;
  private readonly o: Required<GovernorOptions>;

  constructor(
    private readonly levels: readonly QualityLevel[] = QUALITY_LEVELS,
    opts: GovernorOptions = {}
  ) {
    this.o = {
      slowMs: 20,
      // the frame limiter caps rendering at 60 fps, so a healthy frame
      // interval is ~16.7 ms — "fast" just means comfortably near that
      fastMs: 17.5,
      degradeAfterMs: 2000,
      recoverAfterMs: 20_000,
      maxRecoverAfterMs: 160_000,
      ignoreGapMs: 250,
      ...opts,
    };
    this.recoverAfter = this.o.recoverAfterMs;
  }

  get level(): QualityLevel {
    return this.levels[this.levelIndex];
  }

  get index(): number {
    return this.levelIndex;
  }

  /**
   * Feed one rendered frame's interval. Returns the new level when it changed
   * on this sample, otherwise null.
   */
  sample(frameMs: number, nowMs: number): QualityLevel | null {
    if (frameMs > this.o.ignoreGapMs) {
      this.slowSince = this.fastSince = null; // resumed from a pause: start over
      return null;
    }
    this.ema = this.samples === 0 ? frameMs : this.ema + (frameMs - this.ema) * 0.1;
    if (++this.samples < 10) return null; // let the average settle first

    if (this.ema > this.o.slowMs) {
      this.fastSince = null;
      this.slowSince ??= nowMs;
      if (
        nowMs - this.slowSince >= this.o.degradeAfterMs &&
        this.levelIndex < this.levels.length - 1
      ) {
        // relapsing right after a recovery: wait longer before the next try
        if (this.lastChangeWasUp) {
          this.recoverAfter = Math.min(this.recoverAfter * 2, this.o.maxRecoverAfterMs);
        }
        return this.change(this.levelIndex + 1, false);
      }
    } else if (this.ema < this.o.fastMs) {
      this.slowSince = null;
      this.fastSince ??= nowMs;
      if (nowMs - this.fastSince >= this.recoverAfter && this.levelIndex > 0) {
        return this.change(this.levelIndex - 1, true);
      }
    } else {
      this.slowSince = this.fastSince = null;
    }
    return null;
  }

  private change(index: number, up: boolean): QualityLevel {
    this.levelIndex = index;
    this.lastChangeWasUp = up;
    this.slowSince = this.fastSince = null;
    // the new level changes the frame cost; re-measure from scratch
    this.samples = 0;
    return this.level;
  }
}
