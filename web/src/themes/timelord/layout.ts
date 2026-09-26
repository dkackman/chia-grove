/**
 * Pure geometry for the timelord helix — no Three.js, fully unit-testable.
 *
 * The chain is a helix of verifiable time: block `seq` (a local, monotonically
 * increasing sequence number, not the chain height) sits at a fixed angular
 * step around the axis and a fixed rise above its predecessor. Everything else
 * — the braided VDF thread, the crystal, its orbiting spends, NFT cards —
 * hangs off that one position.
 */

export const HELIX_RADIUS = 13;
/** Blocks per full turn of the helix. */
export const BLOCKS_PER_TURN = 20;
export const STEP_ANGLE = (Math.PI * 2) / BLOCKS_PER_TURN;
/** Vertical rise per block. */
export const PITCH = 1.7;
/** Block slots kept alive; older blocks (and their spends) are recycled. */
export const MAX_BLOCKS = 240;
/** Spends rendered per block — airdrop bursts beyond this are not drawn. */
export const PER_BLOCK_BUDGET = 320;

export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const TAU = Math.PI * 2;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Helix angle for a block, reduced into [0, 2π) so shaders never see huge angles. */
export function helixAngle(seq: number): number {
  const a = (seq * STEP_ANGLE) % TAU;
  return a < 0 ? a + TAU : a;
}

/** World position of block `seq` on the helix. */
export function blockPosition(seq: number): Vec3 {
  const a = helixAngle(seq);
  return { x: Math.cos(a) * HELIX_RADIUS, y: seq * PITCH, z: Math.sin(a) * HELIX_RADIUS };
}

/**
 * A spend's orbit around its block crystal. Index `j` is the spend's order
 * within the block; radii grow with sqrt(j) and phases step by the golden
 * angle, so a block's spends fill a sunflower disc. Speeds are Keplerian
 * (ω ∝ r^-1.5): inner coins race, outer ones drift.
 */
export interface Orbit {
  radius: number;
  phase: number;
  speed: number;
  /** orbital-plane inclination (radians) */
  incl: number;
  /** longitude of the ascending node (radians) */
  node: number;
  /** vertical scatter about the orbital plane */
  yOff: number;
  /** self-rotation rate (radians/second) */
  spin: number;
}

export function orbitFor(j: number, rand: () => number): Orbit {
  const radius = 1.05 + 0.17 * Math.sqrt(j) + rand() * 0.12;
  return {
    radius,
    phase: j * GOLDEN_ANGLE + rand() * 0.3,
    speed: 0.85 / radius ** 1.5,
    incl: (rand() - 0.5) * 0.55,
    node: rand() * TAU,
    yOff: (rand() - 0.5) * 0.3,
    spin: 0.6 + rand() * 1.6,
  };
}

/**
 * CPU mirror of the orbit vertex shader: a spend's centre at time `t` given
 * its block centre, orbit and how far its eruption/implosion has progressed
 * (`reach` 0 = at the crystal, 1 = on its orbit). Used for raycast picking so
 * a hovered coin is exactly where it is drawn.
 */
export function orbitPoint(center: Vec3, o: Orbit, t: number, reach: number): Vec3 {
  const a = o.phase + t * o.speed;
  const r = o.radius * reach;
  // point in the orbital plane
  const px = Math.cos(a) * r;
  const py = o.yOff * reach;
  const pz = Math.sin(a) * r;
  // tilt about X by the inclination
  const ci = Math.cos(o.incl);
  const si = Math.sin(o.incl);
  const ty = py * ci - pz * si;
  const tz = py * si + pz * ci;
  // swing the tilted plane about Y to its ascending node
  const cn = Math.cos(o.node);
  const sn = Math.sin(o.node);
  return {
    x: center.x + px * cn - tz * sn,
    y: center.y + ty,
    z: center.z + px * sn + tz * cn,
  };
}

/** Log-scaled coin diameter for an XCH amount (mojos, 1 XCH = 1e12). */
export function coinSize(amount: string): number {
  const mojos = Number(amount);
  if (!Number.isFinite(mojos) || mojos <= 0) return 0.18;
  return Math.min(0.8, 0.18 + 0.085 * Math.log10(1 + mojos / 1e7));
}

/**
 * XCH coin metal: dust is pale silver-mint, ~1 XCH is Chia green, 100+ XCH is
 * gold. Returned as linear-ish [r, g, b] in 0..1.
 */
