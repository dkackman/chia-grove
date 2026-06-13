import type { GroveEvent } from "@grove/shared";
import { mojosToXch } from "./format.js";

const MAX_LINES = 6;
const COLLAPSED_KEY = "grove.console.collapsed";

export interface BlockAgg {
  height: number;
  spendCount: number;
  cat: number;
  nft: number;
  did: number;
  fees: string; // mojos
}

export function formatBlockLine(agg: BlockAgg): string {
  const parts = [
    `#${agg.height}`,
    `${agg.spendCount} ${agg.spendCount === 1 ? "spend" : "spends"}`,
  ];
  for (const kind of ["cat", "nft", "did"] as const) {
    if (agg[kind] > 0) parts.push(`${agg[kind]} ${kind}`);
  }
  if (agg.fees !== "0") parts.push(`${mojosToXch(agg.fees)} XCH fees`);
  return parts.join(" · ");
}

/**
 * Scrolling block log: one line per block, newest on top. Sprout events
 * arriving after their block tick the asset counts up live. The log can be
 * collapsed (toggle persisted to localStorage; defaults collapsed on phones).
 */
export class BlockConsole {
  private readonly aggs = new Map<number, { agg: BlockAgg; line: HTMLElement }>();
  private readonly toggle: HTMLButtonElement;
  private readonly body: HTMLElement;
  private collapsed: boolean;

  constructor(private readonly root: HTMLElement) {
    this.toggle = document.createElement("button");
    this.toggle.id = "console-toggle";
    this.toggle.type = "button";

    this.body = document.createElement("div");
    this.body.id = "console-body";

    const stored = localStorage.getItem(COLLAPSED_KEY);
    this.collapsed =
      stored === null ? matchMedia("(max-width: 640px)").matches : stored === "1";

    this.toggle.addEventListener("click", () => {
      this.collapsed = !this.collapsed;
      localStorage.setItem(COLLAPSED_KEY, this.collapsed ? "1" : "0");
      this.render();
    });

    root.append(this.toggle, this.body);
    this.render();
  }

  private render(): void {
    this.body.hidden = this.collapsed;
    this.toggle.textContent = this.collapsed ? "▤" : "log ✕";
  }

  handle(event: GroveEvent): void {
    switch (event.type) {
      case "block": {
        const agg: BlockAgg = {
          height: event.height,
          spendCount: event.spendCount,
          cat: 0,
          nft: 0,
          did: 0,
          fees: event.fees,
        };
        const line = this.prependLine(formatBlockLine(agg));
        this.aggs.set(event.height, { agg, line });
        break;
      }
      case "sprout": {
        if (event.kind === "xch") return; // counted in spendCount already
        const entry = this.aggs.get(event.height);
        if (!entry) return;
        entry.agg[event.kind] += 1;
        entry.line.textContent = formatBlockLine(entry.agg);
        break;
      }
      case "reorg": {
        const line = this.prependLine(`⟲ reorg → #${event.forkHeight}`);
        line.classList.add("reorg");
        break;
      }
    }
  }

  private prependLine(text: string): HTMLElement {
    const line = document.createElement("div");
    line.textContent = text;
    this.body.prepend(line);
    while (this.body.children.length > MAX_LINES) {
      const last = this.body.lastElementChild!;
      for (const [height, entry] of this.aggs) {
        if (entry.line === last) this.aggs.delete(height);
      }
      last.remove();
    }
    this.root.hidden = false;
    return line;
  }
}
