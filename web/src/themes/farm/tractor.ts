import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { FIELD, rowDirection, rowZ } from "./layout.js";
import { FARM } from "./palette.js";

export const PASS_SECONDS = 10;
/** Start/end just outside the field so crops at the row ends get a pass too. */
export const EDGE_X = FIELD.rowLength / 2 + 2;
const DUST_LIFE = 1.6;
const DUST_INTERVAL = 0.12;
/** How far past EDGE_X the headland turn swings out (props keep |x| ≤ 25.5 clear). */
export const TURN_OUT = 1.3;
/** Headland driving speed: twice the plowing speed, so a pass still running
 *  when the next block lands is finished off briskly rather than jumped. */
const ROUTE_SPEED = ((2 * EDGE_X) / PASS_SECONDS) * 2;
const MIN_ROUTE_SECONDS = 1.4;
const MAX_ROUTE_SECONDS = 6;
const PUFF_LIFE = 2.6;
const PUFF_INTERVAL = 1.3;
/** Top of the exhaust pipe, in the tractor's local frame. */
const PIPE_TOP = new THREE.Vector3(0.16, 1.1, 0.13);

type Point = [x: number, z: number];

/**
 * Waypoints the tractor drives from (x, z) to the start of `row`'s pass, along
 * the headlands: finish the current row first when `heading` says it is still
 * on one (or parked at its end), swing out past the row ends and U-turn into
 * the new row. If the new row starts at the far end of the field (a reorg
 * rewound by an odd number of rows) it runs along the nearer end headland
 * instead of cutting across the crops. Exported for testing.
 */
export function headlandRoute(x: number, z: number, heading: 1 | -1 | null, row: number): Point[] {
  const entry = -rowDirection(row) as 1 | -1; // the pass starts at entry * EDGE_X
  const z1 = rowZ(row);
  const outX = EDGE_X + TURN_OUT;
  const points: Point[] = [[x, z]];
  let side: 1 | -1;
  if (heading !== null) {
    side = heading;
    if (side * x < EDGE_X) points.push([side * EDGE_X, z]);
  } else {
    // mid-turn: whichever headland it is on, or already crossing toward entry
    side = Math.abs(x) >= EDGE_X - 0.5 ? (Math.sign(x) as 1 | -1) : entry;
  }
  if (side === entry) {
    points.push([side * outX, z], [side * outX, z1], [side * EDGE_X, z1]);
  } else {
    const headZ = (z + z1) / 2 > 0 ? rowZ(0) + 1.2 : rowZ(FIELD.rows - 1) - 1.2;
    points.push(
      [side * outX, z],
      [side * outX, headZ],
      [entry * outX, headZ],
      [entry * outX, z1],
      [entry * EDGE_X, z1]
    );
  }
  // drop near-duplicates: a Catmull-Rom through coincident points degenerates
  return points.filter(
    (p, i) => i === 0 || Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) > 0.05
  );
}

interface Dust {
  sprite: THREE.Sprite;
  bornAt: number;
  x: number;
  z: number;
}

interface Puff {
  sprite: THREE.Sprite;
  bornAt: number;
  x: number;
  y: number;
  z: number;
}

/** Bake a part's local transform into its geometry so parts can be merged. */
function part(
  geometry: THREE.BufferGeometry,
  x: number,
  y: number,
  z: number,
  rotZ = 0
): THREE.BufferGeometry {
  if (rotZ) geometry.rotateZ(rotZ);
  geometry.translate(x, y, z);
  return geometry;
}

