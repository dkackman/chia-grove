import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { FARM } from "./palette.js";
import { groundHeight } from "./terrain.js";
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

/** A soft dark patch on the ground that seats a prop (a cheap fake shadow). */
export function blobShadow(
  scene: THREE.Scene,
  map: THREE.Texture,
  x: number,
  z: number,
  w: number,
  d: number,
  opacity: number
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
  mesh.position.set(x, 0.03, z);
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
  [
    [54, -42],
    [92, -40],
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
  // the cross-hedge beyond the barn
  [
    [-30, -44],
    [30, -44],
  ],
];

/** Shrubs stepped along each hedgerow, jittered so the line reads as growth rather
 *  than a string of beads, and each seated on the ground it stands on. */
function addHedgerows(scene: THREE.Scene): void {
  const rand = mulberry32(HEDGE_SEED);
  const base = hedgeGeometry();
  const shrubs: THREE.BufferGeometry[] = [];
  const STEP = 1.5;
  for (const line of HEDGEROWS) {
    for (let i = 0; i + 1 < line.length; i++) {
      const [x0, z0] = line[i];
      const [x1, z1] = line[i + 1];
      const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / STEP));
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const x = x0 + (x1 - x0) * t + (rand() - 0.5) * 0.7;
        const z = z0 + (z1 - z0) * t + (rand() - 0.5) * 0.7;
        const shrub = base.clone();
        const s = 0.8 + rand() * 0.7;
        shrub.scale(s, s * (0.85 + rand() * 0.4), s);
        shrub.rotateY(rand() * Math.PI * 2);
        shrub.translate(x, groundHeight(x, z), z);
        shrubs.push(shrub);
      }
    }
  }
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
  for (const [x0, x1, z] of [
    [-118, -62, -56],
    [-40, 40, -66],
    [66, 122, -52],
  ] as ReadonlyArray<readonly [number, number, number]>) {
    for (let x = x0; x <= x1; x += 2.6) {
      const jx = x + (rand() - 0.5) * 1.8;
      const jz = z + (rand() - 0.5) * 5;
      const r = 1.6 + rand() * 1.4;
      const blob = new THREE.IcosahedronGeometry(r, 0);
      blob.scale(1, 0.75 + rand() * 0.35, 1);
      // An icosahedron's lowest vertex sits at ~0.85r, not r, so a fixed
      // fraction of r under- or over-shoots depending on the y-squash drawn
      // above; measure the actual extent so the crown's lowest vertex meets
      // the ground exactly and it reads as a treetop rather than a floating
      // ball or one sunk into the turf.
      blob.computeBoundingBox();
      const lift = -(blob.boundingBox?.min.y ?? 0);
      blob.translate(jx, groundHeight(jx, jz) + lift, jz);
      blobs.push(blob);
    }
  }
  return mergeGeometries(blobs);
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
        flatShading: true,
      })
    )
  );

  // soft ground shadows, so the trees don't read as floating on the turf
  const shadowMap = glowTexture();
  for (const [tx, tz, s] of TREES) {
    blobShadow(scene, shadowMap, tx - 0.3 * s, tz + 0.25 * s, 2.6 * s, 2.6 * s, 0.3);
  }
}
