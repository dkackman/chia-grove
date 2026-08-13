const MIN_FISH = 0.45;
const MAX_FISH = 2.6;
const EIB = 1.152921504606847e18;

/**
 * XCH amount (mojos) → fish length. Log scale, so dust is a minnow and a whale
 * spend is literally a whale — the payoff no other theme gives large amounts.
 * Curve reaches MAX_FISH (2.6) at around 1e6 XCH (whale territory), giving
 * large spends true visual impact without letting unbounded amounts fill the screen.
 */
export function fishSize(amount: string): number {
  const mojos = Number(amount);
  if (!Number.isFinite(mojos) || mojos <= 0) return MIN_FISH;
  return Math.min(MAX_FISH, MIN_FISH + 0.24 * Math.log10(1 + mojos / 1e9));
}

/**
 * CAT amount → how many fish swim in this spend's school (1..5). CATs carry 3
 * decimals (1 token = 1000 mojos), and per-token value varies wildly across
 * assets, so this conveys only relative magnitude — same caveat as `catWidth`
 * in `themes/shared/scales.ts`.
 */
export function schoolSize(amount: string): number {
  const tokens = Number(amount) / 1000;
  if (!Number.isFinite(tokens) || tokens <= 0) return 1;
  return Math.min(5, 1 + Math.floor(Math.log10(1 + tokens)));
}

/**
 * Netspace (bytes) → water clarity in 0..1, driving fog density and light-shaft
 * strength. This is the lake's version of the lever grove uses for moonlight and
 * farm for sun brightness. Divisor 1.7 puts today's ~25 EiB netspace near 0.83,
 * so the usual view is clear water and a shrinking chain visibly murks it up.
 */
export function clarityFromNetspace(bytes: string): number {
  const eib = Number(bytes) / EIB;
  if (!Number.isFinite(eib) || eib <= 0) return 0.5;
  return Math.max(0, Math.min(1, Math.log10(1 + eib) / 1.7));
}
