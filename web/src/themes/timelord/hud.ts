/**
 * A small time-travel readout pinned to the bottom of the screen: LIVE while
 * riding the head, or how far back the view is with a button to return.
 */
export class Hud {
  private readonly root: HTMLDivElement;
  private readonly label: HTMLSpanElement;
  private readonly back: HTMLButtonElement;
  private readonly hint: HTMLSpanElement;
  private lastText = "";

  constructor(onLive: () => void) {
    this.root = document.createElement("div");
    this.root.id = "timelord-hud";
    this.label = document.createElement("span");
    this.back = document.createElement("button");
    this.back.type = "button";
    this.back.textContent = "return to live ⤒";
    this.back.addEventListener("click", onLive);
    this.hint = document.createElement("span");
    this.hint.className = "hint";
    this.hint.textContent = "scroll or drag ↕ to travel through time";
    this.root.append(this.label, this.back, this.hint);
    document.body.appendChild(this.root);
  }

  update(live: boolean, height: number | null, behind: number, traveled: boolean): void {
    const text = live
      ? `● LIVE${height !== null ? ` · block ${height.toLocaleString()}` : ""}`
      : `◀ HISTORY · block ${height?.toLocaleString() ?? "—"} · ${behind} behind`;
    if (text !== this.lastText) {
      this.label.textContent = text;
      this.lastText = text;
    }
    this.root.classList.toggle("history", !live);
    this.back.hidden = live;
    // the hint retires once someone has actually travelled
    this.hint.hidden = traveled || !live;
  }
}
