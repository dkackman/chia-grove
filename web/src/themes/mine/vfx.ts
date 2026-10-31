import * as THREE from "three";
import type { XZ } from "../shared/util.js";
import { MINE } from "./palette.js";
import { chunkElevation, torchRadius, FLOOR_SIDE } from "./layout.js";
import { WATER_LEVEL } from "./water.js";

const BEACON_CAP = 12;
const TORCH_CAP = 60;
const BURST_N = 80;
/** Re-place the torch ring only once the island has outgrown it by this much. */
const RING_STEP = 0.25;
const CURSOR_REST = 0.14; // build-cursor opacity between spends
const CURSOR_FLASH = 0.55; // extra opacity on an XCH spend, decaying
const CURSOR_DECAY = 3.5; // 1/s

export function torchGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(0.12, 0.6, 0.12);
  g.translate(0, 0.3, 0);
  return g;
}

/** Torch `i` of the rim ring at radius `r` (xz only). */
export function torchRingPosition(i: number, r: number): XZ {
  const angle = (i / TORCH_CAP) * Math.PI * 2;
  return { x: Math.cos(angle) * r, z: Math.sin(angle) * r };
}

/** Build-cursor brightness `age` seconds after the latest XCH spend pulse. */
export function cursorOpacity(age: number): number {
  return CURSOR_REST + CURSOR_FLASH * Math.exp(-Math.max(0, age) * CURSOR_DECAY);
}

interface Beacon {
  mesh: THREE.Mesh;
  bornAt: number;
  active: boolean;
}

export class Vfx {
  private readonly beacons: Beacon[];
  private nextBeacon = 0;
  /** all 60 rim torches in one draw; `count` = lit torches */
  readonly torches: THREE.InstancedMesh;
  private readonly flames: THREE.Sprite[];
  private litCount = 0;
  private ringRadius = -1;
  private readonly burst: THREE.Points;
  private readonly burstVel: Float32Array;
  private burstStart = -1;
  // build cursor: a square outline + faint fill over the chunk being built,
  // flashing on each XCH spend so lapped (already paved) chunks still respond
  private readonly cursor = new THREE.Group();
  private readonly cursorMats: THREE.Material[] = [];
  private pulseAt = -Infinity;

