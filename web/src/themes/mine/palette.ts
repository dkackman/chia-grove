export interface HSL {
  h: number; // 0..1
  s: number; // 0..1
  l: number; // 0..1
}

/** hex (0xRRGGBB) → HSL in 0..1, for converting Minecraft's authentic palette. */
export function hexToHsl(hex: number): HSL {
  const r = ((hex >> 16) & 0xff) / 255;
  const g = ((hex >> 8) & 0xff) / 255;
  const b = (hex & 0xff) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0,
    s = 0;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return { h, s, l };
}

// The 16 authentic in-game wool/dye RGBs.
const WOOL_HEX = [
  0xe9ecec, 0xf07613, 0xbd44b3, 0x3aafd9, 0xf8c627, 0x70b919, 0xed8dac, 0x3e4447, 0x8e8e86,
  0x158991, 0x792aac, 0x35399d, 0x724728, 0x546d1b, 0xa12722, 0x141519,
] as const;

export const WOOL_DYES: readonly HSL[] = WOOL_HEX.map(hexToHsl);

/** Intrinsic colors for materials that do not take dye. */
export const FIXED_COLORS: Record<string, HSL> = {
  glass: hexToHsl(0xc8e6ef),
  ice: hexToHsl(0xafc8f5),
  blue_ice: hexToHsl(0x74a8f0),
  honey: hexToHsl(0xf0a83c),
  glowstone: hexToHsl(0xf6c969),
  sea_lantern: hexToHsl(0x9fe0d8),
  shroomlight: hexToHsl(0xf08a3c),
  froglight: hexToHsl(0xe6e08a),
  redstone_lamp: hexToHsl(0xf08438),
  magma: hexToHsl(0xb5471f),
};

/** Scene colors (day/night endpoints lerped by the cycle phase). */
export const MINE = {
  grassTop: 0x6aa84f,
  dirt: 0x7a5a3a,
  skyDay: 0x79bdef,
  skyNight: 0x0a1130,
  fogDay: 0xbfe0f2,
  fogNight: 0x13203f,
  sun: 0xfff4c2,
  moon: 0xdfe6f2,
  beacon: 0xbafff0,
  torch: 0xffb347,
} as const;
