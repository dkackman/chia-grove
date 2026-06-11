/** XCH amount (mojos, string) → grass height. log scale, dust→blade, whale→stalk. */
export function xchHeight(amount: string): number {
  const mojos = Number(amount);
  return Math.min(3.2, 0.4 + 0.55 * Math.log10(1 + mojos / 1e9));
}

/**
 * CAT amount (mojos, string) → mushroom cap width. CATs carry 3 decimals
 * (1 token = 1000 mojos); per-token value varies wildly across assets, so
 * this only conveys relative magnitude within a colony. log scale and
 * sublinear, dust→slim, whale→chunky toadstool.
 */
export function catWidth(amount: string): number {
  const tokens = Number(amount) / 1000;
  return 0.75 + 0.25 * Math.min(2.2, 0.5 + 0.3 * Math.log10(1 + tokens));
}
