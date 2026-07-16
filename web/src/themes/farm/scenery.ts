import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { FARM } from "./palette.js";
import { groundHeight, hillHeight } from "./terrain.js";
import { glowTexture } from "../shared/textures.js";
import { mulberry32 } from "../shared/util.js";

/** Hand-placed perimeter trees: [x, z, scale]. Kept off the field and camera path. */
const TREES: ReadonlyArray<readonly [number, number, number]> = [
  [-30, 8, 1.2],
  [-33, -6, 0.9],
  [-28, -18, 1.4],
  [-21, -31, 1.0],
  [29, 12, 1.1],
  [32, -2, 1.5],
  [27, -15, 0.9],
  [21, -30, 1.3],
  [36, -24, 1.1],
  [-38, 18, 1.3],
  [-42, 2, 1.0],
  [-34, 26, 0.85],
  [40, 22, 1.2],
  [34, -22, 1.0],
];

const canopyBase = new THREE.Color(FARM.treeCanopy);

/** Bake a single flat color into every vertex so all canopies share one
 *  material (one draw call) yet each tree can carry its own tint. */
function paint(geo: THREE.BufferGeometry, color: THREE.Color): THREE.BufferGeometry {
  const n = geo.attributes.position.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geo;
}

/** A leafy green near the base canopy color, jittered per tree. Conifers skew
 *  darker and cooler; broadleaves a touch lighter and warmer. */
function leafColor(rand: () => number, warm: boolean): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 };
  canopyBase.getHSL(hsl);
  const h = hsl.h + (rand() - 0.5) * 0.04 + (warm ? 0.012 : -0.016);
  const s = THREE.MathUtils.clamp(hsl.s + (rand() - 0.5) * 0.14, 0.25, 0.78);
  const l = THREE.MathUtils.clamp(hsl.l + (rand() - 0.5) * 0.12 + (warm ? 0.03 : -0.05), 0.16, 0.5);
  return new THREE.Color().setHSL(h, s, l);
}

/** A tiered conifer: a slim trunk under three or four stacked, shrinking cones,
 *  each a little brighter than the one below it. */
function makeConifer(rand: () => number): {
  trunk: THREE.BufferGeometry;
  canopy: THREE.BufferGeometry;
} {
  const trunkH = 0.6 + rand() * 0.3;
  const trunk = new THREE.CylinderGeometry(0.06, 0.1, trunkH, 5);
  trunk.translate(0, trunkH / 2, 0);

  const tint = leafColor(rand, false);
  const tiers: THREE.BufferGeometry[] = [];
  const n = rand() < 0.4 ? 4 : 3;
  let y = trunkH * 0.7;
  let r = 0.7 + rand() * 0.25;
  let h = 0.95 + rand() * 0.3;
  for (let i = 0; i < n; i++) {
    // non-indexed so conifer canopies merge with the non-indexed (Polyhedron-
    // based) broadleaf blobs, and so flat shading reads as crisp facets
    const cone = new THREE.ConeGeometry(r, h, 6).toNonIndexed();
    cone.rotateY(rand() * Math.PI);
    cone.translate(0, y + h / 2, 0);
    paint(cone, tint.clone().multiplyScalar(0.82 + (i / n) * 0.18));
    tiers.push(cone);
    y += h * 0.5;
    r *= 0.7;
    h *= 0.82;
  }
  return { trunk, canopy: mergeGeometries(tiers) };
}

/** A broadleaf tree: a tapered trunk with a branch stub or two, under a cluster
 *  of faceted leaf blobs (one big central blob plus smaller satellites). */
