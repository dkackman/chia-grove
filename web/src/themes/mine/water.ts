import * as THREE from "three";

/** Sits just above the lowest (elevation-0) block bases so the shore laps them. */
export const WATER_LEVEL = 0.45;

export function waterGeometry(): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(420, 420, 48, 48);
  g.rotateX(-Math.PI / 2);
  return g;
}

export interface Water {
  update(t: number): void;
}

/**
 * A translucent ocean plane the island sits in — grounds the floating plates
 * and turns terraces into shoreline. A small GPU vertex wave (via onBeforeCompile)
 * gives it life with no per-frame CPU cost. Fogged, so it fades into the horizon.
 */
export function createWater(scene: THREE.Scene): Water {
  const material = new THREE.MeshStandardMaterial({
    color: 0x2b6db0,
    transparent: true,
    opacity: 0.78,
    roughness: 0.25,
    metalness: 0.1,
  });

  let shader: { uniforms: Record<string, { value: number }> } | null = null;
  material.onBeforeCompile = (s) => {
    s.uniforms.uTime = { value: 0 };
    s.vertexShader =
      "uniform float uTime;\n" +
      s.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\n\ttransformed.y += sin(position.x * 0.35 + uTime) * 0.06 + cos(position.z * 0.3 + uTime * 0.8) * 0.06;"
      );
    shader = s as unknown as typeof shader;
  };

  const mesh = new THREE.Mesh(waterGeometry(), material);
  mesh.position.y = WATER_LEVEL;
  scene.add(mesh);

  return {
    update(t) {
      if (shader) shader.uniforms.uTime.value = t;
    },
  };
}
