/** Mojo string → XCH decimal string (1 XCH = 1e12 mojos). */
export function mojosToXch(mojos: string): string {
  const padded = mojos.padStart(13, "0");
  const whole = padded.slice(0, -12).replace(/^0+(?=\d)/, "");
  const frac = padded.slice(-12).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

export function shortHex(hex: string): string {
  return `${hex.slice(0, 8)}…${hex.slice(-6)}`;
}