function makeBroadleaf(rand: () => number): {
  trunk: THREE.BufferGeometry;
  canopy: THREE.BufferGeometry;
} {
  const trunkH = 0.9 + rand() * 0.5;
  const trunkParts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.09, 0.16, trunkH, 6);
  trunk.translate(0, trunkH / 2, 0);
  trunkParts.push(trunk);
  const stubs = rand() < 0.5 ? 2 : 1;
  for (let i = 0; i < stubs; i++) {
    const len = 0.4 + rand() * 0.3;
    const stub = new THREE.CylinderGeometry(0.03, 0.06, len, 5);
    stub.translate(0, len / 2, 0);
    stub.rotateZ((0.5 + rand() * 0.5) * (rand() < 0.5 ? 1 : -1));
    stub.rotateY(rand() * Math.PI * 2);
    stub.translate(0, trunkH * (0.55 + rand() * 0.25), 0);
    trunkParts.push(stub);
  }

  const tint = leafColor(rand, true);
  const blobs: THREE.BufferGeometry[] = [];
  const cy = trunkH + 0.45;
  const count = 3 + Math.floor(rand() * 3); // 3..5
  for (let i = 0; i < count; i++) {
    const main = i === 0;
    const r = main ? 0.7 + rand() * 0.2 : 0.4 + rand() * 0.3;
    const blob = new THREE.IcosahedronGeometry(r, main ? 1 : 0);
    const ang = rand() * Math.PI * 2;
    const rad = main ? 0 : 0.3 + rand() * 0.35;
    blob.scale(1, 0.85 + rand() * 0.3, 1);
    blob.translate(
      Math.cos(ang) * rad,
      cy + (main ? 0.1 : (rand() - 0.4) * 0.5),
      Math.sin(ang) * rad
    );
    paint(blob, tint.clone().multiplyScalar(0.8 + rand() * 0.2));
    blobs.push(blob);
  }
  return { trunk: mergeGeometries(trunkParts), canopy: mergeGeometries(blobs) };
}

function addTrees(scene: THREE.Scene): void {
  const trunks: THREE.BufferGeometry[] = [];
  const canopies: THREE.BufferGeometry[] = [];
  TREES.forEach(([x, z, s0], i) => {
    const rand = mulberry32(((i + 1) * 0x9e3779b1) >>> 0);
    const s = s0 * (0.9 + rand() * 0.25);
    const { trunk, canopy } = rand() < 0.4 ? makeConifer(rand) : makeBroadleaf(rand);
    const lean = (rand() - 0.5) * 0.1;
    const yaw = rand() * Math.PI * 2;
    // scale about the base, give a slight lean, then spin (which also turns the
    // lean direction) and drop into place — trunk and canopy share the transform
    for (const g of [trunk, canopy]) {
      g.scale(s, s, s);
      g.rotateZ(lean);
      g.rotateY(yaw);
      // several trees stand out in the wings, where the ground now rolls
      g.translate(x, groundHeight(x, z), z);
    }
    trunks.push(trunk);
    canopies.push(canopy);
  });
  scene.add(
    new THREE.Mesh(
      mergeGeometries(trunks),
      new THREE.MeshStandardMaterial({ color: FARM.treeTrunk, roughness: 1 })
    )
  );
  scene.add(
    new THREE.Mesh(
      mergeGeometries(canopies),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true })
    )
  );
}

/** A soft dark patch on the ground that seats a prop (a cheap fake shadow). `y`
 *  defaults to the flat zone's height (0.03 above y = 0); callers whose prop
 *  sits on rolling ground must pass `groundHeight(x, z) + 0.03` instead, or the
 *  shadow hangs in the air (or sinks into the turf) while the prop it belongs
 *  to stands on the actual ground beneath it. */
export function blobShadow(
  scene: THREE.Scene,
  map: THREE.Texture,
  x: number,
  z: number,
  w: number,
  d: number,
  opacity: number,
  y = 0.03
): void {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshBasicMaterial({
      map,
      color: 0x202a18,
      transparent: true,
      opacity,
      depthWrite: false,
    })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, y, z);
  scene.add(mesh);
}

/** Fixed seed — the hedgerows must be identical on every reload and every replay. */
const HEDGE_SEED = 0x1cebead;

