import { WOOL_DYES, FIXED_COLORS, type HSL } from "./palette.js";

export type CatFamily = "opaque" | "transparent" | "emissive";

export interface CatBlock {
  family: CatFamily;
  material: string;
  dyed: boolean;
  dyeIndex?: number; // present only when dyed
  color: HSL;
}

// Family weights (cumulative thresholds over a 0..1 hash). Opaque common,
// emissive rarest — the "ooh, a glowing one" feel.
const OPAQUE_MAX = 0.66;
const TRANSPARENT_MAX = 0.88; // remainder (0.12) is emissive

const OPAQUE_MATERIALS = ["wool", "concrete", "terracotta"]; // all dyed
const TRANSPARENT_FIXED = ["glass", "ice", "blue_ice", "honey"];
const EMISSIVE_MATERIALS = ["glowstone", "sea_lantern", "shroomlight", "froglight", "redstone_lamp", "magma"];

/** Independent 0..1 hash from a disjoint slice of the asset id.
 *  Applies a multiplicative scramble so that even low-entropy slices
 *  (e.g. leading zeros) distribute uniformly across the output range.
 */
function hashUnit(hex: string, start: number): number {
  const slice = (hex + "0".repeat(16)).slice(start, start + 8);
  // Knuth multiplicative hash — maps any uint32 uniformly to uint32
  const raw = (parseInt(slice, 16) * 2654435761) >>> 0;
  return raw / 0x100000000;
}

function pick<T>(arr: readonly T[], u: number): T {
  return arr[Math.min(arr.length - 1, Math.floor(u * arr.length))];
}

export function resolveCatBlock(assetIdHex: string): CatBlock {
  const familyU = hashUnit(assetIdHex, 0);
  const materialU = hashUnit(assetIdHex, 8);
  const dyeU = hashUnit(assetIdHex, 16);

  if (familyU < OPAQUE_MAX) {
    const material = pick(OPAQUE_MATERIALS, materialU);
    const dyeIndex = Math.min(15, Math.floor(dyeU * 16));
    return { family: "opaque", material, dyed: true, dyeIndex, color: WOOL_DYES[dyeIndex] };
  }
  if (familyU < TRANSPARENT_MAX) {
    // split transparent into dyed (stained glass) vs fixed-tint
    if (materialU < 0.5) {
      const dyeIndex = Math.min(15, Math.floor(dyeU * 16));
      return { family: "transparent", material: "stained_glass", dyed: true, dyeIndex, color: WOOL_DYES[dyeIndex] };
    }
    const material = pick(TRANSPARENT_FIXED, materialU * 2 - 1);
    return { family: "transparent", material, dyed: false, color: FIXED_COLORS[material] };
  }
  const material = pick(EMISSIVE_MATERIALS, materialU);
  return { family: "emissive", material, dyed: false, color: FIXED_COLORS[material] };
}
