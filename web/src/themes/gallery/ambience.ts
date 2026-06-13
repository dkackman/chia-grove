import { safeBigInt } from "../shared/util.js";

/**
 * Netspace (bytes, string) → gallery light intensity multiplier. Mirrors the
 * EiB mapping in grove/sky.ts so the room brightens as the network grows.
 * Clamped to [0.6, 1.15] so the gallery is never pitch-black or blown out.
 */
export function netspaceLight(bytes: string): number {
  const eib = Number(safeBigInt(bytes) >> 50n) / 1024;
  return Math.min(1.15, Math.max(0.6, 0.6 + (eib - 10) * 0.015));
}
