import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { FIELD, rowZ } from "./layout.js";
import { FARM } from "./palette.js";
import { furrowTexture, glowTexture, mottledTexture } from "../shared/textures.js";
import { mulberry32 } from "../shared/util.js";
import { HILLS } from "./terrain.js";

export interface Field {
  /** Reveal the soil strip for a row the first time the tractor plows it. */
  plow(row: number): void;
  /** Advance ambient detail (chimney smoke). */
  update(t: number): void;
}

/**
 * A lazy curl of chimney smoke: a fixed ring of soft sprites whose lives are
 * staggered around a shared cycle, so they read as one continuous rising wisp
 * that drifts downwind and thins out. Purely decorative.
 */
function createSmoke(
  scene: THREE.Scene,
  x: number,
  y: number,
  z: number,
  reducedMotion: boolean
): (t: number) => void {
  const map = glowTexture();
  const N = 7;
  const rate = reducedMotion ? 0.06 : 0.18; // cycles per second
  const RISE = 6;
  const DRIFT = 2.5;
  const puffs = Array.from({ length: N }, (_, i) => {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map,
        color: 0xd9dde0,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })
    );
    scene.add(sprite);
    return { sprite, offset: i / N, wobble: Math.random() * Math.PI * 2 };
  });
  return (t) => {
    for (const p of puffs) {
      const f = (t * rate + p.offset) % 1; // 0 at the chimney, 1 dissipated
      p.sprite.position.set(x + f * DRIFT + Math.sin(f * 5 + p.wobble) * 0.25, y + f * RISE, z);
      p.sprite.scale.setScalar(0.5 + f * 2.2);
      p.sprite.material.opacity = Math.sin(f * Math.PI) * 0.3;
    }
  };
}