export class Tractor {
  readonly group = new THREE.Group();
  private row = -1;
  private direction: 1 | -1 = 1;
  /** when the plow starts across `row` (after any headland route) */
  private passStart = -Infinity;
  private route: THREE.CatmullRomCurve3 | null = null;
  private routeStart = 0;
  private routeEnd = 0;
  private readonly wheels: THREE.Mesh[] = [];
  private wheelAngle = 0;
  private lastT = 0;
  private readonly dust: Dust[];
  private nextDust = 0;
  private lastEmit = -Infinity;
  private readonly puffs: Puff[];
  private nextPuff = 0;
  private lastPuff = -Infinity;
  private readonly shadow: THREE.Mesh;
  private readonly point = new THREE.Vector3();
  private readonly tangent = new THREE.Vector3();
  private readonly pipe = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private reducedMotion = false,
    dustMap?: THREE.Texture
  ) {
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: FARM.tractor, roughness: 0.6 });
    const darkMaterial = new THREE.MeshStandardMaterial({
      color: FARM.tractorDark,
      roughness: 0.9,
    });
    const headlightMaterial = new THREE.MeshStandardMaterial({
      color: FARM.headlight,
      emissive: FARM.headlight,
      emissiveIntensity: 0.8,
    });
    const glassMaterial = new THREE.MeshStandardMaterial({
      color: FARM.glass,
      roughness: 0.15,
      metalness: 0.2,
    });
    const hubMaterial = new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.5 });

    // The static parts are merged into one mesh per material (five draw calls
    // instead of ~two dozen); only the wheels stay separate, to spin.
    // classic proportions: long low chassis, hood up front (+x), cab at the back
    const body: THREE.BufferGeometry[] = [
      part(new THREE.BoxGeometry(0.6, 0.34, 0.42), 0.28, 0.56, 0), // hood
      // cab: body-color base, (glass house,) thin roof
      part(new THREE.BoxGeometry(0.46, 0.18, 0.52), -0.16, 0.7, 0),
      part(new THREE.BoxGeometry(0.5, 0.06, 0.56), -0.16, 1.13, 0),
    ];
    const dark: THREE.BufferGeometry[] = [
      part(new THREE.BoxGeometry(1.1, 0.16, 0.46), 0, 0.32, 0), // chassis
      part(new THREE.BoxGeometry(0.04, 0.26, 0.34), 0.59, 0.52, 0), // grill
      part(new THREE.CylinderGeometry(0.035, 0.035, 0.36, 6), 0.16, 0.9, 0.13), // pipe
      // trailing plow: tow bar plus three angled tines dragging the soil line
      part(new THREE.BoxGeometry(0.3, 0.05, 0.08), -0.62, 0.3, 0),
      part(new THREE.BoxGeometry(0.06, 0.05, 0.62), -0.76, 0.3, 0),
    ];
    for (const tz of [-0.22, 0, 0.22]) {
      dark.push(part(new THREE.BoxGeometry(0.05, 0.26, 0.05), -0.8, 0.14, tz, 0.4));
    }
    // fenders over the big rear wheels
    for (const fz of [0.36, -0.36]) {
      body.push(part(new THREE.BoxGeometry(0.4, 0.05, 0.16), -0.34, 0.66, fz));
    }

    // big rear wheels, small front wheels, light hub caps (round about the
    // axle, so they can sit still in the static mesh while the tyres spin)
    const hubs: THREE.BufferGeometry[] = [];
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
      hubs.push(part(hubGeometry, wx, radius, wz));
    }

    this.group.add(
      new THREE.Mesh(mergeGeometries(body), bodyMaterial),
      new THREE.Mesh(mergeGeometries(dark), darkMaterial),
      new THREE.Mesh(mergeGeometries(hubs), hubMaterial),
      new THREE.Mesh(
        part(new THREE.BoxGeometry(0.04, 0.08, 0.12), 0.61, 0.62, 0),
        headlightMaterial
      ),
      new THREE.Mesh(part(new THREE.BoxGeometry(0.4, 0.32, 0.46), -0.16, 0.94, 0), glassMaterial)
    );
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

    // idle exhaust puffs while parked between blocks
    this.puffs = Array.from({ length: 4 }, () => {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: dustMap ?? null,
          color: 0x9a978e,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        })
      );
      sprite.visible = false;
      scene.add(sprite);
      return { sprite, bornAt: -Infinity, x: 0, y: 0, z: 0 };
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

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  /**
   * Begin plowing `row`. From wherever it is — parked at the end of the last
   * row, partway along it, or mid-turn — the tractor drives the headland route
   * into the new row first, so the pass itself starts a moment later. Returns
   * that pass start time (the soil reveal and crop release key off it).
   *
   * `instantAgo` (seconds) is for blocks replayed from the snapshot: no route
   * and no pass, the row is simply plowed that long ago and the tractor parks
   * at its far end.
   */
  startRow(row: number, t: number, instantAgo?: number): number {
    const wasPlowing = this.row >= 0;
    let route: Point[] = [];
    if (wasPlowing && instantAgo === undefined) {
      const onRoute = this.route !== null && t < this.routeEnd;
      this.poseAt(t);
      route = headlandRoute(this.point.x, this.point.z, onRoute ? null : this.direction, row);
    }
    this.row = row;
    this.direction = rowDirection(row);
    this.group.visible = true;
    if (route.length >= 2) {
      this.route = new THREE.CatmullRomCurve3(
        route.map(([x, z]) => new THREE.Vector3(x, 0, z)),
        false,
        "centripetal"
      );
      const seconds = this.route.getLength() / ROUTE_SPEED;
      this.routeStart = t;
      this.routeEnd = t + THREE.MathUtils.clamp(seconds, MIN_ROUTE_SECONDS, MAX_ROUTE_SECONDS);
      this.passStart = this.routeEnd;
    } else {
      this.route = null;
      this.passStart = instantAgo === undefined ? t : t - Math.max(PASS_SECONDS, instantAgo);
    }
    return this.passStart;
  }

  /** Plow x position at time t, clamped to the row ends. */
  private plowX(t: number): number {
    const progress = Math.min(1, Math.max(0, (t - this.passStart) / PASS_SECONDS));
    return this.direction * (-EDGE_X + progress * 2 * EDGE_X);
  }

  /** Whether the plow has passed x on `row`. Other rows are always passed. */
  hasPassed(row: number, x: number, t: number): boolean {
    if (row !== this.row) return true;
    return this.direction === 1 ? this.plowX(t) >= x : this.plowX(t) <= x;
  }

  /** Whether the tractor is driving (turning or plowing) rather than parked. */
  isMoving(t: number): boolean {
    if (this.row < 0) return false;
    if (this.route !== null && t >= this.routeStart && t < this.routeEnd) return true;
    return t >= this.passStart && t < this.passStart + PASS_SECONDS;
  }

  /** Where the tractor is at `t`: writes `point` (x, z) and `tangent` (heading). */
  private poseAt(t: number): void {
    if (this.route !== null && t < this.routeEnd) {
      const u = THREE.MathUtils.clamp(
        (t - this.routeStart) / (this.routeEnd - this.routeStart),
        0,
        1
      );
      this.route.getPointAt(u, this.point);
      this.route.getTangentAt(u, this.tangent);
      return;
    }
    this.point.set(this.plowX(t), 0, rowZ(this.row));
    this.tangent.set(this.direction, 0, 0);
  }

  /** Current position on the ground (x, z), or null before the first block. */
  position(t: number): { x: number; z: number; direction: 1 | -1 } | null {
    if (this.row < 0) return null;
    this.poseAt(t);
    return { x: this.point.x, z: this.point.z, direction: this.tangent.x >= 0 ? 1 : -1 };
  }

  update(t: number): void {
    const dt = Math.max(0, t - this.lastT);
    this.lastT = t;
    if (this.row < 0) return;
    this.poseAt(t);
    const moving = this.isMoving(t);
    // engine judder and turning wheels only while it is actually driving
    const bob = moving && !this.reducedMotion ? Math.sin(t * 14) * 0.012 : 0;
    this.group.position.set(this.point.x, 0.04 + bob, this.point.z);
    // local +x is forward; rotation.y = θ points it at (cos θ, 0, −sin θ)
    this.group.rotation.y = Math.atan2(-this.tangent.z, this.tangent.x);
    if (moving) {
      this.wheelAngle -= dt * (this.route !== null && t < this.routeEnd ? 9 : 6);
      for (const wheel of this.wheels) wheel.rotation.z = this.wheelAngle;
    }
    this.shadow.visible = true;
    this.shadow.position.set(this.point.x, 0.03, this.point.z);
    this.shadow.rotation.z = this.group.rotation.y;
    this.updateDust(t);
    this.updatePuffs(t, moving);
  }

  private updateDust(t: number): void {
    const progress = (t - this.passStart) / PASS_SECONDS;
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

  /** Parked and idling: a lazy puff from the exhaust now and then — waiting
   *  for the next block. */
  private updatePuffs(t: number, moving: boolean): void {
    if (!moving && !this.reducedMotion && t - this.lastPuff > PUFF_INTERVAL) {
      const p = this.puffs[this.nextPuff];
      this.nextPuff = (this.nextPuff + 1) % this.puffs.length;
      this.group.updateMatrixWorld();
      this.pipe.copy(PIPE_TOP).applyMatrix4(this.group.matrixWorld);
      p.bornAt = t;
      p.x = this.pipe.x;
      p.y = this.pipe.y;
      p.z = this.pipe.z;
      p.sprite.visible = true;
      this.lastPuff = t;
    }
    for (const p of this.puffs) {
      if (p.bornAt === -Infinity) continue;
      const age = (t - p.bornAt) / PUFF_LIFE;
      if (age >= 1 || age < 0) {
        p.sprite.visible = false;
        p.bornAt = -Infinity;
        continue;
      }
      // rises and drifts gently downwind (+x), swelling as it thins
      p.sprite.position.set(p.x + age * 0.35, p.y + age * 0.9, p.z + age * 0.12);
      p.sprite.scale.setScalar(0.12 + age * 0.45);
      p.sprite.material.opacity = Math.sin(Math.min(1, age * 3) * Math.PI * 0.5) * (1 - age) * 0.4;
    }
  }
}
