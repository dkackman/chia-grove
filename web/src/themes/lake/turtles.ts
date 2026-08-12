import * as THREE from "three";
import type { SproutEvent } from "@grove/shared";
import { bandDepth, seatOffset } from "./layout.js";
import { turtleStroke } from "./motion.js";
import { LAKE } from "./palette.js";

const TURTLE_CAP = 30;

/** The carapace: a lathe profile — domed top with a ridge, flat rim below. */
export function shellGeometry(): THREE.BufferGeometry {
  const profile = [
    new THREE.Vector2(0.001, 0.3),
    new THREE.Vector2(0.2, 0.27),
    new THREE.Vector2(0.38, 0.18),
    new THREE.Vector2(0.5, 0.05),
    new THREE.Vector2(0.55, -0.03),
    new THREE.Vector2(0.44, -0.07),
    new THREE.Vector2(0.001, -0.07),
  ];
  const g = new THREE.LatheGeometry(profile, 18);
  g.scale(1, 1, 1.25); // oval in plan view: longer nose-to-tail
  return g;
}

/** A tapered flat paddle, origin at the shoulder so it sweeps from its root. */
export function flipperGeometry(length = 0.5): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(0.16, length, 6);
  g.rotateZ(-Math.PI / 2); // apex points +X (outward from the body)
  g.scale(1, 0.22, 0.7); // flatten into a blade
  g.translate(length / 2, 0, 0); // root at the origin
  return g;
}

interface Turtle {
  group: THREE.Group;
  shell: THREE.Mesh;
  flippers: THREE.Mesh[];
  meta: SproutEvent | null;
  bornBlock: number;
  radius: number;
  angle: number; // integrated per frame — surge speeds it up mid-stroke
  speed: number;
  bob: number;
}

/**
 * DIDs as turtles: the longest-lived things in the lake, on the slowest
 * circuits. Same pool-and-recycle shape as `Jellies` without the media
 * pipeline, since a DID has no art. Motion is a stroke-glide driven by
 * `turtleStroke`: flippers paddle and the circuit angle is integrated each
 * frame so surge speeds it up mid-stroke — the path phase depends on frame
 * timing, but the seat (radius, starting angle, speed, bob) stays
 * deterministic.
 */
export class Turtles {
  private readonly pool: Turtle[];
  private next = 0;

  constructor(
    scene: THREE.Scene,
    private readonly cap = TURTLE_CAP
  ) {
    const shellGeo = shellGeometry();
    const headGeo = new THREE.SphereGeometry(0.15, 10, 8);
    const neckGeo = new THREE.CylinderGeometry(0.08, 0.11, 0.3, 8);
    neckGeo.rotateX(Math.PI / 2); // along +Z, toward the head
    const frontGeo = flipperGeometry(0.55);
    const rearGeo = flipperGeometry(0.32);
    const material = new THREE.MeshStandardMaterial({
      color: LAKE.turtle,
      roughness: 0.8,
      flatShading: true,
      emissive: new THREE.Color(LAKE.turtle),
      emissiveIntensity: 0.25,
    });

    this.pool = Array.from({ length: cap }, () => {
      const group = new THREE.Group();
      // default XYZ order applies rotation.x outside the yaw, degrading the
      // nose-up glide pitch into roll on part of the circuit — yaw first
      group.rotation.order = "YXZ";
      const shell = new THREE.Mesh(shellGeo, material);
      const head = new THREE.Mesh(headGeo, material);
      head.position.set(0, 0.02, 0.85);
      const neck = new THREE.Mesh(neckGeo, material);
      neck.position.set(0, 0, 0.62);
      const flippers: THREE.Mesh[] = [];
      for (const [x, z] of [
        [-0.5, 0.3],
        [0.5, 0.3],
        [-0.42, -0.42],
        [0.42, -0.42],
      ] as const) {
        const mesh = new THREE.Mesh(z > 0 ? frontGeo : rearGeo, material);
        mesh.position.set(x, -0.02, z);
        // the blade points +X; yaw θ sends +X to (cos θ, -sin θ) in XZ, so these
        // angle each blade outward from its side and slightly forward (+Z)
        mesh.rotation.y = x < 0 ? Math.PI + 0.5 : -0.5;
        flippers.push(mesh);
      }
      group.add(shell, head, flippers[0], flippers[1], flippers[2], flippers[3], neck);
      group.visible = false;
      scene.add(group);
      return {
        group,
        shell,
        flippers,
        meta: null,
        bornBlock: 0,
        radius: 0,
        angle: 0,
        speed: 0,
        bob: 0,
      };
    });
  }

  plant(event: SproutEvent, bornBlock: number): void {
    const slot = this.next;
    const turtle = this.pool[slot];
    this.next = (this.next + 1) % this.cap;

    const seat = seatOffset(event.coinId);
    turtle.meta = event;
    turtle.bornBlock = bornBlock;
    turtle.radius = seat.radius * 1.05;
    turtle.angle = seat.angle;
    turtle.speed = seat.speed * 0.25; // patient
    turtle.bob = seat.bob;
    turtle.group.visible = true;
  }

  update(dt: number, t: number, blocksSeen: number): void {
    for (const turtle of this.pool) {
      if (!turtle.meta) continue;
      const stroke = turtleStroke(t * 1.6 + turtle.bob);
      turtle.angle += turtle.speed * stroke.surge * dt;
      turtle.group.position.set(
        Math.cos(turtle.angle) * turtle.radius,
        bandDepth(blocksSeen - turtle.bornBlock) + Math.sin(t * 0.35 + turtle.bob) * 0.4,
        Math.sin(turtle.angle) * turtle.radius
      );
      // the head points +Z, so yaw by -angle lines it up with the tangent
      turtle.group.rotation.y = -turtle.angle;
      turtle.group.rotation.x = -stroke.pitch; // nose-up during the glide
      turtle.group.rotation.z = Math.sin(t * 1.1 + turtle.bob) * 0.06;
      const rear = turtleStroke(t * 1.6 + turtle.bob + Math.PI);
      for (let i = 0; i < turtle.flippers.length; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const s = i < 2 ? stroke : rear;
        turtle.flippers[i].rotation.z = side * (0.15 + s.sweep * 0.55);
      }
    }
  }

  clearAbove(forkHeight: number): void {
    for (const turtle of this.pool) {
      if (turtle.meta && turtle.meta.height >= forkHeight) {
        turtle.meta = null;
        turtle.group.visible = false;
      }
    }
  }

  pickables(): THREE.Object3D[] {
    return this.pool.filter((turtle) => turtle.meta).map((turtle) => turtle.shell);
  }

  metaFor(object: THREE.Object3D): SproutEvent | null {
    return this.pool.find((turtle) => turtle.shell === object)?.meta ?? null;
  }
}
