import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { FIELD, rowZ } from "./layout.js";
import { FARM } from "./palette.js";

const CHASE_SECONDS = 2.5;
// the flock's home range, on the turf near the barn
const HOME = { x: -14, z: rowZ(FIELD.rows - 1) - 3, spread: 7 };

interface Hen {
  x: number;
  z: number;
  wx: number;
  wz: number;
  phase: number;
  speed: number;
  chaseUntil: number;
}

function chickenGeometry(): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(0.16, 8, 6);
  body.scale(1.2, 1, 1);
  body.translate(0, 0.16, 0);
  const head = new THREE.SphereGeometry(0.08, 8, 6);
  head.translate(0.16, 0.32, 0);
  const beak = new THREE.ConeGeometry(0.03, 0.08, 4);
  beak.rotateZ(-Math.PI / 2);
  beak.translate(0.26, 0.32, 0);
  return mergeGeometries([body, head, beak]);
}

export class Chickens {
  private readonly mesh: THREE.InstancedMesh;
  private readonly hens: Hen[];
  private visible = 8;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3(1, 1, 1);
  private readonly euler = new THREE.Euler();

  constructor(scene: THREE.Scene, private readonly max: number) {
    this.mesh = new THREE.InstancedMesh(
      chickenGeometry(),
      new THREE.MeshStandardMaterial({ color: FARM.chicken, roughness: 0.8 }),
      max
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) this.mesh.setMatrixAt(i, zero);
    scene.add(this.mesh);
    this.hens = Array.from({ length: max }, () => ({
      x: HOME.x + (Math.random() - 0.5) * HOME.spread,
      z: HOME.z + (Math.random() - 0.5) * HOME.spread,
      wx: HOME.x + (Math.random() - 0.5) * HOME.spread,
      wz: HOME.z + (Math.random() - 0.5) * HOME.spread,
      phase: Math.random() * Math.PI * 2,
      speed: 0.6 + Math.random() * 0.5,
      chaseUntil: 0,
    }));
  }

  /** Flock size tracks pending transactions. */
  setMempool(size: number): void {
    this.visible = Math.max(8, Math.min(this.max, 8 + Math.round(size / 4)));
  }

  /** A new block: some hens run toward the freshly plowed row. */
  chase(x: number, z: number, t: number): void {
    for (const hen of this.hens) {
      if (Math.random() < 0.4) {
        hen.chaseUntil = t + CHASE_SECONDS;
        hen.wx = x + (Math.random() - 0.5) * 6;
        hen.wz = z + (Math.random() - 0.5) * 2;
      }
    }
  }

  update(t: number, dt: number): void {
    for (let i = 0; i < this.hens.length; i++) {
      const hen = this.hens[i];
      if (i >= this.visible) {
        this.matrix.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this.matrix);
        continue;
      }
      const dx = hen.wx - hen.x;
      const dz = hen.wz - hen.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.2) {
        // arrived: peck a while, then wander home range
        if (t > hen.chaseUntil) {
          hen.wx = HOME.x + (Math.random() - 0.5) * HOME.spread;
          hen.wz = HOME.z + (Math.random() - 0.5) * HOME.spread;
        }
      } else {
        const step = (hen.chaseUntil > t ? 2.2 : 0.8) * hen.speed * dt;
        hen.x += (dx / dist) * step;
        hen.z += (dz / dist) * step;
      }
      const peck = Math.max(0, Math.sin(t * 5 * hen.speed + hen.phase)) * 0.07;
      this.quaternion.setFromEuler(this.euler.set(0, Math.atan2(dx, dz) + Math.PI / 2, 0));
      this.matrix.compose(
        this.position.set(hen.x, -peck, hen.z),
        this.quaternion,
        this.scale
      );
      this.mesh.setMatrixAt(i, this.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
