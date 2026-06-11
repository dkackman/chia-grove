import * as THREE from "three";
import { COLORS } from "./palette.js";

const RIPPLE_SECONDS = 3.5;
const POOL = 6;

export interface Ground {
  ripple(x: number, z: number): void;
  update(dt: number): void;
}

export function createGround(scene: THREE.Scene): Ground {
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(70, 64),
    new THREE.MeshStandardMaterial({ color: COLORS.ground, roughness: 1 })
  );
  disc.rotation.x = -Math.PI / 2;
  scene.add(disc);

  interface Ripple {
    mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
    age: number;
    active: boolean;
  }
  const ripples: Ripple[] = Array.from({ length: POOL }, () => {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1, 64),
      new THREE.MeshBasicMaterial({
        color: COLORS.ripple,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.06;
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, age: 0, active: false };
  });
  let next = 0;

  return {
    ripple(x, z) {
      const r = ripples[next];
      next = (next + 1) % POOL;
      r.mesh.position.set(x, 0.06, z);
      r.age = 0;
      r.active = true;
      r.mesh.visible = true;
    },
    update(dt) {
      for (const r of ripples) {
        if (!r.active) continue;
        r.age += dt;
        const progress = r.age / RIPPLE_SECONDS;
        if (progress >= 1) {
          r.active = false;
          r.mesh.visible = false;
          continue;
        }
        const scale = 1 + progress * 22;
        r.mesh.scale.set(scale, scale, 1);
        r.mesh.material.opacity = 0.45 * (1 - progress);
      }
    },
  };
}
