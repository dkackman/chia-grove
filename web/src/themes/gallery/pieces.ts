import * as THREE from "three";
import type { SproutEvent } from "@grove/shared";
import { GALLERY } from "./palette.js";
import { hangSlot, frameSize } from "./layout.js";

interface Piece {
  group: THREE.Group;
  image: THREE.Mesh;
  frame: THREE.Mesh;
  event: SproutEvent; // latest event seen for this NFT
  eventCount: number; // how many events this NFT has had while on the wall
  bornAt: number; // set on first update() frame, drives the arrival bloom
  heat: number; // activity energy: spikes on a repeat event, cools over time
}

const FRAME_DEPTH = 0.12;
const BORDER = 0.18;

// activity "heat": each repeat event adds energy (stacking, capped) that decays
// over a few seconds, driving a frame glow + scale pop so busy NFTs stand out
const HEAT_PER_EVENT = 0.6;
const HEAT_MAX = 1.5;
const HEAT_COOL = 0.5; // per second
const HEAT_GLOW = 0.7; // emissive intensity per unit of heat
const HEAT_POP = 0.1; // extra scale per unit of heat
const HOVER_GLOW = 0.22; // steady emissive on the hovered frame

/**
 * Pool of framed art pieces hung along the wall; slots wrap at `cap`. Each NFT
 * appears once (deduped by launcherId); a repeat event re-uses its frame and
 * adds activity heat rather than hanging a duplicate.
 */
export class Pieces {
  private slots: Array<Piece | null>;
  private byObject = new Map<THREE.Object3D, number>();
  private byLauncher = new Map<string, number>();
  private next = 0; // total pieces ever added (also the hangSlot index)
  private hovered: number | null = null;

  constructor(
    private scene: THREE.Scene,
    private cap = 28
  ) {
    this.slots = new Array(cap).fill(null);
  }

  add(event: SproutEvent, texture: THREE.Texture): void {
    const index = this.next++;
    const slotId = index % this.cap;
    this.retire(slotId);

    // a still image exposes width/height; a video element exposes
    // videoWidth/videoHeight (its width/height attributes are usually 0)
    const media = texture.image as
      | { width?: number; height?: number; videoWidth?: number; videoHeight?: number }
      | undefined;
    const mw = media?.videoWidth || media?.width;
    const mh = media?.videoHeight || media?.height;
    const aspect = mw && mh ? mw / mh : 1;
    const { w, h } = frameSize(index, aspect);
    const pos = hangSlot(index);

    const group = new THREE.Group();
    group.position.set(pos.x, pos.y, pos.z);

    // per-piece frame material so hover and activity heat can glow one frame
    // at a time (emissive starts dark, lit up in update())
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(w + BORDER * 2, h + BORDER * 2, FRAME_DEPTH),
      new THREE.MeshStandardMaterial({
        color: GALLERY.frame,
        emissive: GALLERY.spot,
        emissiveIntensity: 0,
        roughness: 0.6,
      })
    );
    const image = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })
    );
    image.position.z = FRAME_DEPTH / 2 + 0.001;
    group.add(frame, image);
    this.scene.add(group);

    const piece: Piece = { group, image, frame, event, eventCount: 1, bornAt: -1, heat: 0 };
    this.slots[slotId] = piece;
    this.byObject.set(frame, slotId);
    this.byObject.set(image, slotId);
    if (event.launcherId) this.byLauncher.set(event.launcherId, slotId);
  }

  /** True if the NFT with this launcherId is currently hung. */
  hasLauncher(launcherId: string): boolean {
    return this.byLauncher.has(launcherId);
  }

  /**
   * Record a repeat event for an already-hung NFT: refresh its latest event,
   * bump its count, and add activity heat. Returns false if it isn't on the wall.
   */
  ping(event: SproutEvent): boolean {
    const launcher = event.launcherId;
    if (!launcher) return false;
    const slotId = this.byLauncher.get(launcher);
    if (slotId === undefined) return false;
    const piece = this.slots[slotId];
    if (!piece) return false;
    piece.event = event;
    piece.eventCount += 1;
    piece.heat = Math.min(HEAT_MAX, piece.heat + HEAT_PER_EVENT);
    return true;
  }

  private retire(slotId: number): void {
    const old = this.slots[slotId];
    if (!old) return;
    this.byObject.delete(old.frame);
    this.byObject.delete(old.image);
    if (old.event.launcherId && this.byLauncher.get(old.event.launcherId) === slotId) {
      this.byLauncher.delete(old.event.launcherId);
    }
    this.scene.remove(old.group);
    old.frame.geometry.dispose();
    (old.frame.material as THREE.Material).dispose();
    old.image.geometry.dispose();
    const mat = old.image.material as THREE.MeshBasicMaterial;
    // if the texture is a VideoTexture, stop and release its <video> element so
    // a wrapped-out or reorg-removed clip doesn't keep downloading/looping
    const media = mat.map?.image as
      | { pause?: () => void; removeAttribute?: (name: string) => void; load?: () => void }
      | undefined;
    if (media && typeof media.pause === "function") {
      media.pause();
      media.removeAttribute?.("src");
      media.load?.();
    }
    mat.map?.dispose();
    mat.dispose();
    // drop a stale hover pointer so the next piece to occupy this slot isn't
    // mistakenly shown as hovered
    if (this.hovered === slotId) this.hovered = null;
    this.slots[slotId] = null;
  }

  /** Remove pieces at or above the fork height (those spends were undone). */
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

  /** How many events the NFT under this object has accumulated on the wall. */
  eventCountFor(object: THREE.Object3D): number {
    const slotId = this.byObject.get(object);
    if (slotId === undefined) return 0;
    return this.slots[slotId]?.eventCount ?? 0;
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
    this.hovered = object ? (this.byObject.get(object) ?? null) : null;
  }

  /** Per-frame: arrival bloom, decaying activity heat, and hover glow. */
  update(t: number, dt: number): void {
    for (let i = 0; i < this.cap; i++) {
      const piece = this.slots[i];
      if (!piece) continue;
      if (piece.bornAt < 0) piece.bornAt = t;

      piece.heat = Math.max(0, piece.heat - dt * HEAT_COOL);

      const age = t - piece.bornAt;
      const bloom = age < 1 ? (1 - age) * 0.12 : 0;
      piece.group.scale.setScalar(1 + bloom + piece.heat * HEAT_POP);

      const mat = piece.frame.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = Math.min(
        1.3,
        (this.hovered === i ? HOVER_GLOW : 0) + piece.heat * HEAT_GLOW
      );
    }
  }
}
