import * as THREE from "three";
import type { XZ } from "../shared/util.js";
import { COLORS } from "./palette.js";
import { glowTexture } from "../shared/textures.js";

function safeBigInt(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

const MAX = 400;
const DIVE_SECONDS = 2;

interface Fly {
  cx: number;
  cz: number;
  baseY: number;
  orbitRadius: number;
  speed: number;
  phase: number;
  diveUntil: number;
  diveX: number;
  diveZ: number;
}

export class Fireflies {
  private readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly flies: Fly[];
  private visible = 60;
  private agitation = 1;

  constructor(
    scene: THREE.Scene,
    private readonly max = MAX
  ) {
    this.positions = new Float32Array(this.max * 3);
    this.flies = Array.from({ length: this.max }, () => ({
      cx: (Math.random() - 0.5) * 70,
      cz: (Math.random() - 0.5) * 70,
      baseY: 1.5 + Math.random() * 6,
      orbitRadius: 1 + Math.random() * 4,
      speed: 0.3 + Math.random() * 0.8,
      phase: Math.random() * Math.PI * 2,
      diveUntil: 0,
      diveX: 0,
      diveZ: 0,
    }));

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size: 0.35,
        map: glowTexture(),
        color: COLORS.firefly,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  setMempool(size: number, cost: string): void {
    this.visible = Math.max(20, Math.min(this.max, 20 + size));
    const costNum = Number(safeBigInt(cost) / 1_000_000_000n); // ~CLVM cost in billions
    this.agitation = Math.max(0.5, Math.min(3, 0.5 + costNum / 400));
  }

  diveTo(target: XZ, t: number): void {
    let sent = 0;
    for (const fly of this.flies) {
      if (sent >= 50) break;
      if (Math.random() < 0.25) {
        fly.diveUntil = t + DIVE_SECONDS;
        fly.diveX = target.x + (Math.random() - 0.5) * 3;
        fly.diveZ = target.z + (Math.random() - 0.5) * 3;
        sent++;
      }
    }
  }

  scatter(): void {
    for (const fly of this.flies) {
      fly.diveUntil = 0;
      fly.phase += (Math.random() - 0.5) * 2;
    }
  }

  update(t: number): void {
    for (let i = 0; i < this.visible; i++) {
      const fly = this.flies[i];
      const angle = fly.phase + t * fly.speed * this.agitation;
      let x = fly.cx + Math.cos(angle) * fly.orbitRadius;
      let z = fly.cz + Math.sin(angle * 0.8) * fly.orbitRadius;
      let y = fly.baseY + Math.sin(t * 0.9 + fly.phase) * 0.8;

      if (t < fly.diveUntil) {
        const pull = 1 - (fly.diveUntil - t) / DIVE_SECONDS;
        x += (fly.diveX - x) * pull;
        z += (fly.diveZ - z) * pull;
        y += (0.8 - y) * pull;
      }

      this.positions[i * 3] = x;
      this.positions[i * 3 + 1] = y;
      this.positions[i * 3 + 2] = z;
    }
    this.points.geometry.setDrawRange(0, this.visible);
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}
