const SETTLED = 0.0001;

/**
 * Pure decay state — no DOM, fully testable.
 * Caller converts pixels → radians and passes the result to `accumulate`.
 */
export class OrbitState {
  offset = 0;
  private _easing = false;

  /** Called each pointermove frame while dragging. */
  accumulate(deltaRadians: number): void {
    this._easing = false;
    this.offset += deltaRadians;
  }

  /** Called on pointerup to start the snap-back. */
  release(): void {
    this._easing = Math.abs(this.offset) > SETTLED;
  }

  /** Call every frame. Decays offset exponentially toward zero. */
  update(dt: number, returnSpeed: number): void {
    if (!this._easing) return;
    this.offset *= Math.pow(Math.E, -returnSpeed * dt);
    if (Math.abs(this.offset) < SETTLED) {
      this.offset = 0;
      this._easing = false;
    }
  }
}

export interface OrbitControl {
  getOffset(): number;
  isDragging(): boolean;
  update(dt: number): void;
  dispose(): void;
}

export function createOrbitControl(
  canvas: HTMLCanvasElement,
  opts: { sensitivity?: number; returnSpeed?: number; dragThreshold?: number } = {}
): OrbitControl {
  const { sensitivity = 2.0, returnSpeed = 2.0, dragThreshold = 4 } = opts;
  const state = new OrbitState();
  let dragging = false;
  let downX = 0;
  let lastX = 0;

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    downX = lastX = e.clientX;
    dragging = false;
    canvas.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: PointerEvent): void {
    if (!(e.buttons & 1)) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    if (!dragging && Math.abs(e.clientX - downX) > dragThreshold) dragging = true;
    if (dragging) {
      state.accumulate((dx / innerWidth) * Math.PI * 2 * sensitivity);
      canvas.style.cursor = "grabbing";
    }
  }

  function onPointerUp(e: PointerEvent): void {
    canvas.releasePointerCapture?.(e.pointerId);
    if (dragging) {
      dragging = false;
      canvas.style.cursor = "";
      state.release();
    }
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);

  return {
    getOffset: () => state.offset,
    isDragging: () => dragging,
    update: (dt) => state.update(dt, returnSpeed),
    dispose: () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
    },
  };
}
