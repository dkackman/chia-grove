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

  /** Target seq for the camera this frame. */
  target(head: number, oldest: number): number {
    if (this.pinned === null) return head;
    // history recycled out from under a pin → slide to the oldest surviving block
    return Math.max(this.pinned, oldest);
  }
}

export interface CameraControl {
  /** accumulated horizontal orbit offset (radians) */
  getOrbit(): number;
  isDragging(): boolean;
}

/**
 * Pointer + wheel input: horizontal drag orbits the helix, vertical drag and
 * the wheel travel through time. A drag past the threshold swallows the click
 * the browser fires on release, so dragging never selects a coin.
 */
export function createCameraControl(
  canvas: HTMLCanvasElement,
  onScroll: (blocks: number) => void,
  onLive: () => void
): CameraControl {
  let orbit = 0;
  let dragging = false;
  let suppressClick = false;
  let downX = 0;
  let downY = 0;
  let lastX = 0;
  let lastY = 0;
  let scrollCarry = 0;

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    suppressClick = false;
    dragging = false;
    downX = lastX = e.clientX;
    downY = lastY = e.clientY;
    canvas.setPointerCapture?.(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!(e.buttons & 1)) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    if (!dragging && Math.hypot(e.clientX - downX, e.clientY - downY) > 5) dragging = true;
    if (!dragging) return;
    orbit += (dx / innerWidth) * Math.PI * 2.5;
    // grab-and-lift: dragging up raises the helix, bringing older blocks into view
    onScroll((-dy / innerHeight) * 28);
    canvas.style.cursor = "grabbing";
  });
  const end = (e: PointerEvent) => {
    canvas.releasePointerCapture?.(e.pointerId);
    if (dragging) {
      dragging = false;
      suppressClick = true;
      canvas.style.cursor = "";
    }
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      scrollCarry += px / 120; // one block per wheel notch
      const whole = Math.trunc(scrollCarry);
      if (whole !== 0) {
        scrollCarry -= whole;
        onScroll(whole);
      }
    },
    { passive: false }
  );
  canvas.addEventListener("dblclick", onLive);
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" || e.key === "End") onLive();
    else if (e.key === "ArrowDown" || e.key === "PageDown") onScroll(e.key === "PageDown" ? 10 : 1);
    else if (e.key === "ArrowUp" || e.key === "PageUp") onScroll(e.key === "PageUp" ? -10 : -1);
  });

  return {
    getOrbit: () => orbit,
    isDragging: () => {
      if (suppressClick) {
        suppressClick = false;
        return true;
      }
      return dragging;
    },
  };
}
