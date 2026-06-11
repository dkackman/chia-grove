/** Deterministic hue (degrees) for a CAT asset id, so colonies share color. */
export function catHue(assetIdHex: string): number {
  return parseInt(assetIdHex.slice(0, 8), 16) % 360;
}

export const COLORS = {
  background: 0x020806,
  fog: 0x04110a,
  ground: 0x07150c,
  grass: 0x2fae66,
  grassEmissive: 0x0c3a1f,
  bloom: 0xfff2c9,
  bloomEmissive: 0xffd166,
  wisp: 0x9b5cff,
  firefly: 0xeaffbf,
  ripple: 0x3ddc84,
  moon: 0xcfe0ff,
} as const;
