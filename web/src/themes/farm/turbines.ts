import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { mulberry32 } from "../shared/util.js";
import { FARM } from "./palette.js";

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
  // the camera is pitched down at the field, so only a narrow band of sky sits
  // above the horizon: a turbine much taller than this is cropped by the frame
  minHeight: 12,
  maxHeight: 20,
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

/** How far the hub stands proud of the nacelle, in modelled (baseHeight) units. */
const HUB_Z = 2.4;
const BLADE_LEN = 14;

/** Where the rotor's spin axis points: across the scene's +x wind, plus jitter. */
function rotorYaw(spec: TurbineSpec): number {
  return Math.PI / 2 + spec.yaw;
}

/**
 * Tower and nacelle for one turbine, already placed in world space and ready to
 * merge with the rest. Yawing the pair is safe: the tower is a cylinder, so the
 * rotation only swings the nacelle, which must line up with its rotor.
 */
export function towerGeometry(spec: TurbineSpec): THREE.BufferGeometry {
  const tower = new THREE.CylinderGeometry(0.55, 1.5, WIND_FARM.baseHeight, 10);
  tower.translate(0, WIND_FARM.baseHeight / 2, 0);

  const nacelle = new THREE.BoxGeometry(2, 1.8, 5.4);
  nacelle.translate(0, WIND_FARM.baseHeight, -0.6);

  const geo = mergeGeometries([tower, nacelle]);
  const scale = spec.height / WIND_FARM.baseHeight;
  geo.rotateY(rotorYaw(spec));
  geo.scale(scale, scale, scale);
  geo.translate(spec.x, 0, spec.z);
  return geo;
}

/**
 * One rotor — nose cone plus three blades — modelled about its local z axis, so
 * the caller spins it with rotation.z alone. Every turbine shares this geometry
 * and scales the mesh to its own height.
 */
export function rotorGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  const nose = new THREE.ConeGeometry(0.85, 1.8, 8);
  nose.rotateX(Math.PI / 2); // swing the cone's point from +y round to +z, into the wind
  nose.translate(0, 0, HUB_Z + 0.9);
  parts.push(nose);

  for (let i = 0; i < 3; i++) {
    const blade = new THREE.CylinderGeometry(0.12, 0.5, BLADE_LEN, 4);
    blade.rotateY(Math.PI / 4);
    blade.scale(1, 1, 0.3); // flatten the prism into a slab
    blade.rotateY(0.2); // a little twist, so the three blades don't all catch the light at once
    blade.translate(0, BLADE_LEN / 2 + 0.8, HUB_Z);
    blade.rotateZ((i * Math.PI * 2) / 3);
    parts.push(blade);
  }
  return mergeGeometries(parts);
}

/** Rate multiplier added at the peak of a gust — blades run ~2.5× idle. */
const GUST_PEAK = 1.5;
/** Seconds from the wind reaching a turbine to the top of its gust. */
const GUST_TAU = 0.9;
/** Seconds of delay per world unit of +x, so the gust sweeps downwind across the ridge. */
const GUST_SWEEP = 0.008;
/** Idle spin is barely perceptible under prefers-reduced-motion. */
const REDUCED_IDLE = 0.15;

/**
 * The wind farm on the horizon. Scenery: the rotors turn on their own, and a new
 * block sends a gust sweeping across them downwind, so the ridgeline ripples
 * with the chain without claiming a legend row.
 */
export class Turbines {
  private readonly specs: TurbineSpec[];
  private readonly rotors: THREE.Mesh[];
  private readonly angles: number[];
  /** When the current gust reaches each turbine; -Infinity until the first block. */
  private readonly gustAt: number[];

  constructor(
    scene: THREE.Scene,
    private readonly reducedMotion: boolean
  ) {
    this.specs = turbineLayout();
    this.angles = this.specs.map((spec) => spec.phase);
    this.gustAt = this.specs.map(() => -Infinity);

    // every tower is static, so they all collapse into one draw call
    const towers = new THREE.Mesh(
      mergeGeometries(this.specs.map(towerGeometry)),
      new THREE.MeshStandardMaterial({
        color: FARM.turbine,
        roughness: 0.55,
        metalness: 0.1,
        flatShading: true,
      })
    );
    scene.add(towers);

    // the rotors each turn at their own rate, so they need their own meshes — but
    // they share one geometry and one material between them
    const rotor = rotorGeometry();
    const rotorMat = new THREE.MeshStandardMaterial({
      color: FARM.turbineHub,
      roughness: 0.6,
      metalness: 0.1,
      flatShading: true,
    });
    this.rotors = this.specs.map((spec) => {
      const mesh = new THREE.Mesh(rotor, rotorMat);
      const scale = spec.height / WIND_FARM.baseHeight;
      mesh.position.set(spec.x, spec.height, spec.z);
      mesh.scale.setScalar(scale);
      // default XYZ euler order applies z (the spin) before y (the yaw), so the
      // blades turn in their own plane and the whole rotor then faces the wind
      mesh.rotation.y = rotorYaw(spec);
      mesh.rotation.z = spec.phase;
      scene.add(mesh);
      return mesh;
    });
  }

  /** A new block: send a gust down the ridge, riding the +x wind. */
  gust(t: number): void {
    if (this.reducedMotion) return;
    for (let i = 0; i < this.specs.length; i++) {
      this.gustAt[i] = t + (this.specs[i].x + WIND_FARM.maxRadius) * GUST_SWEEP;
    }
  }

  update(t: number, dt: number): void {
    const idle = this.reducedMotion ? REDUCED_IDLE : 1;
    for (let i = 0; i < this.specs.length; i++) {
      const boost = gustPulse((t - this.gustAt[i]) / GUST_TAU);
      this.angles[i] += this.specs[i].rate * idle * (1 + GUST_PEAK * boost) * dt;
      this.rotors[i].rotation.z = this.angles[i];
    }
  }
}
