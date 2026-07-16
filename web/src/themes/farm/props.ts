import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { FIELD, rowZ, TURF_RADIUS } from "./layout.js";
import { FARM } from "./palette.js";
import { groundHeight, hillHeight } from "./terrain.js";
import { blobShadow } from "./scenery.js";
import { nearLane } from "./landscape.js";
import { glowTexture } from "../shared/textures.js";
import { mulberry32 } from "../shared/util.js";

/** Fixed seed — the scatter must be identical on every reload and every replay. */
const SEED = 0xb01dea;

export type PropKind = "rock" | "tuft" | "scrub" | "bale";

export interface Placement {
  kind: PropKind;
  x: number;
  z: number;
  /** uniform scale */
  s: number;
  yaw: number;
}

/** The crop rows plus the tractor's headland turns (EDGE_X = 24). Anything
 *  scattered in here gets planted through or driven through. */
function inField(x: number, z: number): boolean {
  return Math.abs(x) <= 25.5 && z <= rowZ(0) + 1.6 && z >= rowZ(FIELD.rows - 1) - 1.6;
}

/** The barnyard — the barn, the woodpile, the trough, the ladder and the crates
 *  that clutterGeometry() places by hand — plus the silo. All solid. */
function inBarnyard(x: number, z: number): boolean {
  const inYard = x >= -21.5 && x <= -5.5 && z >= -29 && z <= -21;
  const inSilo = Math.hypot(x + 4.6, z + 26) < 2.4;
  return inYard || inSilo;
}

/** The strip between the fence and the camera's drift path. Anything but an
 *  ankle-high tuft dropped in here fills the frame. */
function inForeground(kind: PropKind, x: number, z: number): boolean {
  return kind !== "tuft" && z > 20 && Math.abs(x) < 32;
}

/**
 * The seeded scatter. Rocks and tufts hug the field's edges and the fence line,
 * where they hide the seam between the turf and the things standing on it; scrub
 * and bales sit further out in the pasture. Pure, so a test can prove nothing has
 * landed anywhere it must not.
 */
export function propPlacements(): Placement[] {
  const rand = mulberry32(SEED);
  const out: Placement[] = [];

  const scatter = (kind: PropKind, count: number, reach: number, sMin: number, sMax: number) => {
    let placed = 0;
    // rejection sampling; the guard keeps a bad rejection rule from spinning
    for (let tries = 0; placed < count && tries < count * 80; tries++) {
      const a = rand() * Math.PI * 2;
      const r = 27 + rand() * reach;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (inField(x, z) || inBarnyard(x, z) || inForeground(kind, x, z)) continue;
      // inside a hill's opaque, front-face-culled dome (see hillHeight in
      // terrain.ts) — would never be seen
      if (hillHeight(x, z) > 0.4) continue;
      // inside the dirt lane's dust band — a boulder in the road undoes the
      // gate gaps the hedgerows leave for it
      if (nearLane(x, z, 1.6)) continue;
      if (Math.hypot(x, z) > TURF_RADIUS - 12) continue;
      out.push({ kind, x, z, s: sMin + rand() * (sMax - sMin), yaw: rand() * Math.PI * 2 });
      placed++;
    }
  };

  scatter("rock", 26, 34, 0.6, 1.5);
  scatter("tuft", 150, 46, 0.7, 1.5);
  scatter("scrub", 34, 60, 0.8, 1.5);
  scatter("bale", 7, 30, 0.9, 1.1);

  // a stack of bales east of the silo, on the worn apron and clear of the lane.
  // Hand-placed, so it does not go through scatter()'s nearLane rejection —
  // nudged 0.5 south of its original z so it still clears the lane's new,
  // more southerly centreline (see FIX 3 in landscape.ts) by > 1.6.
  for (const [x, z] of [
    [-1.6, -26.0],
    [-1.6, -24.4],
    [0.2, -25.2],
  ] as ReadonlyArray<readonly [number, number]>) {
    out.push({ kind: "bale", x, z, s: 1, yaw: rand() * 0.4 });
  }

  return out;
}

/** A faceted boulder, sunk to its waist so it sits in the ground, not on it. */
export function rockGeometry(): THREE.BufferGeometry {
  const rock = new THREE.IcosahedronGeometry(0.5, 0);
  rock.scale(1.25, 0.72, 1);
  rock.translate(0, 0.16, 0);
  return rock;
}

/** A tuft of grass: three blades leaning apart. */
export function tuftGeometry(): THREE.BufferGeometry {
  const blades: THREE.BufferGeometry[] = [];
  for (const [lean, yaw] of [
    [0.22, 0],
    [-0.26, 2.1],
    [0.1, 4.2],
  ] as ReadonlyArray<readonly [number, number]>) {
    const blade = new THREE.ConeGeometry(0.09, 0.5, 4);
    blade.translate(0, 0.25, 0);
    blade.rotateZ(lean);
    blade.rotateY(yaw);
    blades.push(blade);
  }
  return mergeGeometries(blades);
}

/** A low bush: two squat faceted blobs. */
export function scrubGeometry(): THREE.BufferGeometry {
  const blobs: THREE.BufferGeometry[] = [];
  for (const [dx, dy, r] of [
    [0, 0.26, 0.4],
    [0.22, 0.18, 0.26],
  ] as ReadonlyArray<readonly [number, number, number]>) {
    const blob = new THREE.IcosahedronGeometry(r, 0);
    blob.scale(1, 0.75, 1);
    blob.translate(dx, dy, 0);
    blobs.push(blob);
  }
  return mergeGeometries(blobs);
}