/** A translated (and optionally tilted) box, ready to merge into a group. */
function boxGeo(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  rx = 0,
  rz = 0
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

/**
 * Board-and-batten barn: stone footing, red walls with white corner boards and
 * battens, an overhanging gable roof (red gable ends, dark shingled slopes with
 * eave fascia and rake trim), double sliding doors, framed windows, a loft hood
 * on the visible gable, a stove pipe, and a cupola topped by a turning
 * weathervane (returned so the caller can swing it with the wind).
 */
function addBarn(scene: THREE.Scene, x: number, z: number): THREE.Object3D {
  const W = 7;
  const D = 4.6;
  const WH = 3;
  const F = 0.4;
  const wallTop = F + WH;
  const rg = 2.66;
  const sy = 0.72; // squash the equilateral prism to a gentler roof pitch
  const prismCenterY = wallTop + 0.5 * rg * sy;
  const ridgeY = prismCenterY + rg * sy;
  const eaveZ = 0.866 * rg; // prism base half-width ≈ wall half-depth
  const roofLenX = W + 0.9;
  const slopeLen = Math.hypot(eaveZ, ridgeY - wallTop);
  const slopeAngle = Math.atan2(ridgeY - wallTop, eaveZ);
  const midY = (ridgeY + wallTop) / 2;
  const midZ = eaveZ / 2;
  const frontZ = D / 2;

  const red: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  const white: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];
  const stone: THREE.BufferGeometry[] = [];

  // footing + walls
  stone.push(boxGeo(W + 0.3, F, D + 0.3, 0, F / 2, 0));
  red.push(boxGeo(W, WH, D, 0, F + WH / 2, 0));

  // red gable mass: equilateral prism along x, squashed for a softer pitch
  const gable = new THREE.CylinderGeometry(rg, rg, W, 3, 1);
  gable.rotateZ(Math.PI / 2); // lay the prism's length along x
  gable.rotateX(-Math.PI / 2); // swing the apex up (it starts pointing +z)
  gable.scale(1, sy, 1);
  gable.translate(0, prismCenterY, 0);
  red.push(gable);

  // dark shingled slopes overhanging the walls; ridge cap over the seam
  dark.push(boxGeo(roofLenX, 0.14, slopeLen + 0.4, 0, midY + 0.05, midZ, slopeAngle));
  dark.push(boxGeo(roofLenX, 0.14, slopeLen + 0.4, 0, midY + 0.05, -midZ, -slopeAngle));
  dark.push(boxGeo(roofLenX + 0.12, 0.18, 0.32, 0, ridgeY + 0.05, 0));

  // eave fascia + sloped rake boards outlining the gables
  for (const sign of [1, -1]) {
    white.push(boxGeo(roofLenX, 0.2, 0.08, 0, wallTop - 0.08, sign * (eaveZ + 0.18)));
  }
  for (const sx of [roofLenX / 2 - 0.06, -(roofLenX / 2 - 0.06)]) {
    white.push(boxGeo(0.12, 0.16, slopeLen + 0.4, sx, midY + 0.14, midZ, slopeAngle));
    white.push(boxGeo(0.12, 0.16, slopeLen + 0.4, sx, midY + 0.14, -midZ, -slopeAngle));
  }

  // white corner boards
  for (const cx of [W / 2 - 0.05, -(W / 2 - 0.05)]) {
    for (const cz of [D / 2 - 0.05, -(D / 2 - 0.05)]) {
      white.push(boxGeo(0.16, WH, 0.16, cx, F + WH / 2, cz));
    }
  }

  // board-and-batten strips: front (skipping the doorway) and both ends
  for (let bx = -W / 2 + 1; bx <= W / 2 - 1 + 0.001; bx += 1) {
    if (Math.abs(bx) < 1.3) continue;
    white.push(boxGeo(0.1, WH, 0.05, bx, F + WH / 2, frontZ + 0.03));
  }
  for (const ex of [W / 2 + 0.005, -(W / 2 + 0.005)]) {
    for (let bz = -D / 2 + 0.9; bz <= D / 2 - 0.9 + 0.001; bz += 0.95) {
      white.push(boxGeo(0.05, WH, 0.1, ex, F + WH / 2, bz));
    }
  }

  // double sliding doors with frame, track, and X-braces
  const doorH = 2.4;
  const doorY = F + doorH / 2;
  for (const dx of [-0.46, 0.46]) {
    dark.push(boxGeo(0.86, doorH, 0.07, dx, doorY, frontZ + 0.04));
    for (const a of [0.6, -0.6]) {
      white.push(boxGeo(0.05, 2.1, 0.03, dx, doorY, frontZ + 0.08, 0, a));
    }
  }
  white.push(boxGeo(2.3, 0.12, 0.12, 0, F + doorH + 0.1, frontZ + 0.05));
  for (const fx of [-0.96, 0.96]) {
    white.push(boxGeo(0.1, doorH + 0.12, 0.06, fx, doorY, frontZ + 0.02));
  }

  // framed windows flanking the doors
  for (const wx of [-2.5, 2.5]) {
    white.push(boxGeo(0.84, 0.94, 0.05, wx, 1.7, frontZ + 0.02));
    glass.push(boxGeo(0.64, 0.74, 0.05, wx, 1.7, frontZ + 0.05));
    white.push(boxGeo(0.06, 0.74, 0.07, wx, 1.7, frontZ + 0.06));
    white.push(boxGeo(0.64, 0.06, 0.07, wx, 1.7, frontZ + 0.06));
  }

  // loft door + hay-hood pulley beam on the visible (+x) gable
  const endX = W / 2;
  white.push(boxGeo(0.06, 1.12, 1.02, endX + 0.01, wallTop + 0.55, 0));
  dark.push(boxGeo(0.08, 0.96, 0.86, endX + 0.04, wallTop + 0.55, 0));
  dark.push(boxGeo(0.7, 0.1, 0.1, endX + 0.45, ridgeY - 0.35, 0));
  dark.push(boxGeo(0.14, 0.2, 0.14, endX + 0.74, ridgeY - 0.48, 0));

  // stove pipe on the front roof slope (the chimney smoke rises from here)
  const pipe = new THREE.CylinderGeometry(0.13, 0.15, 1.1, 8);
  pipe.translate(-2, 5.5, 0.7);
  dark.push(pipe);

  // cupola: red box with dark louvers and a little pyramid roof
  red.push(boxGeo(0.9, 0.9, 0.9, 0, ridgeY + 0.5, 0));
  for (const lz of [0.46, -0.46]) {
    for (const ly of [-0.22, 0, 0.22]) {
      dark.push(boxGeo(0.66, 0.07, 0.02, 0, ridgeY + 0.5 + ly, lz));
    }
  }
  const cupRoof = new THREE.ConeGeometry(0.82, 0.55, 4);
  cupRoof.rotateY(Math.PI / 4);
  cupRoof.translate(0, ridgeY + 1.25, 0);
  dark.push(cupRoof);

  const redMat = new THREE.MeshStandardMaterial({
    color: FARM.barn,
    roughness: 0.85,
    flatShading: true,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: FARM.barnRoof,
    roughness: 0.8,
    flatShading: true,
  });
  const whiteMat = new THREE.MeshStandardMaterial({ color: FARM.barnTrim, roughness: 0.7 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: FARM.glass,
    roughness: 0.15,
    metalness: 0.2,
  });
  const stoneMat = new THREE.MeshStandardMaterial({ color: FARM.barnFoundation, roughness: 1 });

  const place = (parts: THREE.BufferGeometry[], mat: THREE.Material): void => {
    const mesh = new THREE.Mesh(mergeGeometries(parts), mat);
    mesh.position.set(x, 0, z);
    scene.add(mesh);
  };
  place(stone, stoneMat);
  place(red, redMat);
  place(dark, darkMat);
  place(white, whiteMat);
  place(glass, glassMat);

  // weathervane on the cupola
  const metalMat = new THREE.MeshStandardMaterial({
    color: FARM.tractorDark,
    roughness: 0.5,
    metalness: 0.6,
  });
  const pole = new THREE.CylinderGeometry(0.025, 0.025, 0.95, 6);
  pole.translate(0, 0.48, 0);
  const head = new THREE.ConeGeometry(0.09, 0.22, 4);
  head.rotateZ(-Math.PI / 2);
  head.translate(0.56, 0.82, 0);
  const arrow = mergeGeometries([
    pole,
    boxGeo(0.92, 0.04, 0.04, 0, 0.82, 0),
    head,
    boxGeo(0.04, 0.2, 0.02, -0.44, 0.84, 0, 0, 0.5),
    boxGeo(0.04, 0.2, 0.02, -0.44, 0.8, 0, 0, -0.5),
  ]);
  const vane = new THREE.Group();
  vane.add(new THREE.Mesh(arrow, metalMat));
  vane.position.set(x, ridgeY + 1.5, z);
  scene.add(vane);
  return vane;
}

