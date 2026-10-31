import { mojosToXch } from "../../ui/format.js";

/** What the HUD shows for a hovered block crystal. */
export interface BlockSummary {
  height: number;
  spendCount: number;
  /** mojos */
  fees: string;
  /** unix seconds */
  timestamp: number;
  /** spends past the per-block draw budgets */
  skipped: number;
}

function ago(seconds: number): string {
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86400)} d ago`;
}

/** One-line summary of a block for the HUD. Pure. */
export function blockSummaryText(b: BlockSummary, nowSeconds: number): string {
  const parts = [
    `block ${b.height.toLocaleString()}`,
    `${b.spendCount.toLocaleString()} spend${b.spendCount === 1 ? "" : "s"}`,
    `${mojosToXch(b.fees)} XCH fees`,
    ago(Math.max(0, nowSeconds - b.timestamp)),
  ];
  if (b.skipped > 0) parts.push(`+${b.skipped.toLocaleString()} not drawn`);
  return parts.join(" · ");
}

// Key-cap glyphs for the legend's sw-key swatches (the shared style draws ←→).
const KEY_STYLE = `
.sw-key.tl-key-live::before { content: "Esc"; }
.sw-key.tl-key-travel::before { content: "↑↓"; }
.sw-key.tl-key-click::before { content: "⊙"; }
#timelord-hud .block-info { opacity: 0.9; }
`;

/**
 * A small time-travel readout pinned to the top of the screen: LIVE while
 * riding the head, or how far back the view is with a button to return; plus
 * a summary of whichever block crystal is hovered.
 */
export class Hud {
  private readonly root: HTMLDivElement;
  private readonly label: HTMLSpanElement;
  private readonly back: HTMLButtonElement;
  private readonly hint: HTMLSpanElement;
  private readonly info: HTMLSpanElement;
  private lastText = "";
  private lastInfo = "";

  constructor(onLive: () => void) {
    if (!document.getElementById("timelord-style")) {
      const style = document.createElement("style");
      style.id = "timelord-style";
      style.textContent = KEY_STYLE;
      document.head.appendChild(style);
    }
    this.root = document.createElement("div");
    this.root.id = "timelord-hud";
    this.label = document.createElement("span");
    this.back = document.createElement("button");
    this.back.type = "button";
    this.back.textContent = "return to live ⤒";
    this.back.addEventListener("click", onLive);
    this.hint = document.createElement("span");
    this.hint.className = "hint";
    this.hint.textContent = "scroll, drag ↕ or ↑↓ / PgUp PgDn to travel through time";
    this.info = document.createElement("span");
    this.info.className = "hint block-info";
    this.info.hidden = true;
    this.root.append(this.label, this.back, this.hint, this.info);
    document.body.appendChild(this.root);
  }

  update(live: boolean, height: number | null, behind: number, traveled: boolean): void {
    const text = live
      ? `● LIVE${height !== null ? ` · block ${height.toLocaleString()}` : ""}`
      : `◀ HISTORY · block ${height?.toLocaleString() ?? "—"} · ${behind} behind · Esc for live`;
    if (text !== this.lastText) {
      this.label.textContent = text;
      this.lastText = text;
    }
    this.root.classList.toggle("history", !live);
    this.back.hidden = live;
    // the hint retires once someone has actually travelled
    this.hint.hidden = traveled || !live || this.lastInfo !== "";
  }

  /** Show (or with null, clear) the hovered block's summary. */
  setBlockInfo(text: string | null): void {
    const next = text ?? "";
    if (next === this.lastInfo) return;
    this.lastInfo = next;
    this.info.textContent = next ? `${next} · click to jump` : "";
    this.info.hidden = !next;
  }
}
