import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { mulberry32 } from "../shared/util.js";

/** Inner edge of the tree ring: just outside the block spiral's last cluster. */
export const TREELINE_INNER = 60;
/** Outer edge: inside the ground disc (radius 70) so no trunk hangs off it. */
export const TREELINE_OUTER = 69;
const TREE_COUNT = 150;

export interface TreeSpec {
  x: number;
  z: number;
  height: number;
  /** canopy radius at its widest tier */
  spread: number;
  rotY: number;
}

/**
 * Seeded placement for the ring of conifers that encloses the meadow. Angles
 * are jittered around an even spacing (so there is never a gap that shows the
 * bare disc edge) and the taller trees sit toward the back of the ring.
 */
export function treeSpecs(count = TREE_COUNT, seed = 0x67726f76): TreeSpec[] {
  const rand = mulberry32(seed);
  const specs: TreeSpec[] = [];
  for (let i = 0; i < count; i++) {
    const angle = ((i + (rand() - 0.5) * 0.9) / count) * Math.PI * 2;
    const depth = rand();
    const radius = TREELINE_INNER + depth * (TREELINE_OUTER - TREELINE_INNER);
    const height = 5.5 + rand() * 8 + depth * 4;
    specs.push({
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      height,
      spread: height * (0.16 + rand() * 0.07),
      rotY: rand() * Math.PI * 2,
    });
  }
  return specs;
}

/** One conifer, base at y = 0: skirts to the ground so no sky shows under the ring. */
function coniferGeometry(spec: TreeSpec): THREE.BufferGeometry {
  const { height: h, spread } = spec;
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(spread * 0.1, spread * 0.16, h * 0.3, 5);
  trunk.translate(0, h * 0.15, 0);
  parts.push(trunk);
  // tiers: [base height, tier height, radius] as fractions of the tree
  const tiers = [
    [0.03, 0.52, 1],
    [0.34, 0.42, 0.74],
    [0.6, 0.4, 0.48],
  ] as const;
  for (const [base, tall, r] of tiers) {
    const cone = new THREE.ConeGeometry(spread * r, h * tall, 7);
    cone.translate(0, h * (base + tall / 2), 0);
    parts.push(cone);
  }
  const tree = mergeGeometries(parts);
  tree.rotateY(spec.rotY);
  tree.translate(spec.x, 0, spec.z);
  return tree;
}

/**
 * The grove itself: a ring of dark conifers around the meadow. Static scenery
 * merged into one draw call. Nearly black under the scene fog, the far side of
 * the ring reads as a tree-line silhouette against the horizon glow and the
 * aurora (and hides the hard edge of the ground disc); the near side is behind
 * the orbiting camera.
 */
export function createTreeline(scene: THREE.Scene): THREE.Mesh {
  const geometry = mergeGeometries(treeSpecs().map(coniferGeometry));
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: 0x0c2a1d, roughness: 1, flatShading: true })
  );
  mesh.raycast = () => {};
  scene.add(mesh);
  return mesh;
}
