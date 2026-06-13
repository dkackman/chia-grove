import * as THREE from "three";
import type { SproutEvent } from "@grove/shared";
import { GALLERY } from "./palette.js";
import { hangSlot, frameSize } from "./layout.js";

interface Piece {
  group: THREE.Group;
  image: THREE.Mesh;
  frame: THREE.Mesh;
  event: SproutEvent;
  bornAt: number;
}

const FRAME_DEPTH = 0.12;
const BORDER = 0.18;

/** Pool of framed art pieces hung along the wall; slots wrap at `cap`. */
export class Pieces {
  private slots: Array<Piece | null>;
  private byObject = new Map<THREE.Object3D, number>();
  private next = 0; // total pieces ever added (also the hangSlot index)
  private hovered: number | null = null;
  private frameMat: THREE.MeshStandardMaterial;
  private frameHoverMat: THREE.MeshStandardMaterial;

  constructor(
    private scene: THREE.Scene,
    private cap = 28
  ) {
    this.slots = new Array(cap).fill(null);
    this.frameMat = new THREE.MeshStandardMaterial({ color: GALLERY.frame, roughness: 0.6 });
    this.frameHoverMat = new THREE.MeshStandardMaterial({
      color: GALLERY.frameHover,
      emissive: GALLERY.spot,
      emissiveIntensity: 0.25,
      roughness: 0.5,
    });
  }

  add(event: SproutEvent, texture: THREE.Texture): void {
    const index = this.next++;
    const slotId = index % this.cap;
    this.retire(slotId);

    const img = texture.image as { width?: number; height?: number } | undefined;
    const aspect = img && img.width && img.height ? img.width / img.height : 1;
    const { w, h } = frameSize(index, aspect);
    const pos = hangSlot(index);

    const group = new THREE.Group();
    group.position.set(pos.x, pos.y, pos.z);

    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(w + BORDER * 2, h + BORDER * 2, FRAME_DEPTH),
      this.frameMat
    );
    const image = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })
    );
    image.position.z = FRAME_DEPTH / 2 + 0.001;
    group.add(frame, image);
    this.scene.add(group);

    const piece: Piece = { group, image, frame, event, bornAt: -1 };
    this.slots[slotId] = piece;
    this.byObject.set(frame, slotId);
    this.byObject.set(image, slotId);
  }

  private retire(slotId: number): void {
    const old = this.slots[slotId];
    if (!old) return;
    this.byObject.delete(old.frame);
    this.byObject.delete(old.image);
    this.scene.remove(old.group);
    old.frame.geometry.dispose();
    old.image.geometry.dispose();
    const mat = old.image.material as THREE.MeshBasicMaterial;
    mat.map?.dispose();
    mat.dispose();
    this.slots[slotId] = null;
  }

  /** Remove pieces minted at or above the fork height (those spends were undone). */
  removeRecent(forkHeight: number): number {
    let removed = 0;
    for (let i = 0; i < this.cap; i++) {
      const piece = this.slots[i];
      if (piece && piece.event.height >= forkHeight) {
        this.retire(i);
        removed++;
      }
    }
    return removed;
  }

  count(): number {
    return this.slots.reduce((n, s) => n + (s ? 1 : 0), 0);
  }

  newestX(): number {
    return hangSlot(Math.max(0, this.next - 1)).x;
  }

  pickables(): THREE.Object3D[] {
    return [...this.byObject.keys()];
  }

  metaFor(object: THREE.Object3D): SproutEvent | null {
    const slotId = this.byObject.get(object);
    return slotId === undefined ? null : (this.slots[slotId]?.event ?? null);
  }

  /** Where to fly the camera to frame a clicked piece. */
  focusOf(object: THREE.Object3D): { center: THREE.Vector3; height: number } | null {
    const slotId = this.byObject.get(object);
    if (slotId === undefined) return null;
    const piece = this.slots[slotId];
    if (!piece) return null;
    const geo = piece.image.geometry as THREE.PlaneGeometry;
    const height = geo.parameters.height;
    return { center: piece.group.position.clone(), height };
  }

  setHovered(object: THREE.Object3D | null): void {
    const slotId = object ? (this.byObject.get(object) ?? null) : null;
    if (slotId === this.hovered) return;
    if (this.hovered !== null && this.slots[this.hovered]) {
      this.slots[this.hovered]!.frame.material = this.frameMat;
    }
    this.hovered = slotId;
    if (slotId !== null && this.slots[slotId]) {
      this.slots[slotId]!.frame.material = this.frameHoverMat;
    }
  }

  /** Arrival "new" pulse on freshly-added pieces. */
  update(t: number): void {
    for (const piece of this.slots) {
      if (!piece) continue;
      if (piece.bornAt < 0) piece.bornAt = t;
      const age = t - piece.bornAt;
      const pulse = age < 1 ? 1 + (1 - age) * 0.12 : 1;
      piece.group.scale.setScalar(pulse);
    }
  }
}
