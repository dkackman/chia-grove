import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { SproutEvent } from "@grove/shared";
import { InstancedKind, type Pose } from "../shared/instanced.js";
import { mulberry32 } from "../shared/util.js";
import { catColor } from "../shared/cat-color.js";
import { catWidth, xchHeight } from "../shared/scales.js";
import { plantPosition } from "./layout.js";
import { FARM } from "./palette.js";
import type { Tractor } from "./tractor.js";

function wheatBlade(height: number): THREE.BufferGeometry {
  const stalk = new THREE.CylinderGeometry(0.018, 0.03, height, 4);
  stalk.translate(0, height / 2, 0);
  const head = new THREE.ConeGeometry(0.06, 0.28, 5);
  head.translate(0, height + 0.1, 0);
  return mergeGeometries([stalk, head]);
}

export function wheatGeometries(): THREE.BufferGeometry[] {
  const single = wheatBlade(1);

  const left = wheatBlade(0.8);
  left.rotateZ(0.3);
  const right = wheatBlade(0.9);
  right.rotateZ(-0.26);
  const cluster = mergeGeometries([wheatBlade(1), left, right]);

  const bent = wheatBlade(0.95);
  bent.rotateZ(0.14);

  return [single, cluster, bent];
}

export function gourdGeometries(): THREE.BufferGeometry[] {
  // pumpkin: squashed sphere with a stub stem
  const pumpkinBody = new THREE.SphereGeometry(0.26, 10, 8);
  pumpkinBody.scale(1, 0.72, 1);
  pumpkinBody.translate(0, 0.19, 0);
  const stem = new THREE.CylinderGeometry(0.03, 0.045, 0.14, 5);
  stem.translate(0, 0.42, 0);
  const pumpkin = mergeGeometries([pumpkinBody, stem]);

  // cabbage: low round head
  const cabbage = new THREE.SphereGeometry(0.22, 10, 8);
  cabbage.scale(1, 0.85, 1);
  cabbage.translate(0, 0.19, 0);

  // tall squash
  const squashBody = new THREE.CylinderGeometry(0.12, 0.17, 0.4, 8);
  squashBody.translate(0, 0.2, 0);
  const squashTop = new THREE.SphereGeometry(0.12, 8, 6);
  squashTop.translate(0, 0.4, 0);
  const squash = mergeGeometries([squashBody, squashTop]);

  return [pumpkin, cabbage, squash];
}

function sunflower(height: number, headRadius: number): THREE.BufferGeometry {
  const stalk = new THREE.CylinderGeometry(0.03, 0.05, height, 5);
  stalk.translate(0, height / 2, 0);
  const core = new THREE.CylinderGeometry(headRadius * 0.55, headRadius * 0.55, 0.06, 10);
  core.rotateX(0.45); // tip the face toward the camera side of the field
  core.translate(0, height + 0.02, 0.04);
  const petals = new THREE.TorusGeometry(headRadius * 0.78, headRadius * 0.3, 6, 12);
  petals.rotateX(Math.PI / 2 + 0.45); // same facing as the core disc
  petals.translate(0, height + 0.02, 0.04);
  return mergeGeometries([stalk, core, petals]);
}

export function sunflowerGeometries(): THREE.BufferGeometry[] {
  return [sunflower(0.9, 0.16), sunflower(1.1, 0.13), sunflower(0.7, 0.19)];
}

function scarecrow(armTilt: number, hat: boolean): THREE.BufferGeometry {
  const post = new THREE.CylinderGeometry(0.035, 0.05, 1.05, 5);
  post.translate(0, 0.525, 0);
  const arms = new THREE.BoxGeometry(0.78, 0.055, 0.055);
  arms.rotateZ(armTilt);
  arms.translate(0, 0.78, 0);
  const head = new THREE.SphereGeometry(0.11, 8, 6);
  head.translate(0, 1.0, 0);
  const parts = [post, arms, head];
  if (hat) {
    const cone = new THREE.ConeGeometry(0.14, 0.18, 6);
    cone.translate(0, 1.14, 0);
    parts.push(cone);
  }
  return mergeGeometries(parts);
}

export function scarecrowGeometries(): THREE.BufferGeometry[] {
  return [scarecrow(0, true), scarecrow(0.12, false), scarecrow(-0.08, true)];
}

const CAPS = { wheat: 800, gourd: 140, sunflower: 40, scarecrow: 80 } as const;
const VARIANTS = 3;

interface PendingCrop {
  kinds: InstancedKind[];
  variant: number;
  event: SproutEvent;
  x: number;
  z: number;
  row: number;
  pose: Pose;
  /** sunflower only: glow opacity once planted (mint shines brighter) */
  glowOpacity?: number;
}

export class CropSystem {
  private readonly wheat: InstancedKind[];
  private readonly gourd: InstancedKind[];
  private readonly sunflower: InstancedKind[];
  private readonly scarecrow: InstancedKind[];
  private readonly sunflowerGlows: THREE.Sprite[][];
  private pending: PendingCrop[] = [];
  private wiltUntil = 0;