/** One shrub: a squat cluster of faceted blobs — the broadleaf canopy vocabulary
 *  at hedge scale. Exported for testing. */
export function hedgeGeometry(): THREE.BufferGeometry {
  const blobs: THREE.BufferGeometry[] = [];
  for (const [dx, dy, r] of [
    [0, 0.34, 0.5],
    [0.26, 0.22, 0.34],
    [-0.24, 0.2, 0.32],
  ] as ReadonlyArray<readonly [number, number, number]>) {
    const blob = new THREE.IcosahedronGeometry(r, 0);
    blob.scale(1, 0.8, 1);
    blob.translate(dx, dy, 0);
    blobs.push(blob);
  }
  return mergeGeometries(blobs);
}

/**
 * Hedgerows along the boundaries of the parcels painted in `landscape.ts`, so the
 * quilt gets a silhouette to go with its tone. Polylines of [x, z] in world space.
 *
 * Two things constrain these lines and neither is obvious from looking at them:
 * every one clears the hand-placed TREES (which occupy x ∈ [−42, −21] and
 * [21, 40]), and the two on the east side are split into segments with a gap
 * where the lane crosses — a hedge painted over the lane would be a hedge growing
 * through a road.
 */
const HEDGEROWS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  // west
  [
    [-50, 34],
    [-50, -36],
  ],
  [
    [-54, -38],
    [-92, -34],
  ],
  [
    [-88, 32],
    [-88, -30],
  ],
  [
    [-50, 38],
    [-84, 42],
  ],
  // east, with a gate gap for the lane (which passes x = 50 at z ≈ −23)
  [
    [50, 34],
    [50, -18],
  ],
  [
    [50, -30],
    [50, -40],
  ],
  // moved forward (from -42/-40) so the line clears HILLS[2] ([62, -78, 42]),
  // whose near fringe reached to z ≈ -37 in that x range and buried most of it
  [
    [54, -36],
    [92, -34],
  ],
  // east again; the lane passes x = 88 at z ≈ −28
  [
    [88, 32],
    [88, -18],
  ],
  [
    [88, -32],
    [88, -38],
  ],
  // the cross-hedge beyond the barn. z = -34 rather than the field-adjacent
  // -44 the hedge would otherwise want: HILLS' near fringes reach z ≈ -36 to
  // -39 (see hillHeight in terrain.ts), and at -44 the whole line sat 15-27
  // units inside one dome or another. -34 is hill-free across the full width
  // of the line; addHedgerows' hillHeight() check is the safety net for any
  // jittered straggler.
  [
    [-30, -34],
    [30, -34],
  ],
];

export interface HedgePlacement {
  x: number;
  z: number;
  /** horizontal (x and z) scale */
  s: number;
  /** vertical scale (independent of `s`, as `addHedgerows` draws it) */
  sy: number;
  yaw: number;
}

/**
 * Shrub positions stepped along each hedgerow, jittered so the line reads as
 * growth rather than a string of beads. Pure, so a test can prove nothing has
 * landed inside a hill. Exported for testing; `addHedgerows` is the only
 * production caller.
 */