/** Ribbed metal silo: stone footing, banded body, domed cap with finial, side ladder. */
function addSilo(scene: THREE.Scene, x: number, z: number): void {
  const baseH = 0.4;
  const bodyH = 6;
  const bodyTop = baseH + bodyH;
  const r = 1.3;

  const siloParts: THREE.BufferGeometry[] = [];
  const body = new THREE.CylinderGeometry(r, r + 0.06, bodyH, 18);
  body.translate(0, baseH + bodyH / 2, 0);
  const dome = new THREE.SphereGeometry(r + 0.05, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.translate(0, bodyTop, 0);
  siloParts.push(body, dome);

  const bandParts: THREE.BufferGeometry[] = [];
  for (const by of [1.3, 2.5, 3.7, 4.9]) {
    const ring = new THREE.CylinderGeometry(r + 0.04, r + 0.04, 0.16, 18);
    ring.translate(0, baseH + by, 0);
    bandParts.push(ring);
  }

  const metalParts: THREE.BufferGeometry[] = [];
  const finialPole = new THREE.CylinderGeometry(0.05, 0.05, 0.35, 8);
  finialPole.translate(0, bodyTop + r + 0.1, 0);
  const finialBall = new THREE.SphereGeometry(0.1, 8, 6);
  finialBall.translate(0, bodyTop + r + 0.32, 0);
  metalParts.push(finialPole, finialBall);
  for (const lx of [-0.18, 0.18]) {
    metalParts.push(boxGeo(0.04, bodyH - 0.4, 0.04, lx, baseH + bodyH / 2, r + 0.05));
  }
  for (let ry = baseH + 0.5; ry < bodyTop - 0.3; ry += 0.5) {
    metalParts.push(boxGeo(0.4, 0.04, 0.04, 0, ry, r + 0.05));
  }

  const footing = new THREE.CylinderGeometry(r + 0.18, r + 0.24, baseH, 18);
  footing.translate(0, baseH / 2, 0);

  const place = (geo: THREE.BufferGeometry, mat: THREE.Material): void => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, 0, z);
    scene.add(mesh);
  };
  place(
    mergeGeometries(siloParts),
    new THREE.MeshStandardMaterial({ color: FARM.silo, roughness: 0.4, metalness: 0.35 })
  );
  place(
    mergeGeometries(bandParts),
    new THREE.MeshStandardMaterial({ color: FARM.siloBand, roughness: 0.5, metalness: 0.3 })
  );
  place(
    mergeGeometries(metalParts),
    new THREE.MeshStandardMaterial({ color: FARM.tractorDark, roughness: 0.5, metalness: 0.6 })
  );
  place(footing, new THREE.MeshStandardMaterial({ color: FARM.barnFoundation, roughness: 1 }));
}

