import type { BlockEvent, GroveEvent, SproutEvent } from "@grove/shared";

export type DetailStatus = "loading" | "loaded" | "empty" | "error";

export interface DetailState {
  status: DetailStatus;
  height: number;
  rows: SproutEvent[];
  spendCount: number;
  fees: string;
}

export type BlockFetcher = (height: number) => Promise<{ events: GroveEvent[] }>;

/**
 * Fetches and tracks a single historical block's spends for the board's
 * detail view. Guards against out-of-order responses: if `load` is called
 * again before an in-flight fetch resolves, the stale response is dropped.
 */
export class BlockDetail {
  private height = -1;
  private requestId = 0;

  constructor(
    private readonly fetchBlock: BlockFetcher,
    private readonly onChange: (state: DetailState) => void
  ) {}

  get currentHeight(): number {
    return this.height;
  }

  async load(height: number): Promise<void> {
    this.height = height;
    const id = ++this.requestId;
    this.onChange({ status: "loading", height, rows: [], spendCount: 0, fees: "0" });

    let payload: { events: GroveEvent[] };
    try {
      payload = await this.fetchBlock(height);
    } catch {
      if (id !== this.requestId) return; // superseded by a newer nav
      this.onChange({ status: "error", height, rows: [], spendCount: 0, fees: "0" });
      return;
    }
    if (id !== this.requestId) return; // superseded by a newer nav

    const block = payload.events.find((e): e is BlockEvent => e.type === "block");
    const rows = payload.events.filter((e): e is SproutEvent => e.type === "sprout");
    this.onChange({
      status: rows.length === 0 ? "empty" : "loaded",
      height,
      rows,
      spendCount: block?.spendCount ?? 0,
      fees: block?.fees ?? "0",
    });
  }
}