  constructor(scene: THREE.Scene, glowMap: THREE.Texture) {
    const wheatMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff, // tinted per instance (golden shade variation)
      emissive: FARM.wheatEmissive,
      roughness: 0.8,
    });
    this.wheat = wheatGeometries().map(
      (geometry) => new InstancedKind(scene, geometry, wheatMaterial, CAPS.wheat, 0.07)
    );

    const gourdMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff, // tinted per instance from assetId
      emissive: 0x141008,
      roughness: 0.55,
    });
    this.gourd = gourdGeometries().map(
      (geometry) => new InstancedKind(scene, geometry, gourdMaterial, CAPS.gourd, 0.008)
    );

    const sunflowerMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x33260a,
      roughness: 0.5,
    });
    this.sunflower = sunflowerGeometries().map(
      (geometry) => new InstancedKind(scene, geometry, sunflowerMaterial, CAPS.sunflower, 0.035)
    );

    const scarecrowMaterial = new THREE.MeshStandardMaterial({
      color: FARM.scarecrow,
      roughness: 0.9,
    });
    this.scarecrow = scarecrowGeometries().map(
      (geometry) => new InstancedKind(scene, geometry, scarecrowMaterial, CAPS.scarecrow, 0.012)
    );

    this.sunflowerGlows = this.sunflower.map(() =>
      Array.from({ length: CAPS.sunflower }, () => {
        const sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: glowMap,
            color: FARM.sunflowerPetal,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          })
        );
        scene.add(sprite);
        return sprite;
      })
    );
  }

  private allKinds(): InstancedKind[] {
    return [...this.wheat, ...this.gourd, ...this.sunflower, ...this.scarecrow];
  }

  /** Queue a crop; it sprouts when the tractor has plowed past its spot. */
  plant(event: SproutEvent, row: number, indexInRow: number): void {
    const { x, z } = plantPosition(row, indexInRow, event.coinId);
    // separate hash slice from plantPosition's so pose doesn't correlate with position
    const rand = mulberry32(parseInt(event.coinId.slice(8, 16), 16));
    const variant = Math.floor(rand() * VARIANTS);
    const pose: Pose = {
      height: 1,
      rotY: rand() * Math.PI * 2,
      tiltX: (rand() - 0.5) * 0.14,
      tiltZ: (rand() - 0.5) * 0.14,
      swayPhase: rand() * Math.PI * 2,
    };
    // pose.color must be a fresh Color per crop: pending crops outlive this call
    let kinds: InstancedKind[] = this.wheat;
    let glowOpacity: number | undefined;
    switch (event.kind) {
      case "xch":
        pose.color = new THREE.Color().setHSL(
          0.12 + rand() * 0.03,
          0.55 + rand() * 0.2,
          0.45 + rand() * 0.12
        );
        pose.height = xchHeight(event.amount) * (0.85 + rand() * 0.3);
        kinds = this.wheat;
        break;
      case "cat": {
        const { h } = catColor(event.assetId ?? "0".repeat(64));
        pose.color = new THREE.Color().setHSL(h, 0.6 + rand() * 0.2, 0.48 + rand() * 0.12);
        pose.height = 0.9 + rand() * 0.3;
        pose.width = catWidth(event.amount);
        kinds = this.gourd;
        break;
      }
      case "nft":
        pose.color = new THREE.Color().setHSL(0.13 + rand() * 0.03, 0.85, 0.6 + rand() * 0.1);
        pose.height = (event.mint ? 1.4 : 1) * (0.9 + rand() * 0.25);
        kinds = this.sunflower;
        glowOpacity = event.mint ? 0.9 : 0.5;
        break;
      case "did":
        pose.height = 0.95 + rand() * 0.2;
        kinds = this.scarecrow;
        break;
    }
    this.pending.push({ kinds, variant, event, x, z, row, pose, glowOpacity });
  }

  pendingCount(): number {
    return this.pending.length;
  }

  private release(tractor: Tractor, t: number): void {
    if (this.pending.length === 0) return;
    const keep: PendingCrop[] = [];
    for (const crop of this.pending) {
      if (!tractor.hasPassed(crop.row, crop.x, t)) {
        keep.push(crop);
        continue;
      }
      const index = crop.kinds[crop.variant].plant(crop.event, crop.x, crop.z, t, crop.pose);
      if (crop.glowOpacity !== undefined) {
        const glow = this.sunflowerGlows[crop.variant][index];
        glow.position.set(crop.x, 0.95 * crop.pose.height, crop.z);
        glow.material.opacity = crop.glowOpacity;
        glow.scale.setScalar(crop.glowOpacity > 0.6 ? 2.4 : 1.6);
      }
    }
    this.pending = keep;
  }

  /** Crows make the field flinch: recent crops dip for a couple of seconds. */
  wilt(t: number): void {
    this.wiltUntil = t + 2;
  }

  update(t: number, dt: number, tractor: Tractor): void {
    this.release(tractor, t);
    const remaining = Math.max(0, this.wiltUntil - t);
    const dip =
      remaining > 0 ? 1 - 0.22 * Math.min(1, remaining / 2) * Math.abs(Math.sin(remaining * 5)) : 1;
    for (const kind of this.allKinds()) kind.update(t, dip);
    for (const glows of this.sunflowerGlows) {
      for (const glow of glows) {
        if (glow.material.opacity > 0.5) {
          glow.material.opacity = Math.max(0.5, glow.material.opacity - dt * 0.12);
        }
      }
    }
  }

  pickables(): THREE.Object3D[] {
    return this.allKinds().map((kind) => kind.mesh);
  }

  metaFor(object: THREE.Object3D, instanceId: number | undefined): SproutEvent | null {
    const kind = this.allKinds().find((k) => k.mesh === object);
    return kind ? kind.metaAt(instanceId ?? -1) : null;
  }

  private hovered: { kind: InstancedKind; index: number } | null = null;

  setHovered(object: THREE.Object3D | null, instanceId: number | undefined): void {
    if (this.hovered) {
      this.hovered.kind.setHighlight(this.hovered.index, false);
      this.hovered = null;
    }
    if (!object || instanceId === undefined) return;
    const kind = this.allKinds().find((k) => k.mesh === object);
    if (kind) {
      kind.setHighlight(instanceId, true);
      this.hovered = { kind, index: instanceId };
    }
  }
}
