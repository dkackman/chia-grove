import { mulberry32, type XZ } from "../themes/shared/util.js";

export type { XZ };

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ≈ 2.39996 rad
const CLEARING_RADIUS = 6;
const SPREAD = 2.2;
const CLUSTER_RADIUS = 1.8;

/** Phyllotaxis: block index → spiral position (sunflower-seed packing). */
export function blockPosition(index: number): XZ {
  const angle = index * GOLDEN_ANGLE;
  const radius = CLEARING_RADIUS + SPREAD * Math.sqrt(index);
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}

/** Scatter offset within a block's cluster, derived from the coin id. */
export function sproutOffset(coinIdHex: string): XZ {
  const rand = mulberry32(parseInt(coinIdHex.slice(0, 8), 16));
  const angle = rand() * Math.PI * 2;
  const radius = Math.sqrt(rand()) * CLUSTER_RADIUS;
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}
