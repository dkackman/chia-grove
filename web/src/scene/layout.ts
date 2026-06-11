const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ≈ 2.39996 rad
const CLEARING_RADIUS = 6;
const SPREAD = 2.2;
const CLUSTER_RADIUS = 1.8;

export interface XZ {
  x: number;
  z: number;
}

/** Phyllotaxis: block index → spiral position (sunflower-seed packing). */
export function blockPosition(index: number): XZ {
  const angle = index * GOLDEN_ANGLE;
  const radius = CLEARING_RADIUS + SPREAD * Math.sqrt(index);
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}

/** Deterministic PRNG (mulberry32) so plant scatter is stable per coin. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Scatter offset within a block's cluster, derived from the coin id. */
export function sproutOffset(coinIdHex: string): XZ {
  const rand = mulberry32(parseInt(coinIdHex.slice(0, 8), 16));
  const angle = rand() * Math.PI * 2;
  const radius = Math.sqrt(rand()) * CLUSTER_RADIUS;
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}