/** A round bale, lying on its side with its axis along x. */
export function baleGeometry(): THREE.BufferGeometry {
  const bale = new THREE.CylinderGeometry(0.62, 0.62, 1.25, 12);
  bale.rotateZ(Math.PI / 2);
  bale.translate(0, 0.62, 0);
  return bale;
}

/**
 * The barnyard clutter, already in world space: a woodpile against the barn's
 * west end, a water trough out past the chicken yard, a ladder leaning on the
 * front wall, and a pair of crates east of the doors. Human-scale objects —
 * they are what give the barn its size.
 *
 * Every position here is threaded between things that are already there: the barn
 * (x ∈ [−13.5, −6.5], front wall at z ≈ −23.7), the silo (x ≈ −4.6, z ≈ −26,
 * r ≈ 1.5), the lane (z ≈ −21.5 in front of the doors), the chicken yard
 * (x ∈ [−17.5, −10.5], z ∈ [−26.5, −19.5]) and the field's far soil strip
 * (z ≈ −19.6). It all sits inside the flat zone, so a hard-coded y is the ground.
 *
 * The crates in particular are threaded, footprint included, between: the
 * chicken yard (x ≤ −10.5), the sliding doors (x ∈ [−10.92, −9.08]) and their
 * frame (x ≈ −9.04), the ladder (rails x ∈ [−8.705, −8.195], rungs
 * x ∈ [−8.7, −8.2], both z ∈ [−23.69, −22.83]), the east corner board
 * (x ≈ −6.55) and the east window (x ∈ [−7.92, −7.08], y ∈ [1.23, 2.17]) — the
 * stack stands in front of the window but keeps its top (y = 1.2) below the
 * sill, and the barn's front wall (z = −23.675), which its near face clears by
 * ~0.09. The two crates share a centre (x = −7.3, z = −23.15) so the upper
 * one's base is 100% supported by the lower one's top face.
 */
export function clutterGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, ry = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    parts.push(g);
  };

  // woodpile: split logs stacked against the barn's west end (wall at x = −13.5)
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 5; i++) {
      const log = new THREE.CylinderGeometry(0.11, 0.11, 1.8, 6);
      log.rotateZ(Math.PI / 2);
      log.translate(-14.8, 0.12 + row * 0.23, -27.6 + i * 0.24 + (row % 2) * 0.12);
      parts.push(log);
    }
  }

  // water trough on legs, west of the chicken yard and clear of the soil strips
  box(0.7, 0.42, 2.1, -20.5, 0.5, -22.5);
  for (const lz of [-23.3, -21.7]) {
    box(0.1, 0.3, 0.1, -20.75, 0.15, lz);
    box(0.1, 0.3, 0.1, -20.25, 0.15, lz);
  }

  // ladder leaning on the barn's front wall, east of the doors. rotateX is
  // negative so the top tips toward -z, into the wall (not away from it); the
  // rungs below track the rails' leaning centreline, so edit the two together.
  for (const dx of [-0.22, 0.22]) {
    const rail = new THREE.BoxGeometry(0.07, 3.1, 0.07);
    rail.rotateX(-0.26);
    rail.translate(-8.45 + dx, 1.5, -23.26);
    parts.push(rail);
  }
  for (let i = 0; i < 6; i++) {
    const y = 0.4 + i * 0.45;
    box(0.5, 0.05, 0.05, -8.45, y, -23.26 - (y - 1.5) * 0.266);
  }

  // crates east of the doors, clear of the chicken yard, the ladder and the
  // corner board; the upper one flush and centred on the lower one, its top
  // (y = 1.2) below the east window's sill (y = 1.23)
  box(0.7, 0.7, 0.7, -7.3, 0.35, -23.15, 0.3);
  box(0.5, 0.5, 0.5, -7.3, 0.95, -23.15, -0.2);

  return mergeGeometries(parts);
}

/** One merged mesh per kind — a few hundred small objects in four draw calls. */
function addKind(
  scene: THREE.Scene,
  placements: readonly Placement[],
  kind: PropKind,
  base: THREE.BufferGeometry,
  material: THREE.Material
): void {
  const parts = placements
    .filter((p) => p.kind === kind)
    .map((p) => {
      const g = base.clone();
      g.scale(p.s, p.s, p.s);
      g.rotateY(p.yaw);
      g.translate(p.x, groundHeight(p.x, p.z), p.z);
      return g;
    });
  if (parts.length === 0) return;
  scene.add(new THREE.Mesh(mergeGeometries(parts), material));
}

/** The static scatter: boulders, tufts, scrub, bales, and the barnyard clutter. */
export function createProps(scene: THREE.Scene): void {
  const placements = propPlacements();
  const stone = (color: number) =>
    new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true });

  addKind(scene, placements, "rock", rockGeometry(), stone(FARM.rock));
  addKind(scene, placements, "tuft", tuftGeometry(), stone(FARM.tuft));
  addKind(scene, placements, "scrub", scrubGeometry(), stone(FARM.scrub));
  addKind(scene, placements, "bale", baleGeometry(), stone(FARM.hay));
  scene.add(new THREE.Mesh(clutterGeometry(), stone(FARM.wood)));

  // only the props big enough to want one: a bale floating a hair off the turf is
  // obvious, a tuft is not. Bales seat themselves at groundHeight(x, z) (see
  // addKind above), so their shadows must sample the same rolling ground.
  const shadowMap = glowTexture();
  for (const p of placements) {
    if (p.kind !== "bale") continue;
    const sx = p.x - 0.2;
    const sz = p.z + 0.2;
    blobShadow(scene, shadowMap, sx, sz, 1.9 * p.s, 1.9 * p.s, 0.28, groundHeight(sx, sz) + 0.03);
  }
}