export function hedgerowPlacements(): HedgePlacement[] {
  const rand = mulberry32(HEDGE_SEED);
  const base = hedgeGeometry();
  const out: HedgePlacement[] = [];
  const STEP = 1.5;
  for (const line of HEDGEROWS) {
    for (let i = 0; i + 1 < line.length; i++) {
      const [x0, z0] = line[i];
      const [x1, z1] = line[i + 1];
      const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / STEP));
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        // draw every random value for this shrub before deciding whether to
        // keep it, so the hillHeight rejection below cannot perturb the
        // sequence later elements (in this line or the next) draw from
        const rx = rand();
        const rz = rand();
        const rs = rand();
        const rsy = rand();
        const ryaw = rand();
        const x = x0 + (x1 - x0) * t + (rx - 0.5) * 0.7;
        const z = z0 + (z1 - z0) * t + (rz - 0.5) * 0.7;
        const s = 0.8 + rs * 0.7;
        const sy = s * (0.85 + rsy * 0.4);
        const yaw = ryaw * Math.PI * 2;
        // the safety net: a hedge planted inside a hill's opaque dome would
        // never be seen. A shrub's own footprint is small, but a line that
        // runs close along a hill's base (several of HEDGEROWS do) can still
        // put part of one — not just its centre — inside the dome, so this
        // checks the real transformed vertices rather than the shrub's
        // planting point alone (see isBuried below).
        const shrub = base.clone();
        shrub.scale(s, sy, s);
        shrub.rotateY(yaw);
        shrub.translate(x, groundHeight(x, z), z);
        if (isBuried(shrub)) continue;
        out.push({ x, z, s, sy, yaw });
      }
    }
  }
  return out;
}

/** Shrubs stepped along each hedgerow, each seated on the ground it stands on. */
function addHedgerows(scene: THREE.Scene): void {
  const base = hedgeGeometry();
  const shrubs = hedgerowPlacements().map(({ x, z, s, sy, yaw }) => {
    const shrub = base.clone();
    shrub.scale(s, sy, s);
    shrub.rotateY(yaw);
    shrub.translate(x, groundHeight(x, z), z);
    return shrub;
  });
  scene.add(
    new THREE.Mesh(
      mergeGeometries(shrubs),
      new THREE.MeshStandardMaterial({ color: FARM.hedge, roughness: 0.95, flatShading: true })
    )
  );
}

/** Fixed seed — the far tree line must be identical on every reload and every replay. */
const TREE_LINE_SEED = 0xfa217e;

/**
 * A hazy band of treetops far behind the barn, either side of the hills: pure
 * silhouette, no trunk worth modelling at that distance. It fills the gap on the
 * horizon between the hedgerows and the hills. Exported for testing.
 */
export function farTreeLineGeometry(): THREE.BufferGeometry {
  const rand = mulberry32(TREE_LINE_SEED);
  const blobs: THREE.BufferGeometry[] = [];
  // All three bands sit at z = -37 (was -56, -66, -52), with x-spans retuned
  // to the gaps between the hill footprints (see hillHeight in terrain.ts):
  // the old bands sat 15-27 units inside HILLS or FAR_HILLS, where the domes
  // are opaque and front-face-culled, so 69 of 75 crowns never rendered.
  for (const [x0, x1, z] of [
    [-118, -70, -37],
    [-40, 42, -37],
    [80, 122, -37],
  ] as ReadonlyArray<readonly [number, number, number]>) {
    // At z = -37 (moved up from the old -56/-66/-52) the crowns read nearly
    // twice as large on screen for the same world size, so both the radius
    // and this step were roughly halved from their old 1.6-3.0r / 2.6-step
    // values to keep the same on-screen density rather than doubling it.
    for (let x = x0; x <= x1; x += 1.1) {
      // draw every random value for this crown before deciding whether to
      // keep it, so the hillHeight rejection below cannot perturb the
      // sequence later crowns draw from
      const rjx = rand();
      const rjz = rand();
      const rr = rand();
      const rsy = rand();
      const jx = x + (rjx - 0.5) * 1.8;
      const jz = z + (rjz - 0.5) * 5;
      const r = 0.9 + rr * 0.8;
      // detail 1, not 0: PolyhedronGeometry at detail 0 calls
      // computeVertexNormals() on unshared per-face vertices, which the
      // three.js source itself notes yields "flat normals" — so flatShading
      // on the material below is a no-op at detail 0 and the crown is
      // faceted either way. Detail 1 uses normalizeNormals() instead
      // (analytic radial normals), which is what actually lets flatShading:
      // false read as a rounded, soft crown rather than a faceted hexagon.
      const blob = new THREE.IcosahedronGeometry(r, 1);
      blob.scale(1, 0.55 + rsy * 0.25, 1);
      // An icosahedron's lowest vertex sits at ~0.85r, not r, so a fixed
      // fraction of r under- or over-shoots depending on the y-squash drawn
      // above; measure the actual extent so the crown's lowest vertex meets
      // the ground exactly and it reads as a treetop rather than a floating
      // ball or one sunk into the turf.
      blob.computeBoundingBox();
      const lift = -(blob.boundingBox?.min.y ?? 0);
      // The crown is a single rigid blob translated as a whole, but its
      // footprint (radius up to ~3) is wide enough that the rolling ground
      // (terrain.ts) can be measurably higher at its edge than under its
      // centre — seating on groundHeight(jx, jz) alone left vertices a few
      // centimetres under the turf at their own (x, z). Seat on the highest
      // ground sampled around the footprint instead, so every vertex clears
      // the ground under it, not just the one under the centre.
      let ground = groundHeight(jx, jz);
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
        ground = Math.max(ground, groundHeight(jx + Math.cos(a) * r, jz + Math.sin(a) * r));
      }
      blob.translate(jx, ground + lift, jz);
      // The safety net: reject the whole crown if ANY of its actual,
      // transformed vertices sits below a hill's opaque dome surface at that
      // vertex's own (x, z). A radius-3 crown's edge can dip into a hill's
      // fringe even when its centre reads clear by a wide margin (the fringe
      // rises steeply close to a dome's footprint), so the check is against
      // the real geometry, not a single point sampled at the centre.
      if (isBuried(blob)) continue;
      blobs.push(blob);
    }
  }
  return mergeGeometries(blobs);
}

