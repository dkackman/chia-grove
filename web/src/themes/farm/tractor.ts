import * as THREE from "three";
import { FIELD, rowDirection, rowZ } from "./layout.js";
import { FARM } from "./palette.js";

export const PASS_SECONDS = 10;
/** Start/end just outside the field so crops at the row ends get a pass too. */
const EDGE_X = FIELD.rowLength / 2 + 2;
const DUST_LIFE = 1.6;
const DUST_INTERVAL = 0.12;

interface Dust {
  sprite: THREE.Sprite;
  bornAt: number;
  x: number;
  z: number;
}

export class Tractor {
  readonly group = new THREE.Group();
  private row = -1;
  private startedAt = -Infinity;
  private direction: 1 | -1 = 1;
  private readonly wheels: THREE.Mesh[] = [];
  private readonly dust: Dust[];
  private nextDust = 0;
  private lastEmit = -Infinity;
  private readonly shadow: THREE.Mesh;

  constructor(
    scene: THREE.Scene,
    private readonly reducedMotion = false,
    dustMap?: THREE.Texture
  ) {
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: FARM.tractor, roughness: 0.6 });
    const darkMaterial = new THREE.MeshStandardMaterial({
      color: FARM.tractorDark,
      roughness: 0.9,
    });

    // classic proportions: long low chassis, hood up front (+x), cab at the back
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.16, 0.46), darkMaterial);
    chassis.position.y = 0.32;
    const hood = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.34, 0.42), bodyMaterial);
    hood.position.set(0.28, 0.56, 0);
    const grill = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.26, 0.34), darkMaterial);
    grill.position.set(0.59, 0.52, 0);
    const headlight = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.08, 0.12),
      new THREE.MeshStandardMaterial({
        color: FARM.headlight,
        emissive: FARM.headlight,
        emissiveIntensity: 0.8,
      })
    );
    headlight.position.set(0.61, 0.62, 0);

    // cab: body-color base, glass house, thin roof
    const cabBase = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.18, 0.52), bodyMaterial);
    cabBase.position.set(-0.16, 0.7, 0);
    const cabGlass = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.32, 0.46),
      new THREE.MeshStandardMaterial({ color: FARM.glass, roughness: 0.15, metalness: 0.2 })
    );
    cabGlass.position.set(-0.16, 0.94, 0);
    const cabRoof = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.56), bodyMaterial);
    cabRoof.position.set(-0.16, 1.13, 0);

    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.36, 6), darkMaterial);
    pipe.position.set(0.16, 0.9, 0.13);

    // fenders over the big rear wheels
    for (const fz of [0.36, -0.36]) {
      const fender = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.16), bodyMaterial);
      fender.position.set(-0.34, 0.66, fz);
      this.group.add(fender);
    }

    // trailing plow: tow bar plus three angled tines dragging the soil line
    const towBar = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.08), darkMaterial);
    towBar.position.set(-0.62, 0.3, 0);
    const tineBar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.62), darkMaterial);
    tineBar.position.set(-0.76, 0.3, 0);
    this.group.add(towBar, tineBar);
    for (const tz of [-0.22, 0, 0.22]) {
      const tine = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.26, 0.05), darkMaterial);
      tine.position.set(-0.8, 0.14, tz);
      tine.rotation.z = 0.4;
      this.group.add(tine);
    }

    // big rear wheels, small front wheels, light hub caps
    const hubMaterial = new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.5 });
    const wheelSpecs: Array<[x: number, radius: number, width: number, z: number]> = [
      [-0.34, 0.3, 0.14, 0.33],
      [-0.34, 0.3, 0.14, -0.33],
      [0.36, 0.17, 0.1, 0.28],
      [0.36, 0.17, 0.1, -0.28],
    ];
    for (const [wx, radius, width, wz] of wheelSpecs) {
      const wheelGeometry = new THREE.CylinderGeometry(radius, radius, width, 12);
      wheelGeometry.rotateX(Math.PI / 2); // axle along z
      const wheel = new THREE.Mesh(wheelGeometry, darkMaterial);
      wheel.position.set(wx, radius, wz);
      this.wheels.push(wheel);
      this.group.add(wheel);

      const hubGeometry = new THREE.CylinderGeometry(radius * 0.45, radius * 0.45, width + 0.02, 8);
      hubGeometry.rotateX(Math.PI / 2);
      const hub = new THREE.Mesh(hubGeometry, hubMaterial);
      hub.position.copy(wheel.position);
      this.group.add(hub);
    }

    this.group.add(chassis, hood, grill, headlight, cabBase, cabGlass, cabRoof, pipe);
    this.group.visible = false;
    scene.add(this.group);

    // soft dust kicked up behind the plow; texture is shared in (null in
    // tests, which never render, keeping the constructor off the DOM)
    this.dust = Array.from({ length: 14 }, () => {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: dustMap ?? null,
          color: 0xb39c7a,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        })
      );
      sprite.visible = false;
      scene.add(sprite);
      return { sprite, bornAt: -Infinity, x: 0, z: 0 };
    });

    // soft blob shadow so the tractor sits on the soil instead of hovering
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 1.2),
      new THREE.MeshBasicMaterial({
        map: dustMap ?? null,
        color: 0x1f2616,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      })
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.visible = false;
    scene.add(this.shadow);
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
    this.shadow.visible = true;
    this.shadow.position.set(this.group.position.x, 0.03, rowZ(this.row));
    this.updateDust(t);
  }

  private updateDust(t: number): void {
    const progress = (t - this.startedAt) / PASS_SECONDS;
    // emit only while the tractor is actually crossing the row (not parked at
    // either edge), just behind the plow
    if (!this.reducedMotion && progress > 0 && progress < 1 && t - this.lastEmit > DUST_INTERVAL) {
      const d = this.dust[this.nextDust];
      this.nextDust = (this.nextDust + 1) % this.dust.length;
      d.bornAt = t;
      d.x = this.group.position.x - this.direction * 0.85 + (Math.random() - 0.5) * 0.2;
      d.z = rowZ(this.row) + (Math.random() - 0.5) * 0.4;
      d.sprite.visible = true;
      this.lastEmit = t;
    }
    for (const d of this.dust) {
      if (d.bornAt === -Infinity) continue;
      const age = (t - d.bornAt) / DUST_LIFE;
      if (age >= 1) {
        d.sprite.visible = false;
        d.bornAt = -Infinity;
        continue;
      }
      d.sprite.position.set(d.x, 0.15 + age * 0.5, d.z);
      d.sprite.scale.setScalar(0.4 + age * 0.9);
      d.sprite.material.opacity = Math.sin(age * Math.PI) * 0.5;
    }
  }
}
