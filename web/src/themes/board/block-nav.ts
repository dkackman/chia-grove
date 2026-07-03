const HEIGHT_RE = /^\d+$/;

/** Parses a find-block text input into a valid, non-negative integer height, or null. Pure. */
export function parseHeightInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!HEIGHT_RE.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) ? n : null;
}

export interface BoardNavCallbacks {
  onFind(height: number): void;
  onPrev(): void;
  onNext(): void;
  onReturnToLive(): void;
}

/**
 * DOM overlay for the board's block navigation: a find-block input (always
 * visible) plus prev/next/return-to-live controls (shown only in detail mode).
 */
export class BoardNav {
  private readonly input: HTMLInputElement;
  private readonly prevBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly liveBtn: HTMLButtonElement;

  constructor(root: HTMLElement, callbacks: BoardNavCallbacks) {
    const form = document.createElement("form");
    form.id = "board-nav-find";

    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.inputMode = "numeric";
    this.input.placeholder = "block height";
    this.input.autocomplete = "off";

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = "go";

    form.append(this.input, submit);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const height = parseHeightInput(this.input.value);
      if (height !== null) callbacks.onFind(height);
    });

    this.prevBtn = document.createElement("button");
    this.prevBtn.type = "button";
    this.prevBtn.textContent = "◀ prev";
    this.prevBtn.addEventListener("click", () => callbacks.onPrev());

    this.nextBtn = document.createElement("button");
    this.nextBtn.type = "button";
    this.nextBtn.textContent = "next ▶";
    this.nextBtn.addEventListener("click", () => callbacks.onNext());

    this.liveBtn = document.createElement("button");
    this.liveBtn.type = "button";
    this.liveBtn.textContent = "return to live";
    this.liveBtn.addEventListener("click", () => callbacks.onReturnToLive());

    const controls = document.createElement("div");
    controls.id = "board-nav-controls";
    controls.append(this.prevBtn, this.nextBtn, this.liveBtn);

    root.append(form, controls);
    this.setMode("live");
  }

  setMode(mode: "live" | "detail"): void {
    this.prevBtn.hidden = mode !== "detail";
    this.nextBtn.hidden = mode !== "detail";
    this.liveBtn.hidden = mode !== "detail";
  }
}