export function coinColor(amount: string): [number, number, number] {
  const mojos = Number(amount);
  const xch = Number.isFinite(mojos) && mojos > 0 ? mojos / 1e12 : 0;
  // −6 (a micro-XCH) … 0 (1 XCH) … 2 (100 XCH)
  const l = Math.log10(Math.max(xch, 1e-6));
  const silver: [number, number, number] = [0.72, 0.82, 0.78];
  const green: [number, number, number] = [0.23, 0.78, 0.4];
  const gold: [number, number, number] = [1.0, 0.74, 0.26];
  if (l <= 0) return mix(silver, green, clamp01((l + 6) / 6));
  return mix(green, gold, clamp01(l / 2));
}

/** Crystal scale from a block's spend count. */
export function crystalScale(spendCount: number): number {
  return Math.min(1.35, 0.42 + 0.3 * Math.log10(1 + Math.max(0, spendCount)));
}

/**
 * Fee heat for a block's crystal: 0 = feeless (cool teal), 1 = heavy fees
 * (amber). log-scaled over 1e6 .. 1e11 mojos.
 */
export function feeHeat(fees: string): number {
  const mojos = Number(fees);
  if (!Number.isFinite(mojos) || mojos <= 0) return 0;
  return clamp01((Math.log10(mojos) - 6) / 5);
}

/** Mempool swirl particle count from mempool size (sqrt so a flood doesn't saturate). */
export function mempoolParticles(size: number, cap: number): number {
  if (!Number.isFinite(size) || size <= 0) return 40;
  return Math.min(cap, Math.round(40 + 26 * Math.sqrt(size)));
}

/**
 * How many swirling motes a block's mempool inclusion pulls into its slot: the
 * included share of the mempool, applied to the swirl (which is sqrt-scaled,
 * so raw counts would be meaningless), with a small floor so a light block
 * still visibly takes something.
 */
export function includedMotes(included: number, remaining: number, swirling: number): number {
  if (!(included > 0) || !(swirling > 0)) return 0;
  const share = included / (included + Math.max(0, remaining));
  return Math.min(swirling, Math.max(Math.min(included, 8), Math.round(share * swirling)));
}

/** Star visibility fraction from netspace (bytes): 40 EiB and above shows the full sky. */
export function starFraction(netspace: string): number {
  const bytes = Number(netspace);
  if (!Number.isFinite(bytes) || bytes <= 0) return 0.35;
  const eib = bytes / 2 ** 60;
  return Math.max(0.35, Math.min(1, eib / 40));
}

/**
 * Where the k-th NFT card of a block floats: out past the helix along the
 * block's radial direction, fanned sideways and staggered in height so a
 * busy block's cards don't stack on one spot.
 */
export function cardPosition(blockSeq: number, k: number): Vec3 {
  const a = helixAngle(blockSeq) + (((k % 5) - 2) * 0.085 + Math.floor(k / 5) * 0.04);
  const dist = HELIX_RADIUS + 5.2 + Math.floor(k / 5) * 1.9 + (k % 2) * 0.6;
  return {
    x: Math.cos(a) * dist,
    y: blockSeq * PITCH + 1.1 + ((k % 3) - 1) * 0.9,
    z: Math.sin(a) * dist,
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function mix(
  a: [number, number, number],
  b: [number, number, number],
  t: number
): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export const ERUPT_SECONDS = 1.4;
export const IMPLODE_SECONDS = 0.9;

/**
 * How far a spend has travelled from its crystal to its orbit: eases out to 1
 * after birth, and collapses back to 0 once it starts dying (`dieAt` > 0).
 * Mirrors the vertex shader exactly.
 */
export function reachAt(t: number, born: number, dieAt: number): number {
  const p = clamp01((t - born) / ERUPT_SECONDS);
  let reach = 1 - (1 - p) ** 3;
  if (dieAt > 0) {
    const k = clamp01((t - dieAt) / IMPLODE_SECONDS);
    reach *= 1 - k * k;
  }
  return reach;
}

/** Visible scale factor (0..~1.1): overshooting pop-in, shrink while dying. Mirrors the shader. */
export function scaleAt(t: number, born: number, dieAt: number): number {
  const p = clamp01((t - born) / (ERUPT_SECONDS * 0.7));
  const c1 = 1.70158;
  const c3 = c1 + 1;
  let s = p <= 0 ? 0 : 1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2;
  if (dieAt > 0) s *= 1 - clamp01((t - dieAt) / IMPLODE_SECONDS);
  return s;
}
