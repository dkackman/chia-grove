export const GALLERY = {
  // wall plaster albedo: a deep muted slate the picture-lights warm up where
  // they land. The wall shader multiplies it by the (dim) room ambient; the
  // per-piece light pools multiply it by the warm lamp light.
  wallAlbedo: 0x5d6468,
  skirting: 0x15171b, // painted baseboard along the floor
  floor: 0x0b0c10, // unused by the plank shader directly; kept as the floor's fallback base
  floorPlank: 0x241c17, // dark smoked oak
  floorMirror: 0x2a2d35, // dark tint scaling the floor reflection → subtle wet-sheen, not a bright mirror
  backdrop: 0x05060a,
  frame: 0x26282f,
  spot: 0xffe9c2, // warm picture-light
  fill: 0x2a3650, // cool ambient fill
  brass: 0x9a7a44, // picture-lamp hoods
  matIvory: 0xd9d2c1, // passe-partout
  matCharcoal: 0x1d1e21, // dark liner for pieces hung without a pale mat
};

/** Frame moulding finishes, picked deterministically per piece. */
export const FRAME_FINISHES = [
  { color: 0x141416, roughness: 0.32, metalness: 0.1, weight: 4 }, // black lacquer
  { color: 0x3b271a, roughness: 0.5, metalness: 0.05, weight: 3 }, // dark walnut
  // no environment map in this room, so metals stay only faintly metallic —
  // enough for a sheen on the bevels without going flat and muddy
  { color: 0x7a5a26, roughness: 0.4, metalness: 0.3, weight: 2 }, // aged gilt
  { color: 0x44464b, roughness: 0.45, metalness: 0.3, weight: 1 }, // oxidised silver
] as const;
