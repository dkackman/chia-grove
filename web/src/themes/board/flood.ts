/**
 * Tells the connect-snapshot replay apart from a big live block. The feed
 * drains up to 120 events per frame on its own rAF, so a single 400-spend live
 * block lands as a short burst of heavy frames — that should riffle. The 10k
 * snapshot backlog, by contrast, keeps every frame heavy for over a second; only
 * that sustained flood should snap the board instead of churning forever.
 *
 * `observe(n)` takes one frame's sprout count and reports whether at least
 * `minHeavy` of the last `window` frames each carried ≥ `perFrame` sprouts.
 * Tolerates the odd light frame (drain and render rAFs interleaving). Pure
 * aside from its own history.
 */
export class FloodDetector {
  private readonly heavy: Uint8Array;
  private head = 0;
  private count = 0;

  constructor(
    readonly perFrame = 48,
    readonly window = 12,
    readonly minHeavy = 10
  ) {
    this.heavy = new Uint8Array(window);
  }

  observe(sprouts: number): boolean {
    const isHeavy = sprouts >= this.perFrame ? 1 : 0;
    this.count += isHeavy - this.heavy[this.head];
    this.heavy[this.head] = isHeavy;
    this.head = (this.head + 1) % this.window;
    return this.count >= this.minHeavy;
  }
}