/** Low fence line along the field's near (camera-side) edge. */
function addFence(scene: THREE.Scene): void {
  const fenceZ = rowZ(0) + 2.8;
  const half = FIELD.rowLength / 2 + 1;
  const parts: THREE.BufferGeometry[] = [];
  for (let x = -half; x <= half; x += 3.2) {
    const post = new THREE.BoxGeometry(0.09, 0.78, 0.09);
    post.translate(x, 0.39, fenceZ);
    parts.push(post);
  }
  for (const y of [0.42, 0.66]) {
    const rail = new THREE.BoxGeometry(half * 2, 0.055, 0.045);
    rail.translate(0, y, fenceZ);
    parts.push(rail);
  }
  scene.add(
    new THREE.Mesh(
      mergeGeometries(parts),
      new THREE.MeshStandardMaterial({ color: FARM.fence, roughness: 0.9 })
    )
  );
}

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
      g.translate(x, 0, z);
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

/** Hazy hills on the horizon; the fog does most of the softening. */
function addHills(scene: THREE.Scene): void {
  const hills: THREE.BufferGeometry[] = [];
  for (const [x, z, r] of HILLS) {
    const hill = new THREE.SphereGeometry(r, 20, 10);
    hill.scale(1.3, 0.16, 1);
    hill.translate(x, 0, z);
    hills.push(hill);
  }
  scene.add(
    new THREE.Mesh(
      mergeGeometries(hills),
      new THREE.MeshStandardMaterial({ color: FARM.hill, roughness: 1 })
    )
  );
}

/** A soft dark patch on the ground that seats a prop (a cheap fake shadow). */
function blobShadow(
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

export function createField(scene: THREE.Scene, reducedMotion = false): Field {
  const turf = new THREE.Mesh(
    new THREE.CircleGeometry(140, 48),
    new THREE.MeshStandardMaterial({
      map: mottledTexture(FARM.turf, 0x8fbf72, 0x5e8348),
      roughness: 1,
    })
  );
  turf.rotation.x = -Math.PI / 2;
  scene.add(turf);

  // faint furrow lines give the field direction even before it's plowed; sits
  // just above the turf and below the soil strips, which cover it once plowed
  const furrows = new THREE.Mesh(
    new THREE.PlaneGeometry(FIELD.rowLength + 2, FIELD.rows * FIELD.rowSpacing),
    new THREE.MeshBasicMaterial({
      map: furrowTexture(FIELD.rows),
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    })
  );
  furrows.rotation.x = -Math.PI / 2;
  furrows.position.set(0, 0.012, 0);
  scene.add(furrows);

  const stripMesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(FIELD.rowLength + 1.4, FIELD.rowSpacing * 0.78),
    new THREE.MeshStandardMaterial({ color: FARM.soil, roughness: 1 }),
    FIELD.rows
  );
  const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  const plowedMatrices = Array.from({ length: FIELD.rows }, (_, row) => {
    const m = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
    m.setPosition(0, 0.02, rowZ(row));
    return m;
  });
  for (let i = 0; i < FIELD.rows; i++) stripMesh.setMatrixAt(i, hiddenMatrix);
  scene.add(stripMesh);

  // barn beyond the far edge of the field, with the silo on its right
  const barnX = -10;
  const barnZ = rowZ(FIELD.rows - 1) - 6;
  const weathervane = addBarn(scene, barnX, barnZ);
  addSilo(scene, barnX + 5.4, barnZ);
  addFence(scene);
  addTrees(scene);
  addHills(scene);

  // soft ground shadows so the props don't read as floating on the turf
  // (offset slightly toward the camera / away from the sun)
  const shadowMap = glowTexture();
  blobShadow(scene, shadowMap, barnX - 0.8, barnZ + 0.7, 10, 6.5, 0.34);
  blobShadow(scene, shadowMap, barnX + 5.4 - 0.4, barnZ + 0.4, 3.9, 3.9, 0.32);
  for (const [tx, tz, s] of TREES) {
    blobShadow(scene, shadowMap, tx - 0.3 * s, tz + 0.25 * s, 2.6 * s, 2.6 * s, 0.3);
  }

  // smoke curling up from the barn's stove pipe
  const updateSmoke = createSmoke(scene, barnX - 2, 6, barnZ + 0.7, reducedMotion);

  return {
    plow(row) {
      stripMesh.setMatrixAt(row, plowedMatrices[row]);
      stripMesh.instanceMatrix.needsUpdate = true;
    },
    update(t) {
      updateSmoke(t);
      // a lazy, wind-driven swing rather than a constant spin
      if (!reducedMotion) {
        weathervane.rotation.y = Math.sin(t * 0.13) * 1.2 + Math.sin(t * 0.37 + 1) * 0.3;
      }
    },
  };
}
