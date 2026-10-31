/**
 * Pure offset state — no DOM, fully testable.
 * Caller converts pixels → radians and passes the result to `accumulate`.
 * The offset persists after a drag; the scene's auto-drift continues from the
 * released angle rather than snapping back.
 */
export class OrbitState {
  offset = 0;

  accumulate(deltaRadians: number): void {
    this.offset += deltaRadians;
  }
}

export interface OrbitControl {
  getOffset(): number;
  isDragging(): boolean;
  dispose(): void;
}

export interface OrbitControlOptions {
  sensitivity?: number;
  dragThreshold?: number;
  /**
   * Vertical drag, in CSS pixels per pointermove (positive = pointer moved
   * down). When given, a drag also starts on vertical movement past the
   * threshold, not just horizontal.
   */
  onDragY?: (dyPixels: number) => void;
  /** Wheel over the canvas (registered non-passive; the handler may preventDefault). */
  onWheel?: (e: WheelEvent) => void;
}

export function createOrbitControl(
  canvas: HTMLCanvasElement,
  opts: OrbitControlOptions = {}
): OrbitControl {
  const { sensitivity = 2.0, dragThreshold = 4, onDragY, onWheel } = opts;
  const state = new OrbitState();
  let dragging = false;
  let suppressNextClick = false;
  let downX = 0;
  let downY = 0;
  let lastX = 0;
  let lastY = 0;

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    suppressNextClick = false;
    downX = lastX = e.clientX;
    downY = lastY = e.clientY;
    dragging = false;
    canvas.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: PointerEvent): void {
    if (!(e.buttons & 1)) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    const moved = onDragY
      ? Math.hypot(e.clientX - downX, e.clientY - downY)
      : Math.abs(e.clientX - downX);
    if (!dragging && moved > dragThreshold) dragging = true;
    if (dragging) {
      state.accumulate((dx / innerWidth) * Math.PI * 2 * sensitivity);
      onDragY?.(dy);
      canvas.style.cursor = "grabbing";
    }
  }

  function onPointerUp(e: PointerEvent): void {
    canvas.releasePointerCapture?.(e.pointerId);
    if (dragging) {
      dragging = false;
      suppressNextClick = true;
      canvas.style.cursor = "";
    }
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  if (onWheel) canvas.addEventListener("wheel", onWheel, { passive: false });

  return {
    getOffset: () => state.offset,
    // Also consumes the one-shot click suppression armed on drag release, so the
    // picker's click handler ignores the click the browser fires after a drag.
    isDragging: () => {
      if (suppressNextClick) {
        suppressNextClick = false;
        return true;
      }
      return dragging;
    },
    dispose: () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      if (onWheel) canvas.removeEventListener("wheel", onWheel);
    },
  };
}