/**
 * Whether any vertex of `geo` (already in world space) sits below a hill's
 * opaque dome surface at that vertex's own (x, z) — i.e. would never render.
 *
 * `hillHeight` is exactly 0 everywhere outside every dome's footprint, so a
 * vertex only counts if it is genuinely inside one (`hh > 0`) — checking
 * `y < hillHeight(x, z)` alone would also flag ordinary rolling ground far
 * from any hill (terrain.ts's ground dips below y = 0 in the wings, which is
 * unrelated to burial). `tolerance` absorbs the sub-centimetre vertical noise
 * some base geometries carry (e.g. a hedge shrub's own blobs settle a hair
 * below y = 0 at their nominal scale) without masking a real burial, which
 * runs to tens of centimetres or more.
 */
function isBuried(geo: THREE.BufferGeometry, tolerance = 0.05): boolean {
  const pos = geo.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const hh = hillHeight(pos.getX(i), pos.getZ(i));
    if (hh > 0 && hh - pos.getY(i) > tolerance) return true;
  }
  return false;
}

/** Trees, hedgerows and the far tree line — everything green that is not a crop. */
export function createScenery(scene: THREE.Scene): void {
  addTrees(scene);
  addHedgerows(scene);
  scene.add(
    new THREE.Mesh(
      farTreeLineGeometry(),
      new THREE.MeshStandardMaterial({
        color: FARM.treeLineFar,
        roughness: 1,
        // soft foliage, not faceted boulders: at this size (crowns roughly
        // half the radius the line used at its old, more distant z) flat
        // shading turns every icosahedron face into a visible hexagon facet.
        // Smooth shading lets the crowns read as a hazy mass instead.
        flatShading: false,
      })
    )
  );

  // soft ground shadows, so the trees don't read as floating on the turf. Trees
  // seat themselves at groundHeight(x, z) (see addTrees above), so their
  // shadows must sample the same rolling ground rather than the flat default.
  const shadowMap = glowTexture();
  for (const [tx, tz, s] of TREES) {
    const sx = tx - 0.3 * s;
    const sz = tz + 0.25 * s;
    blobShadow(scene, shadowMap, sx, sz, 2.6 * s, 2.6 * s, 0.3, groundHeight(sx, sz) + 0.03);
  }
}
