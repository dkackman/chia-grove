import * as THREE from "three";
import { mulberry32 } from "../shared/util.js";
import { BED_Y, BAND_RADIUS_MAX } from "./layout.js";
import { LAKE } from "./palette.js";

const WEED_COUNT = 700;
const FLOOR_RADIUS = 90;

/** One weed blade: a tall thin quad, origin at its base so it sways from root. */
export function weedGeometry(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(0.16, 2.4, 1, 4);
  g.translate(0, 1.2, 0);
  return g;
}

export interface Bed {
  update(t: number): void;
}

/**
 * The lake floor and its weed field. Both are static: the weed matrices are
 * written once here and never rewritten, and the sway is a vertex-shader
 * displacement scaled by height so the blades bend from their roots. The whole
 * bed therefore costs one uniform write per frame no matter how many blades.
 */
export function createBed(scene: THREE.Scene): Bed {
  const floorGeo = new THREE.CircleGeometry(FLOOR_RADIUS, 48);
  floorGeo.rotateX(-Math.PI / 2);
  const floor = new THREE.Mesh(
    floorGeo,
    new THREE.MeshStandardMaterial({ color: LAKE.bed, roughness: 1 })
  );
  floor.position.y = BED_Y;
  scene.add(floor);

  const material = new THREE.MeshStandardMaterial({
    color: LAKE.weed,
    roughness: 0.9,
    side: THREE.DoubleSide,
  });

  let shader: { uniforms: Record<string, { value: number }> } | null = null;
  material.onBeforeCompile = (s) => {
    s.uniforms.uTime = { value: 0 };
    s.vertexShader =
      "uniform float uTime;\n" +
      s.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        // instanceMatrix's translation column gives each blade a stable phase,
        // so neighbours lean together in a travelling wave instead of in unison
        float phase = instanceMatrix[3][0] * 0.28 + instanceMatrix[3][2] * 0.21;
        float lean = sin(uTime * 0.7 + phase) * 0.9 + sin(uTime * 1.3 + phase * 1.7) * 0.3;
        transformed.x += lean * transformed.y * 0.09;
        transformed.z += lean * transformed.y * 0.05;`
      );
    shader = s as unknown as typeof shader;
  };

  const weeds = new THREE.InstancedMesh(weedGeometry(), material, WEED_COUNT);
  const rand = mulberry32(0x1a2b3c4d);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler();
  for (let i = 0; i < WEED_COUNT; i++) {
    // sqrt keeps the scatter even across the disc instead of crowding the middle
    const radius = Math.sqrt(rand()) * (BAND_RADIUS_MAX + 14);
    const angle = rand() * Math.PI * 2;
    const height = 0.6 + rand() * 1.6;
    euler.set(0, rand() * Math.PI * 2, 0);
    quaternion.setFromEuler(euler);
    matrix.compose(
      position.set(Math.cos(angle) * radius, BED_Y, Math.sin(angle) * radius),
      quaternion,
      scale.set(1, height, 1)
    );
    weeds.setMatrixAt(i, matrix);
  }
  weeds.instanceMatrix.needsUpdate = true;
  // static geometry, so pin the bounds rather than letting a raycast cache a
  // stale sphere (the same trap InstancedKind documents)
  weeds.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, BED_Y, 0), BAND_RADIUS_MAX + 18);
  scene.add(weeds);

  return {
    update(t) {
      if (shader) shader.uniforms.uTime.value = t;
    },
  };
}
