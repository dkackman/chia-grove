import * as THREE from "three";
import { mulberry32 } from "../shared/util.js";
import { BAND_RADIUS_MAX, BED_Y, TOP_BAND_Y } from "./layout.js";
import { LAKE } from "./palette.js";
import { SURFACE_Y } from "./water.js";

const BUBBLE_CAP = 400;
const STRIKE_SECONDS = 2.4;
const BEACON_CAP = 8;
const BEACON_SECONDS = 1.4;

interface Beacon {
  mesh: THREE.Mesh;
  bornAt: number;
  active: boolean;
}

/**
 * Ambient effects: bubble columns rising off the bed (mempool), mint beacons,
 * and the reorg predator. The per-block surface ripple lives in `water.ts`,
 * which owns the surface shader.
 */
export class Vfx {
  private readonly bubbles: THREE.Points;
  private readonly speeds: Float32Array;
  private readonly predator: THREE.Mesh;
  private readonly beacons: Beacon[];
  private nextBeacon = 0;
  private litCount = 0;
  private strikeStart = -1;

  constructor(scene: THREE.Scene) {
    const positions = new Float32Array(BUBBLE_CAP * 3);
    this.speeds = new Float32Array(BUBBLE_CAP);
    const rand = mulberry32(0x5eed1234);
    for (let i = 0; i < BUBBLE_CAP; i++) {
      // cluster bubbles into a handful of vents rather than scattering them
      const vent = Math.floor(rand() * 9);
      const ventAngle = (vent / 9) * Math.PI * 2;
      const ventRadius = 5 + (vent % 4) * 6;
      positions[i * 3] = Math.cos(ventAngle) * ventRadius + (rand() - 0.5) * 2.2;
      positions[i * 3 + 1] = BED_Y + rand() * (SURFACE_Y - BED_Y);
      positions[i * 3 + 2] = Math.sin(ventAngle) * ventRadius + (rand() - 0.5) * 2.2;
      this.speeds[i] = 1.4 + rand() * 1.8;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.bubbles = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: LAKE.bubble,
        size: 0.16,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      })
    );
    this.bubbles.frustumCulled = false;
    scene.add(this.bubbles);

    // the predator: a dark silhouette that sweeps the column on a reorg
    const bodyGeo = new THREE.ConeGeometry(0.9, 5.5, 8);
    bodyGeo.rotateZ(-Math.PI / 2); // point +X, the direction it travels
    this.predator = new THREE.Mesh(
      bodyGeo,
      new THREE.MeshStandardMaterial({
        color: LAKE.predator,
        roughness: 0.7,
        transparent: true,
        opacity: 0,
      })
    );
    this.predator.visible = false;
    scene.add(this.predator);

    // mint beacons: short-lived columns of light rising to the surface
    const beamGeo = new THREE.CylinderGeometry(0.3, 0.3, 60, 8, 1, true);
    beamGeo.translate(0, 30, 0);
    this.beacons = Array.from({ length: BEACON_CAP }, () => {
      const mesh = new THREE.Mesh(
        beamGeo,
        new THREE.MeshBasicMaterial({
          color: LAKE.shaft,
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
  }

  /** Mempool size → how much of the bubble field is active. */
  setMempool(size: number): void {
    this.litCount = Math.max(0, Math.min(BUBBLE_CAP, Math.round(size * 4)));
  }

  /**
   * Mint flag → a beacon at the given circuit radius, on a random bearing so
   * repeated mints in one block do not stack into a single brighter column.
   */
  beacon(radius: number, t: number): void {
    const b = this.beacons[this.nextBeacon];
    this.nextBeacon = (this.nextBeacon + 1) % BEACON_CAP;
    // vary the bearing by slot index rather than Math.random so the scene stays
    // reproducible across a snapshot replay
    const angle = (this.nextBeacon / BEACON_CAP) * Math.PI * 2;
    b.mesh.position.set(Math.cos(angle) * radius, BED_Y, Math.sin(angle) * radius);
    b.mesh.visible = true;
    b.active = true;
    b.bornAt = t;
  }

  /** Reorg → send the predator across the column. */
  strike(t: number): void {
    this.strikeStart = t;
    this.predator.visible = true;
  }

  /** How many bubbles are currently drawn. Test seam. */
  bubbleCount(): number {
    return this.litCount;
  }

  /** The Y of the highest active bubble. Test seam. */
  highestBubbleY(): number {
    const attr = this.bubbles.geometry.getAttribute("position") as THREE.BufferAttribute;
    let highest = -Infinity;
    for (let i = 0; i < this.litCount; i++) highest = Math.max(highest, attr.getY(i));
    return highest;
  }

  /** How many mint beacons are still burning. Test seam. */
  activeBeacons(): number {
    return this.beacons.filter((b) => b.active).length;
  }

  update(dt: number, t: number): void {
    // bubbles rise and wrap back to the bed
    const attr = this.bubbles.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < this.litCount; i++) {
      let y = attr.getY(i) + this.speeds[i] * dt;
      if (y > SURFACE_Y) y = BED_Y;
      attr.setY(i, y);
    }
    attr.needsUpdate = true;
    this.bubbles.geometry.setDrawRange(0, this.litCount);

    for (const b of this.beacons) {
      if (!b.active) continue;
      const opacity = Math.max(0, 0.5 * (1 - (t - b.bornAt) / BEACON_SECONDS));
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
      if (opacity <= 0) {
        b.active = false;
        b.mesh.visible = false;
      }
    }

    if (this.strikeStart >= 0) {
      const age = t - this.strikeStart;
      const progress = age / STRIKE_SECONDS;
      if (progress >= 1) {
        this.predator.visible = false;
        this.strikeStart = -1;
      } else {
        // crosses the column left to right, fading in and out at the edges
        const span = BAND_RADIUS_MAX + 22;
        this.predator.position.set(
          -span + progress * span * 2,
          TOP_BAND_Y - 6 + Math.sin(progress * Math.PI) * 3,
          Math.cos(progress * 2.2) * 5
        );
        this.predator.rotation.y = Math.sin(progress * 2.2) * 0.4;
        (this.predator.material as THREE.MeshStandardMaterial).opacity =
          Math.sin(progress * Math.PI) * 0.9;
      }
    }
  }
}
