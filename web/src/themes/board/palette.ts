/** Solari departure-board palette: warm characters on near-black flaps. */
export const BOARD = {
  backdrop: 0x05070a, // room behind the board
  housing: 0x050506, // near-black frame showing through the gaps as recessed slots
  flapFace: 0x3c3c42, // gray flap card (atlas bakes the actual shading in)
  flapText: 0xf2bc1c, // golden-amber characters (the shader's ink color)
  live: 0x3ad17a, // the LIVE indicator
} as const;