  constructor(
    scene: THREE.Scene,
    private readonly sky: { daylight: number }
  ) {
    // beacons
    const beamGeo = new THREE.CylinderGeometry(0.18, 0.18, 60, 8, 1, true);
    beamGeo.translate(0, 30, 0);
    this.beacons = Array.from({ length: BEACON_CAP }, () => {
      const mesh = new THREE.Mesh(
        beamGeo,
        new THREE.MeshBasicMaterial({
          color: MINE.beacon,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          fog: false,
        })
      );
      mesh.visible = false;
      scene.add(mesh);
      return { mesh, bornAt: 0, active: false };
    });

    // torches (one InstancedMesh) + flame sprites, placed by setIslandRadius
    this.torches = new THREE.InstancedMesh(
      torchGeometry(),
      new THREE.MeshStandardMaterial({ color: 0x5a3d23, roughness: 0.9 }),
      TORCH_CAP
    );
    this.torches.count = 0;
    this.torches.frustumCulled = false; // ring spans the scene; bounds would go stale
    scene.add(this.torches);
    const flameMat = () =>
      new THREE.SpriteMaterial({
        color: MINE.torch,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      });
    this.flames = [];
    for (let i = 0; i < TORCH_CAP; i++) {
      const flame = new THREE.Sprite(flameMat());
      flame.scale.setScalar(0.9);
      flame.visible = false;
      scene.add(flame);
      this.flames.push(flame);
    }
    this.setIslandRadius(torchRadius(1));

    // creeper burst (reorg)
    const pos = new Float32Array(BURST_N * 3);
    this.burstVel = new Float32Array(BURST_N * 3);
    const dir = new THREE.Vector3();
    for (let i = 0; i < BURST_N; i++) {
      dir.randomDirection();
      this.burstVel[i * 3] = dir.x * 6;
      this.burstVel[i * 3 + 1] = Math.abs(dir.y) * 6 + 2;
      this.burstVel[i * 3 + 2] = dir.z * 6;
    }
    const bg = new THREE.BufferGeometry();
    bg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.burst = new THREE.Points(
      bg,
      new THREE.PointsMaterial({
        color: 0x5bbb5b,
        size: 0.5,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })
    );
    this.burst.visible = false;
    scene.add(this.burst);

    // build cursor
    const half = FLOOR_SIDE / 2;
    const outline = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-half, 0, -half),
      new THREE.Vector3(half, 0, -half),
      new THREE.Vector3(half, 0, half),
      new THREE.Vector3(-half, 0, half),
    ]);
    const lineMat = new THREE.LineBasicMaterial({
      color: MINE.beacon,
      transparent: true,
      opacity: CURSOR_REST,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const fillGeo = new THREE.PlaneGeometry(FLOOR_SIDE, FLOOR_SIDE);
    fillGeo.rotateX(-Math.PI / 2);
    const fillMat = new THREE.MeshBasicMaterial({
      color: MINE.beacon,
      transparent: true,
      opacity: CURSOR_REST * 0.4,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.cursorMats.push(lineMat, fillMat);
    this.cursor.add(new THREE.LineLoop(outline, lineMat), new THREE.Mesh(fillGeo, fillMat));
    this.cursor.visible = false;
    scene.add(this.cursor);
  }

  /** Mint flag → fire a beacon beam from the block's chunk. */
  beacon(chunk: XZ, t: number): void {
    const b = this.beacons[this.nextBeacon];
    this.nextBeacon = (this.nextBeacon + 1) % BEACON_CAP;
    b.mesh.position.set(chunk.x, 0, chunk.z);
    b.mesh.visible = true;
    b.active = true;
    b.bornAt = t;
  }

  /** Mempool size → number of lit rim torches. */
  setMempool(size: number): void {
    this.litCount = Math.max(0, Math.min(TORCH_CAP, Math.round(size / 4)));
    this.torches.count = this.litCount;
  }

  /**
   * Ring the torches just outside the island's current edge (see
   * `torchRadius`), so a young island doesn't leave them out in the fog and a
   * mature one doesn't bury them.
   */
  setIslandRadius(r: number): void {
    if (Math.abs(r - this.ringRadius) < RING_STEP) return;
    this.ringRadius = r;
    const m = new THREE.Matrix4();
    for (let i = 0; i < TORCH_CAP; i++) {
      const p = torchRingPosition(i, r);
      this.torches.setMatrixAt(i, m.makeTranslation(p.x, WATER_LEVEL, p.z));
      this.flames[i].position.set(p.x, WATER_LEVEL + 0.7, p.z);
    }
    this.torches.instanceMatrix.needsUpdate = true;
  }

  /** Current torch ring radius (for tests / debugging). */
  get torchRingRadius(): number {
    return this.ringRadius;
  }

  /** Move the build cursor onto the chunk the current block is building. */
  setCursor(chunk: XZ): void {
    this.cursor.position.set(chunk.x, chunkElevation(chunk) + 1.03, chunk.z);
    this.cursor.visible = true;
  }

  /** XCH spend → flash the build cursor. */
  pulse(t: number): void {
    this.pulseAt = t;
  }

  /** Reorg → a creeper detonation at the affected chunk. */
  creeper(at: XZ, t: number): void {
    const p = this.burst.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setXYZ(i, at.x, 1, at.z);
    p.needsUpdate = true;
    this.burst.visible = true;
    this.burstStart = t;
  }

  update(dt: number, t: number): void {
    for (const b of this.beacons) {
      if (!b.active) continue;
      const age = t - b.bornAt;
      const op = Math.max(0, 0.7 - age * 0.25);
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = op;
      if (op <= 0) {
        b.active = false;
        b.mesh.visible = false;
      }
    }
    const night = 1 - this.sky.daylight;
    for (let i = 0; i < TORCH_CAP; i++) {
      const lit = i < this.litCount;
      const flame = this.flames[i];
      // an opacity-0 sprite still costs a draw call — hide it outright
      flame.visible = lit && night > 0;
      if (!flame.visible) continue;
      const flicker = 0.7 + 0.3 * Math.sin(t * 6 + i);
      (flame.material as THREE.SpriteMaterial).opacity = night * flicker;
    }
    if (this.cursor.visible) {
      const op = cursorOpacity(t - this.pulseAt);
      (this.cursorMats[0] as THREE.LineBasicMaterial).opacity = op;
      (this.cursorMats[1] as THREE.MeshBasicMaterial).opacity = op * 0.4;
    }
    if (this.burstStart >= 0) {
      const age = t - this.burstStart;
      const p = this.burst.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        p.setXYZ(
          i,
          p.getX(i) + this.burstVel[i * 3] * dt,
          Math.max(0, p.getY(i) + (this.burstVel[i * 3 + 1] - age * 9) * dt),
          p.getZ(i) + this.burstVel[i * 3 + 2] * dt
        );
      }
      p.needsUpdate = true;
      (this.burst.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - age / 0.8);
      if (age > 0.8) {
        this.burst.visible = false;
        this.burstStart = -1;
      }
    }
  }
}
