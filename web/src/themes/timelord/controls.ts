import { createOrbitControl } from "../shared/orbit.js";
import { isFormFieldTarget } from "../../ui/shortcuts.js";

/**
 * Pure time-travel state — no DOM, unit-testable. The camera either rides the
 * live head (`pinned === null`) or is pinned to an absolute block sequence
 * number, so the view holds still on a historic block while new ones arrive.
 */
export class TimeTravel {
  /** absolute seq the view is pinned to, or null when following the head */
  pinned: number | null = null;

  /** Scroll by `blocks` (positive = back in time), clamped to [oldest, head]. */
  scroll(blocks: number, head: number, oldest: number): void {
    const from = this.pinned ?? head;
    const to = Math.max(oldest, Math.min(head, from - blocks));
    this.pinned = to >= head - 0.25 ? null : to;
  }

  /** Jump to a block; landing on the head returns to live. */
  jump(seq: number, head: number): void {
    this.pinned = seq >= head ? null : seq;
  }

  live(): void {
    this.pinned = null;
  }

  /** Target seq for the camera this frame, always within [oldest, head]. */
  target(head: number, oldest: number): number {
    if (this.pinned === null) return head;
    // history recycled out from under a pin → slide to the oldest surviving block;
    // a reorg that rewound the head below the pin → settle on the new head
    return Math.min(head, Math.max(this.pinned, oldest));
  }
}

interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  target: EventTarget | null;
}

export type TimeKey = { type: "live" } | { type: "scroll"; blocks: number };

/**
 * Map a keydown to a time-travel action: Esc/End return live, ↑/↓ step one
 * block, PgUp/PgDn ten. Ignored with Ctrl/Cmd/Alt held (browser and OS
 * shortcuts) and inside form fields (the scene selector's arrows). Escape is
 * left to the shared detail card while one is open — the first press closes
 * the card, the next returns live. Pure.
 */
export function timeKeyFor(e: KeyLike, cardOpen: boolean): TimeKey | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (isFormFieldTarget(e.target)) return null;
  switch (e.key) {
    case "Escape":
      return cardOpen ? null : { type: "live" };
    case "End":
      return { type: "live" };
    case "ArrowDown":
      return { type: "scroll", blocks: 1 };
    case "PageDown":
      return { type: "scroll", blocks: 10 };
    case "ArrowUp":
      return { type: "scroll", blocks: -1 };
    case "PageUp":
      return { type: "scroll", blocks: -10 };
    default:
      return null;
  }
}

export interface CameraControl {
  /** accumulated horizontal orbit offset (radians) */
  getOrbit(): number;
  isDragging(): boolean;
}

/**
 * Pointer + wheel input on the shared orbit control: horizontal drag orbits
 * the helix, vertical drag and the wheel travel through time. A drag past the
 * threshold swallows the click the browser fires on release, so dragging
 * never selects a coin.
 */
export function createCameraControl(
  canvas: HTMLCanvasElement,
  onScroll: (blocks: number) => void,
  onLive: () => void
): CameraControl {
  let scrollCarry = 0;
  const orbit = createOrbitControl(canvas, {
    sensitivity: 1.25,
    dragThreshold: 5,
    // grab-and-lift: dragging up raises the helix, bringing older blocks into view
    onDragY: (dy) => onScroll((-dy / innerHeight) * 28),
    onWheel: (e) => {
      e.preventDefault();
      const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      scrollCarry += px / 120; // one block per wheel notch
      const whole = Math.trunc(scrollCarry);
      if (whole !== 0) {
        scrollCarry -= whole;
        onScroll(whole);
      }
    },
  });
  canvas.addEventListener("dblclick", onLive);
  addEventListener("keydown", (e) => {
    if (e.defaultPrevented) return;
    const cardOpen = document.getElementById("card")?.classList.contains("visible") ?? false;
    const action = timeKeyFor(e, cardOpen);
    if (!action) return;
    if (action.type === "live") onLive();
    else onScroll(action.blocks);
    e.preventDefault();
  });

  return { getOrbit: () => orbit.getOffset(), isDragging: () => orbit.isDragging() };
}
