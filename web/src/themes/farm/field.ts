import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { FIELD, rowZ } from "./layout.js";
import { FARM } from "./palette.js";

export interface Field {
  /** Reveal the soil strip for a row the first time the tractor plows it. */
  plow(row: number): void;
}

/** Gabled barn with white trim, plus a capped silo alongside. */
function addBarn(scene: THREE.Scene, x: number, z: number): void {
  const barn = new THREE.Mesh(
    new THREE.BoxGeometry(7, 3.4, 4.6),
    new THREE.MeshStandardMaterial({ color: FARM.barn, roughness: 0.8 })
  );
  barn.position.set(x, 1.7, z);
  scene.add(barn);

  // triangular prism roof: 3-sided cylinder laid along the barn's long axis,
  // rotated so one edge ridges upward
  const roofGeometry = new THREE.CylinderGeometry(2.9, 2.9, 7.6, 3, 1);
  roofGeometry.rotateZ(Math.PI / 2);
  const roof = new THREE.Mesh(
    roofGeometry,
    new THREE.MeshStandardMaterial({ color: FARM.barnRoof, roughness: 0.8, flatShading: true })
  );
  roof.position.set(x, 4.85, z);
  scene.add(roof);

  // front face details: door with an X-brace, hayloft window
  const front = z + 2.3;
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 2.2, 0.06),
    new THREE.MeshStandardMaterial({ color: FARM.barnRoof, roughness: 0.9 })
  );
  door.position.set(x, 1.1, front + 0.03);
  scene.add(door);

  const trim: THREE.BufferGeometry[] = [];
  for (const angle of [0.6, -0.6]) {
    const brace = new THREE.BoxGeometry(0.09, 2.6, 0.05);
    brace.rotateZ(angle);
    brace.translate(x, 1.1, front + 0.08);
    trim.push(brace);
  }
  const loft = new THREE.BoxGeometry(0.8, 0.7, 0.05);
  loft.translate(x, 2.9, front + 0.04);
  trim.push(loft);
  scene.add(
    new THREE.Mesh(
      mergeGeometries(trim),
      new THREE.MeshStandardMaterial({ color: FARM.barnTrim, roughness: 0.7 })
    )
  );

  // silo to the right of the barn
  const tube = new THREE.CylinderGeometry(1.25, 1.3, 6, 12);
  tube.translate(0, 3, 0);
  const cap = new THREE.SphereGeometry(1.25, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  cap.translate(0, 6, 0);
  const silo = new THREE.Mesh(
    mergeGeometries([tube, cap]),
    new THREE.MeshStandardMaterial({ color: FARM.silo, roughness: 0.45, metalness: 0.3 })
  );
  silo.position.set(x + 5.4, 0, z);
  scene.add(silo);
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
];

function addTrees(scene: THREE.Scene): void {
  const trunks: THREE.BufferGeometry[] = [];
  const canopies: THREE.BufferGeometry[] = [];
  for (const [x, z, s] of TREES) {
    const trunk = new THREE.CylinderGeometry(0.12 * s, 0.18 * s, 1.1 * s, 5);
    trunk.translate(x, 0.55 * s, z);
    trunks.push(trunk);
    const canopy = new THREE.ConeGeometry(0.95 * s, 2.1 * s, 7);
    canopy.translate(x, (1.0 + 1.05) * s, z);
    canopies.push(canopy);
  }
  scene.add(
    new THREE.Mesh(
      mergeGeometries(trunks),
      new THREE.MeshStandardMaterial({ color: FARM.treeTrunk, roughness: 1 })
    )
  );
  scene.add(
    new THREE.Mesh(
      mergeGeometries(canopies),
      new THREE.MeshStandardMaterial({ color: FARM.treeCanopy, roughness: 0.9, flatShading: true })
    )
  );
}

/** Hazy hills on the horizon; the fog does most of the softening. */
function addHills(scene: THREE.Scene): void {
  const hills: THREE.BufferGeometry[] = [];
  for (const [x, z, r] of [
    [-55, -85, 48],
    [8, -95, 56],
    [62, -78, 42],
  ]) {
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

export function createField(scene: THREE.Scene): Field {
  const turf = new THREE.Mesh(
    new THREE.CircleGeometry(140, 48),
    new THREE.MeshStandardMaterial({ color: FARM.turf, roughness: 1 })
  );
  turf.rotation.x = -Math.PI / 2;
  scene.add(turf);

  const stripGeometry = new THREE.PlaneGeometry(FIELD.rowLength + 1.4, FIELD.rowSpacing * 0.78);
  const stripMaterial = new THREE.MeshStandardMaterial({ color: FARM.soil, roughness: 1 });
  const strips = Array.from({ length: FIELD.rows }, (_, row) => {
    const strip = new THREE.Mesh(stripGeometry, stripMaterial);
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(0, 0.02, rowZ(row));
    strip.visible = false;
    scene.add(strip);
    return strip;
  });

  // barn beyond the far edge of the field, with the silo on its right
  addBarn(scene, -10, rowZ(FIELD.rows - 1) - 6);
  addFence(scene);
  addTrees(scene);
  addHills(scene);

  return {
    plow(row) {
      strips[row].visible = true;
    },
  };
}
