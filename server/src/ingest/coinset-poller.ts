import type { ChainHandlers, ChainSource, RpcView } from "./types.js";

export interface PollerOptions {
  pollIntervalMs?: number;
  backfillBlocks?: number;
  maxBackoffMs?: number;
}

const KNOWN_HASHES = 64;

export class CoinsetPoller implements ChainSource {
  /** height -> headerHash for recent blocks, used for reorg detection */
  private known = new Map<number, string>();
  private lastHeight = -1;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private running = false;

  private readonly interval: number;
  private readonly backfill: number;
  private readonly maxBackoff: number;

  /** current delay; exposed for tests and observability */
  delayMs: number;

  constructor(
    private readonly rpc: RpcView,
    private readonly handlers: ChainHandlers,
    options: PollerOptions = {}
  ) {
    this.interval = options.pollIntervalMs ?? 3000;
    this.backfill = options.backfillBlocks ?? 150;
    this.maxBackoff = options.maxBackoffMs ?? 60_000;
    this.delayMs = this.interval;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.stopped = false;
    void this.loop();
  }

  stop(): void {
    this.running = false;
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private async loop(): Promise<void> {
    try {
      await this.tick();
      this.delayMs = this.interval;
    } catch (error) {
      this.delayMs = Math.min(Math.max(this.delayMs, 500) * 2, this.maxBackoff);
      console.warn(`poll failed (retry in ${this.delayMs}ms):`, error);
    }
    if (!this.stopped) {
      this.timer = setTimeout(() => void this.loop(), this.delayMs);
    }
  }

  /** One poll cycle. Public so tests can drive it directly. */
  async tick(): Promise<void> {
    const state = await this.rpc.getState();
    this.handlers.onAmbient(state);
    if (this.lastHeight < 0) {
      this.lastHeight = Math.max(-1, state.peakHeight - this.backfill);
      if (this.lastHeight >= 0) {
        const anchor = await this.rpc.getBlockInfo(this.lastHeight);
        this.known.set(anchor.height, anchor.headerHash);
      }
    }
    await this.walkTo(state.peakHeight);
  }

  private async walkTo(peak: number): Promise<void> {
    let height = this.lastHeight + 1;
    let reorgs = 0;
    while (height <= peak) {
      if (this.stopped) return;
      const info = await this.rpc.getBlockInfo(height);

      const prevKnown = this.known.get(height - 1);
      if (prevKnown !== undefined && info.prevHash !== prevKnown) {
        if (++reorgs > 5) throw new Error("too many reorgs in one tick; backing off");
        const fork = await this.findFork(height - 1);
        this.handlers.onReorg(fork);
        if (fork < 0) {
          // reorg deeper than our memory: reset and re-backfill next tick
          this.known.clear();
          this.lastHeight = -1;
          return;
        }
        for (const h of [...this.known.keys()]) {
          if (h > fork) this.known.delete(h);
        }
        this.lastHeight = fork;
        height = fork + 1;
        continue;
      }

      this.known.set(height, info.headerHash);
      this.trimKnown();

      if (info.timestamp !== null) {
        const spends = await this.rpc.getSpends(info.headerHash);
        await this.handlers.onBlock({
          height,
          headerHash: info.headerHash,
          timestamp: Number(info.timestamp),
          fees: info.fees ?? 0n,
          spends,
        });
      }
      this.lastHeight = height;
      height += 1;
    }
  }

  /** Walk back from `from` until our recorded hash matches the chain. */
  private async findFork(from: number): Promise<number> {
    for (let height = from; height >= 0; height--) {
      const knownHash = this.known.get(height);
      if (knownHash === undefined) return -1; // beyond memory — treat as deep reorg
      const info = await this.rpc.getBlockInfo(height);
      if (info.headerHash === knownHash) return height;
    }
    return -1;
  }

  private trimKnown(): void {
    while (this.known.size > KNOWN_HASHES) {
      this.known.delete(Math.min(...this.known.keys()));
    }
  }
}
