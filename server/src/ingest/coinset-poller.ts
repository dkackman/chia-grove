import type { BlockInfo, ChainHandlers, ChainSource, RpcView } from "./types.js";
import { log } from "../logger.js";

export interface PollerOptions {
  pollIntervalMs?: number;
  backfillBlocks?: number;
  maxBackoffMs?: number;
}

const KNOWN_HASHES = 64;
const MAX_REORGS_PER_TICK = 5;

export class CoinsetPoller implements ChainSource {
  /** height -> headerHash for recent blocks, used for reorg detection */
  private known = new Map<number, string>();
  private lastHeight = -1;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private running = false;
  private reorgsThisTick = 0;

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
    this.interval = options.pollIntervalMs ?? 10_000;
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
      log.warn(
        { retryMs: this.delayMs, err: error instanceof Error ? error.message : String(error) },
        "poll failed"
      );
    }
    if (!this.stopped) {
      this.timer = setTimeout(() => void this.loop(), this.delayMs);
    }
  }

  /** One poll cycle. Public so tests can drive it directly. */
  async tick(): Promise<void> {
    this.reorgsThisTick = 0;
    if (this.lastHeight >= 0 && (await this.fastForward())) {
      return; // caught up via direct lookups; no getBlockchainState needed this tick
    }
    await this.resync();
  }

  /**
   * Speculative fast path: probe the next height directly instead of asking
   * for chain state first. A hit means the chain already advanced past it —
   * process it (reorg detection included) and try the next height too, so a
   * multi-block backlog still drains within one tick. A miss (not yet mined)
   * means we're caught up. Only the probe itself is error-guarded: a thrown
   * tryGetBlockInfo error makes the caller fall back to resync(), whose
   * getBlockchainState call also refreshes ambient data. Errors from
   * applyBlock propagate straight to loop()'s backoff handler instead.
   */
  private async fastForward(): Promise<boolean> {
    let advanced = false;
    while (!this.stopped) {
      let info: BlockInfo | null;
      try {
        info = await this.rpc.tryGetBlockInfo(this.lastHeight + 1);
      } catch {
        return false;
      }
      if (info === null) return advanced;
      await this.applyBlock(info);
      advanced = true;
      if (this.lastHeight < 0) return false; // deep reorg reset; needs a full resync
    }
    return true;
  }

  private async resync(): Promise<void> {
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
    while (this.lastHeight < peak) {
      if (this.stopped) return;
      const info = await this.rpc.getBlockInfo(this.lastHeight + 1);
      await this.applyBlock(info);
    }
  }

  /** Process one block, detecting a reorg against `known` before accepting it. */
  private async applyBlock(info: BlockInfo): Promise<void> {
    const height = info.height;
    const prevKnown = this.known.get(height - 1);
    if (prevKnown !== undefined && info.prevHash !== prevKnown) {
      if (++this.reorgsThisTick > MAX_REORGS_PER_TICK) {
        throw new Error("too many reorgs in one tick; backing off");
      }
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
      return; // caller re-fetches from fork + 1 on its next iteration
    }

    // Commit (known + lastHeight) only after the fallible work below succeeds.
    // Recording the hash first would let trimKnown() evict older history to
    // make room for a height that turns out never to have been processed —
    // permanently losing memory a later reorg might have needed — while also
    // leaving lastHeight behind known on failure, an inconsistent state that
    // serves no purpose since a retry re-fetches this height from scratch either way.
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
    this.known.set(height, info.headerHash);
    this.trimKnown();
    this.lastHeight = height;
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
