import * as THREE from "three";
import { COLORS } from "./palette.js";
import { glowTexture } from "../shared/textures.js";

const RIPPLE_SECONDS = 3.5;
const POOL = 6;
const MIST_RADIUS = 60;

export interface Ground {
  ripple(x: number, z: number): void;
  update(dt: number): void;
}

export function createGround(scene: THREE.Scene, reducedMotion = false): Ground {
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(70, 64),
    new THREE.MeshStandardMaterial({ color: COLORS.ground, roughness: 1 })
  );
  disc.rotation.x = -Math.PI / 2;
  scene.add(disc);

  // low-lying luminous mist: large faint flat glow patches drifting just above
  // the meadow floor, adding depth between the dark ground and the flora
  const mistMap = glowTexture();
  const mist = Array.from({ length: 4 }, (_, i) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: mistMap,
        color: 0x1f5a3a,
        transparent: true,
        opacity: 0.06,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    mesh.rotation.x = -Math.PI / 2;
    const s = 34 + i * 8;
    mesh.scale.set(s, s, 1);
    mesh.position.set(
      (Math.random() * 2 - 1) * MIST_RADIUS,
      0.35 + i * 0.05,
      (Math.random() * 2 - 1) * MIST_RADIUS
    );
    scene.add(mesh);
    return { mesh, vx: (Math.random() - 0.5) * 1.1, vz: (Math.random() - 0.5) * 1.1 };
  });

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
      const m = reducedMotion ? 0.2 : 1;
      for (const p of mist) {
        p.mesh.position.x += p.vx * dt * m;
        p.mesh.position.z += p.vz * dt * m;
        if (p.mesh.position.x > MIST_RADIUS) p.mesh.position.x = -MIST_RADIUS;
        else if (p.mesh.position.x < -MIST_RADIUS) p.mesh.position.x = MIST_RADIUS;
        if (p.mesh.position.z > MIST_RADIUS) p.mesh.position.z = -MIST_RADIUS;
        else if (p.mesh.position.z < -MIST_RADIUS) p.mesh.position.z = MIST_RADIUS;
      }
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
