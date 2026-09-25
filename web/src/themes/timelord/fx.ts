import * as THREE from "three";
import { glowTexture } from "../shared/textures.js";
import type { Vec3 } from "./layout.js";

const RING_FRAGMENT = /* glsl */ `
uniform float uProgress;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  // radial distance across the quad; a bright leading edge with a soft wake
  float r = length(vUv - 0.5) * 2.0;
  if (r > 1.0) discard;
  float edge = exp(-pow((r - 0.96) * 30.0, 2.0));
  float wake = smoothstep(0.7, 0.96, r) * 0.06;
  float fade = pow(1.0 - uProgress, 1.6);
  gl_FragColor = vec4(uColor * (edge * 0.9 + wake) * fade, 1.0);
}
`;

const RING_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

interface Ring {
  mesh: THREE.Mesh;
  uniforms: { uProgress: { value: number }; uColor: { value: THREE.Color } };
  bornAt: number;
  life: number;
  radius: number;
}

interface Flare {
  sprite: THREE.Sprite;
  bornAt: number;
  life: number;
  size: number;
  rise: number;
  baseY: number;
}

/**
 * One-shot light effects: horizontal shockwaves when a block is infused,
 * starbursts for NFT mints, and ember flares for reorged blocks. Small fixed
 * pools, recycled round-robin.
 */
export class Fx {
  private readonly rings: Ring[];
  private readonly flares: Flare[];
  private nextRing = 0;
  private nextFlare = 0;

  constructor(scene: THREE.Scene) {
    const ringGeo = new THREE.PlaneGeometry(2, 2);
    ringGeo.rotateX(-Math.PI / 2);
    this.rings = Array.from({ length: 12 }, () => {
      const uniforms = { uProgress: { value: 1 }, uColor: { value: new THREE.Color() } };
      const mesh = new THREE.Mesh(
        ringGeo,
        new THREE.ShaderMaterial({
          vertexShader: RING_VERTEX,
          fragmentShader: RING_FRAGMENT,
          uniforms,
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      mesh.visible = false;
      scene.add(mesh);
      return { mesh, uniforms, bornAt: -100, life: 1, radius: 1 };
    });
    this.flares = Array.from({ length: 24 }, () => {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTexture(),
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
        })
      );
      sprite.visible = false;
      scene.add(sprite);
      return { sprite, bornAt: -100, life: 1, size: 1, rise: 0, baseY: 0 };
    });
  }

  shockwave(
    p: Vec3,
    color: THREE.ColorRepresentation,
    radius: number,
    t: number,
    life = 1.6
  ): void {
    const r = this.rings[this.nextRing];
    this.nextRing = (this.nextRing + 1) % this.rings.length;
    r.mesh.position.set(p.x, p.y, p.z);
    r.uniforms.uColor.value.set(color);
    r.bornAt = t;
    r.life = life;
    r.radius = radius;
    r.mesh.visible = true;
  }

  flare(
    p: Vec3,
    color: THREE.ColorRepresentation,
    size: number,
    t: number,
    life = 1.2,
    rise = 0
  ): void {
    const f = this.flares[this.nextFlare];
    this.nextFlare = (this.nextFlare + 1) % this.flares.length;
    f.sprite.position.set(p.x, p.y, p.z);
    f.sprite.material.color.set(color);
    f.bornAt = t;
    f.life = life;
    f.size = size;
    f.rise = rise;
    f.baseY = p.y;
    f.sprite.visible = true;
  }

  update(t: number): void {
    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      const p = (t - r.bornAt) / r.life;
      if (p >= 1) {
        r.mesh.visible = false;
        continue;
      }
      const eased = 1 - (1 - p) ** 3;
      r.mesh.scale.setScalar(0.2 + eased * r.radius);
      r.uniforms.uProgress.value = p;
    }
    for (const f of this.flares) {
      if (!f.sprite.visible) continue;
      const p = (t - f.bornAt) / f.life;
      if (p >= 1) {
        f.sprite.visible = false;
        continue;
      }
      const swell = Math.sin(Math.min(1, p * 2.2) * Math.PI * 0.5);
      f.sprite.scale.setScalar(f.size * (0.3 + swell));
      f.sprite.material.opacity = (1 - p) ** 2;
      f.sprite.position.y = f.baseY + f.rise * p;
    }
  }
}
