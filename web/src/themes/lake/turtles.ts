import * as THREE from "three";
import type { SproutEvent } from "@grove/shared";
import { bandDepth, seatOffset } from "./layout.js";
import { LAKE } from "./palette.js";

const TURTLE_CAP = 30;

/** A domed shell, flattened on assembly so it reads as a carapace. */
export function shellGeometry(): THREE.SphereGeometry {
  return new THREE.SphereGeometry(0.55, 14, 10);
}

interface Turtle {
  group: THREE.Group;
  shell: THREE.Mesh;
  meta: SproutEvent | null;
  bornBlock: number;
  radius: number;
  angle: number;
  speed: number;
  bob: number;
}

/**
 * DIDs as turtles: the longest-lived things in the lake, on the slowest
 * circuits. Same pool-and-recycle shape as `Jellies` without the media
 * pipeline, since a DID has no art.
 */
export class Turtles {
  private readonly pool: Turtle[];
  private next = 0;

  constructor(
    scene: THREE.Scene,
    private readonly cap = TURTLE_CAP
  ) {
    const shellGeo = shellGeometry();
    const headGeo = new THREE.SphereGeometry(0.16, 8, 6);
    const flipperGeo = new THREE.BoxGeometry(0.4, 0.06, 0.16);
    const material = new THREE.MeshStandardMaterial({
      color: LAKE.turtle,
      roughness: 0.8,
      flatShading: true,
      emissive: new THREE.Color(LAKE.turtle),
      emissiveIntensity: 0.25,
    });

    this.pool = Array.from({ length: cap }, () => {
      const group = new THREE.Group();
      const shell = new THREE.Mesh(shellGeo, material);
      shell.scale.set(1, 0.5, 1.25); // flatten the sphere into a carapace
      const head = new THREE.Mesh(headGeo, material);
      head.position.set(0, 0, 0.72);
      group.add(shell, head);
      for (const side of [-1, 1]) {
        const flipper = new THREE.Mesh(flipperGeo, material);
        flipper.position.set(side * 0.5, 0, 0.2);
        flipper.rotation.z = side * 0.2;
        group.add(flipper);
      }
      group.visible = false;
      scene.add(group);
      return {
        group,
        shell,
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

  update(t: number, blocksSeen: number): void {
    for (const turtle of this.pool) {
      if (!turtle.meta) continue;
      const angle = turtle.angle + t * turtle.speed;
      turtle.group.position.set(
        Math.cos(angle) * turtle.radius,
        bandDepth(blocksSeen - turtle.bornBlock) + Math.sin(t * 0.35 + turtle.bob) * 0.4,
        Math.sin(angle) * turtle.radius
      );
      // the head points +Z, so yaw by -angle lines it up with the tangent
      turtle.group.rotation.y = -angle;
      // a slow paddling roll
      turtle.group.rotation.z = Math.sin(t * 1.1 + turtle.bob) * 0.12;
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
