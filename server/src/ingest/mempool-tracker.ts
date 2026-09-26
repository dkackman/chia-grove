import { log } from "../logger.js";

export interface MempoolInclusion {
  /** Tracked mempool items that vanished since the previous live block. */
  included: number;
  /** Items still waiting in the mempool after this block. */
  remaining: number;
}

export interface MempoolTrackerOptions {
  /** Fetches the current mempool's transaction ids. */
  fetchTxIds: () => Promise<string[]>;
  /** Background refresh cadence; 0 disables the timer (tests drive refresh()). */
  intervalMs?: number;
}

/**
 * Estimates how many mempool items each new block took, by polling only the
 * (cheap) list of mempool tx ids. Every refresh counts ids that disappeared
 * since the last one into an accumulator; a live block reports and resets it.
 * Accumulating rather than diffing at block time means a refresh that happens
 * to land after coinset saw the block — but before our poller did — doesn't
 * swallow that block's inclusions. Items can also vanish by losing a double
 * spend or being evicted, but on Chia that's rare enough to ignore here.
 */
export class MempoolTracker {
  private ids: Set<string> | null = null;
  private vanished = 0;
  private inflight: Promise<boolean> | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly opts: MempoolTrackerOptions) {}

  start(): void {
    const interval = this.opts.intervalMs ?? 10_000;
    if (interval <= 0 || this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), interval);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Re-fetch the mempool ids; resolves false (never throws) if the fetch failed. */
  refresh(): Promise<boolean> {
    // coalesce overlapping callers (timer tick + a block) onto one request
    this.inflight ??= this.fetch().finally(() => (this.inflight = null));
    return this.inflight;
  }

  /**
   * Call when a live block arrives: refreshes, then reports how many tracked
   * items left the mempool since the previous live block. Null until a
   * baseline snapshot exists, or when the refresh fails with nothing counted.
   */
  async onBlock(): Promise<MempoolInclusion | null> {
    const hadBaseline = this.ids !== null;
    const ok = await this.refresh();
    if (!hadBaseline || this.ids === null || (!ok && this.vanished === 0)) return null;
    const result = { included: this.vanished, remaining: this.ids.size };
    this.vanished = 0;
    return result;
  }

  private async fetch(): Promise<boolean> {
    let next: Set<string>;
    try {
      next = new Set(await this.opts.fetchTxIds());
    } catch (err) {
      log.debug({ err: err instanceof Error ? err.message : String(err) }, "mempool ids failed");
      return false;
    }
    if (this.ids) {
      for (const id of this.ids) if (!next.has(id)) this.vanished++;
    }
    this.ids = next;
    return true;
  }
}

/** Fetch mempool tx ids straight from coinset (chia-wallet-sdk's RpcClient lacks this call). */
export function coinsetMempoolTxIds(
  baseUrl = "https://api.coinset.org",
  fetchImpl: typeof fetch = fetch
): () => Promise<string[]> {
  return async () => {
    const res = await fetchImpl(`${baseUrl}/get_all_mempool_tx_ids`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`get_all_mempool_tx_ids: HTTP ${res.status}`);
    const body = (await res.json()) as { success?: boolean; tx_ids?: unknown; error?: string };
    if (!body.success || !Array.isArray(body.tx_ids)) {
      throw new Error(`get_all_mempool_tx_ids: ${body.error ?? "bad response"}`);
    }
    return body.tx_ids.filter((id): id is string => typeof id === "string");
  };
}
