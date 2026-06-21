// web/src/themes/board/clatter.ts
const KEY = "grove.board.clatter";

/** Pooled split-flap clack. Default muted; respects autoplay (lazy on enable). */
export class Clatter {
  private ctx: AudioContext | null = null;
  private on = localStorage.getItem(KEY) === "1";
  private last = 0;

  get enabled(): boolean {
    return this.on;
  }

  setEnabled(on: boolean): void {
    this.on = on;
    localStorage.setItem(KEY, on ? "1" : "0");
    if (on && !this.ctx) {
      try {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        this.ctx = Ctor ? new Ctor() : null;
      } catch {
        this.ctx = null;
      }
    }
  }

  /** A short filtered-noise burst; `intensity` (0..1) scales gain. Throttled. */
  flap(intensity: number): void {
    if (!this.on || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.last < 0.03) return; // cap density during a riffle storm
    this.last = now;
    try {
      const len = 0.025;
      const buf = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * len), this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const gain = this.ctx.createGain();
      gain.gain.value = 0.04 + 0.06 * Math.min(1, intensity);
      const hp = this.ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 1200;
      src.connect(hp).connect(gain).connect(this.ctx.destination);
      src.start();
    } catch {
      /* degrade to silent */
    }
  }
}
