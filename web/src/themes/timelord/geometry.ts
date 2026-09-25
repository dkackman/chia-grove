import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** Strip to position + normal and de-index, so parts merge and can be faceted. */
function bare(geo: THREE.BufferGeometry, flat = false): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const name of Object.keys(g.attributes)) {
    if (name !== "position" && name !== "normal") g.deleteAttribute(name);
  }
  if (flat) g.computeVertexNormals(); // non-indexed → per-face normals → crisp facets
  return g;
}

/**
 * Block crystal: a hexagonal bipyramid with a short prism waist, faceted so
 * the key light and fresnel rim catch each face. ~1.5 units tall at scale 1.
 */
export function crystalGeometry(): THREE.BufferGeometry {
  const profile = [
    new THREE.Vector2(0, -1.25),
    new THREE.Vector2(0.62, -0.3),
    new THREE.Vector2(0.62, 0.3),
    new THREE.Vector2(0, 1.15),
  ];
  const g = new THREE.LatheGeometry(profile, 6);
  g.scale(0.62, 0.62, 0.62);
  return bare(g, true);
}

/** XCH coin: a thin disc facing ±Z with a raised rim, so a spin flashes face then edge. */
export function coinGeometry(): THREE.BufferGeometry {
  const disc = new THREE.CylinderGeometry(0.5, 0.5, 0.07, 28, 1);
  disc.rotateX(Math.PI / 2);
  const rim = new THREE.TorusGeometry(0.47, 0.055, 6, 28);
  const boss = new THREE.CylinderGeometry(0.22, 0.26, 0.1, 6, 1);
  boss.rotateX(Math.PI / 2);
  return mergeGeometries([bare(disc), bare(rim), bare(boss, true)]);
}

/** CAT gem: an elongated, faceted octahedron. */
export function gemGeometry(): THREE.BufferGeometry {
  const g = new THREE.OctahedronGeometry(0.5, 0);
  g.scale(0.85, 1.35, 0.85);
  return bare(g, true);
}

/** DID halo: a ring of identity. */
export function haloGeometry(): THREE.BufferGeometry {
  return bare(new THREE.TorusGeometry(0.5, 0.075, 8, 32));
}
