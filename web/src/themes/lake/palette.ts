/** Scene colors for the lake. Cool, desaturated, with warm light from above. */
export const LAKE = {
  deep: 0x0a2436, // fog and the unlit far water — dark teal, not flat black
  surface: 0x2f86ad, // underside of the surface plane
  shaft: 0xa8e0f5, // god rays
  bed: 0x2b3a2a, // silty floor
  weed: 0x2f6b3f,
  xchFish: 0xd8e9a8, // pale green-gold — reads against blue at any depth
  jelly: 0xc9a6e8,
  turtle: 0x7a9a5d,
  bubble: 0xbfe8ff,
  predator: 0x0a1c26,
  rim: 0x7fd4e8, // rim rings marking each block's band
  rimWarm: 0xe8c07f, // fee-heavy blocks shade the ring warm
  pending: 0x1c4a63, // mempool silhouettes: barely above the fog
} as const;
