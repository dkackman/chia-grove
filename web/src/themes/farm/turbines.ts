import { mulberry32 } from "../shared/util.js";

/** Fixed seed — the wind farm must be identical on every reload and every replay. */
const SEED = 0x77696e64;

export const WIND_FARM = {
  clusters: 4,
  minPerCluster: 2,
  maxPerCluster: 4,
  /** Cluster centres land between these two z values. */
  farZ: -124,
  nearZ: -88,
  /** After scatter, no turbine may come nearer than this or stand further out than this. */
  zLimit: -85,
  zFloor: -128,
  /** The turf is a CircleGeometry(140); past this radius a turbine floats over open sky. */
  maxRadius: 132,
  minHeight: 34,
  maxHeight: 50,
  /** The height the geometry is modelled at; each turbine scales off this. */
  baseHeight: 42,
} as const;

export interface TurbineSpec {
  x: number;
  z: number;
  /** Tower height in world units; also the uniform scale factor, via baseHeight. */
  height: number;
  /** Rotor facing: the wind blows +x, so the rotors face across it, with a little jitter. */
  yaw: number;
  /** Idle spin rate, rad/s. */
  rate: number;
  /** Starting blade angle, so no two rotors are in step. */
  phase: number;
}

/** Half-width of the turf disc at a given z — how far out in x a turbine can stand there. */
function maxX(z: number): number {
  return Math.sqrt(Math.max(0, WIND_FARM.maxRadius ** 2 - z * z));
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * Turbines in a handful of loose groups along the far horizon. Seeded, so the
 * wind farm is the same every time — a snapshot replay must not reshuffle it.
 *
 * The turf disc narrows as it recedes, so the further back a cluster sits the
 * less room it has to spread in x; maxX() keeps every turbine on the ground.
 */
export function turbineLayout(): TurbineSpec[] {
  const rand = mulberry32(SEED);
  const turbines: TurbineSpec[] = [];

  for (let c = 0; c < WIND_FARM.clusters; c++) {
    const cz = WIND_FARM.farZ + rand() * (WIND_FARM.nearZ - WIND_FARM.farZ);
    // hold the centre well inside the disc edge so the cluster has room to scatter
    const cx = (rand() * 2 - 1) * maxX(cz) * 0.7;
    const span = WIND_FARM.maxPerCluster - WIND_FARM.minPerCluster + 1;
    const count = WIND_FARM.minPerCluster + Math.floor(rand() * span);

    for (let i = 0; i < count; i++) {
      const z = clamp(cz + (rand() - 0.5) * 32, WIND_FARM.zFloor, WIND_FARM.zLimit);
      const x = clamp(cx + (rand() - 0.5) * 44, -maxX(z), maxX(z));
      turbines.push({
        x,
        z,
        height: WIND_FARM.minHeight + rand() * (WIND_FARM.maxHeight - WIND_FARM.minHeight),
        yaw: (rand() - 0.5) * 0.35, // ±10°, so they don't look stamped from a template
        rate: 0.35 + rand() * 0.25,
        phase: rand() * Math.PI * 2,
      });
    }
  }
  return turbines;
}

/**
 * The gust envelope, in time-constants since the wind reached a turbine: nothing
 * before it arrives, a smooth peak of 1 one constant later, then a long fall-off.
 * Guarded at both ends so a turbine that has never been gusted reads 0, not NaN.
 */
export function gustPulse(u: number): number {
  if (!(u > 0) || u > 12) return 0;
  return u * Math.exp(1 - u);
}
