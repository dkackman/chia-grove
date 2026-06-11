/**
 * Bioluminescent hues (degrees) for CAT mushrooms.
 * Avoids grass green (120–165°) and NFT amber (30–65°).
 * Ordered to spread around the color wheel for visual colony variety.
 */
const CAT_HUES = [182, 199, 218, 242, 264, 286, 308, 328, 348, 10, 66, 162] as const;

/** Deterministic, palette-matched HSL color for a CAT asset id. */
export function catColor(assetIdHex: string): { h: number; s: number; l: number } {
  const idx = parseInt(assetIdHex.slice(0, 8), 16) % CAT_HUES.length;
  return { h: CAT_HUES[idx] / 360, s: 0.72, l: 0.52 };
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
