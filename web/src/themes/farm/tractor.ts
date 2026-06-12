import * as THREE from "three";
import { FIELD, rowDirection, rowZ } from "./layout.js";
import { FARM } from "./palette.js";

export const PASS_SECONDS = 2.5;
/** Start/end just outside the field so crops at the row ends get a pass too. */
const EDGE_X = FIELD.rowLength / 2 + 2;

export class Tractor {
  readonly group = new THREE.Group();
  private row = -1;
  private startedAt = -Infinity;
  private direction: 1 | -1 = 1;
  private readonly wheels: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene) {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.95, 0.42, 0.6),
      new THREE.MeshStandardMaterial({ color: FARM.tractor, roughness: 0.6 })
    );
    body.position.y = 0.45;
    const cab = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.34, 0.5),
      new THREE.MeshStandardMaterial({ color: 0xdddde2, roughness: 0.4 })
    );
    cab.position.set(-0.18, 0.78, 0);
    const pipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.3, 5),
      new THREE.MeshStandardMaterial({ color: FARM.tractorDark })
    );
    pipe.position.set(0.3, 0.8, 0);

    const wheelGeometry = new THREE.CylinderGeometry(0.22, 0.22, 0.1, 10);
    wheelGeometry.rotateX(Math.PI / 2); // axle along z
    const wheelMaterial = new THREE.MeshStandardMaterial({
      color: FARM.tractorDark,
      roughness: 0.9,
    });
    for (const [wx, wz] of [
      [0.3, 0.34],
      [0.3, -0.34],
      [-0.32, 0.34],
      [-0.32, -0.34],
    ] as Array<[number, number]>) {
      const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
      wheel.position.set(wx, 0.22, wz);
      this.wheels.push(wheel);
      this.group.add(wheel);
    }
    this.group.add(body, cab, pipe);
    this.group.visible = false;
    scene.add(this.group);
  }

  /** Begin plowing `row`. If a pass is still running it jumps — snapshot replay compresses. */
  startRow(row: number, t: number): void {
    this.row = row;
    this.direction = rowDirection(row);
    this.startedAt = t;
    this.group.visible = true;
  }

  /** Plow x position at time t, clamped to the row ends. */
  private plowX(t: number): number {
    const progress = Math.min(1, Math.max(0, (t - this.startedAt) / PASS_SECONDS));
    return this.direction * (-EDGE_X + progress * 2 * EDGE_X);
  }

  /** Whether the plow has passed x on `row`. Other rows are always passed. */
  hasPassed(row: number, x: number, t: number): boolean {
    if (row !== this.row) return true;
    return this.direction === 1 ? this.plowX(t) >= x : this.plowX(t) <= x;
  }

  update(t: number): void {
    if (this.row < 0) return;
    this.group.position.set(this.plowX(t), 0.04 + Math.sin(t * 14) * 0.012, rowZ(this.row));
    this.group.rotation.y = this.direction === 1 ? 0 : Math.PI;
    for (const wheel of this.wheels) wheel.rotation.z = -this.direction * t * 6;
  }
}
