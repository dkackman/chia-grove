import * as THREE from "three";
import type { SproutEvent } from "@grove/shared";
import { GALLERY } from "./palette.js";
import { WALL, hangSlot, frameSize } from "./layout.js";

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
  // launcherId -> placeholder for a content-flag that arrived while the art was
  // still loading (nothing hung yet to blur) — applied when add() lands it.
  private pendingSensitive = new Map<string, THREE.Texture>();
  private next = 0; // total pieces ever added (also the hangSlot index)
  private hovered: number | null = null;
  // Lazily-held video elements for thumbnail-poster pieces. When a video NFT
  // is displayed as a static thumbnail, the <video> lives here (preload=none)
  // until the user clicks play, at which point swapToVideo() replaces the
  // static texture with a VideoTexture and removes the entry from this map.
  private videoBySlot = new Map<number, HTMLVideoElement>();

  constructor(
    private scene: THREE.Scene,
    private cap = 56
  ) {
    this.slots = new Array(cap).fill(null);
  }

  add(event: SproutEvent, texture: THREE.Texture, video?: HTMLVideoElement): void {
    // a content-flag beat the art to the wall (common for slower-loading video
    // NFTs) — hang the remembered placeholder instead of the now-stale art
    const flagged = event.launcherId ? this.pendingSensitive.get(event.launcherId) : undefined;
    if (flagged) {
      this.pendingSensitive.delete(event.launcherId!);
      texture.dispose();
      if (video) {
        video.pause();
        video.removeAttribute("src");
        video.load();
      }
      event = { ...event, mediaFilter: "sensitive" };
      texture = flagged;
      video = undefined;
    }
    const index = this.next++;
    const slotId = index % this.cap;
    this.retire(slotId);

    // a still image exposes width/height; a video element exposes
    // videoWidth/videoHeight (its width/height attributes are usually 0)
    const media = texture.image as
      { width?: number; height?: number; videoWidth?: number; videoHeight?: number } | undefined;
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
    if (video) this.videoBySlot.set(slotId, video);
  }

  /** Slot count: at most this many pieces hang before the oldest wraps off. */
  get capacity(): number {
    return this.cap;
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

  /**
   * Stop and release whichever video is backing this slot — the lazily-held
   * pre-play element (thumbnail-poster path), or (after swapToVideo) the one
   * the current texture wraps (VideoTexture after a swap, or the legacy seek
   * path). A slot can only ever have one or the other live at a time, but a
   * caller may not know which.
   */
  private releaseVideo(slotId: number, mat: THREE.MeshBasicMaterial): void {
    const lazyVideo = this.videoBySlot.get(slotId);
    if (lazyVideo) {
      lazyVideo.pause();
      lazyVideo.removeAttribute("src");
      lazyVideo.load();
      this.videoBySlot.delete(slotId);
    }
    const media = mat.map?.image as
      | { pause?: () => void; removeAttribute?: (name: string) => void; load?: () => void }
      | undefined;
    if (media && typeof media.pause === "function") {
      media.pause();
      media.removeAttribute?.("src");
      media.load?.();
    }
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
    this.releaseVideo(slotId, mat);
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
    if (this.next === 0) return 0;
    const rows = WALL.rows;
    const lastIdx = this.next - 1;
    const rowInCol = lastIdx % rows;
    // snap to the last *complete* column so the camera doesn't trail an
    // incomplete column and show empty row slots on the right edge
    const completedThrough = rowInCol === rows - 1 ? lastIdx : lastIdx - rowInCol - 1;
    return hangSlot(Math.max(0, completedThrough)).x;
  }

  pickables(): THREE.Object3D[] {
    return [...this.byObject.keys()];
  }

  metaFor(object: THREE.Object3D): SproutEvent | null {
    const slotId = this.byObject.get(object);
    return slotId === undefined ? null : (this.slots[slotId]?.event ?? null);
  }

  /**
   * The <video> element backing the piece under this object, or null when the
   * piece is image- or placeholder-backed. Checks the explicit videoBySlot map
   * first (thumbnail-poster path where the video is held lazily) then falls back
   * to duck-typing the texture image (VideoTexture seek path). Blocked/sensitive
   * pieces hang a placeholder texture and return null.
   */
  videoFor(object: THREE.Object3D): HTMLVideoElement | null {
    const slotId = this.byObject.get(object);
    if (slotId === undefined) return null;
    // Explicit video registered by add() for the thumbnail-poster case
    const explicit = this.videoBySlot.get(slotId);
    if (explicit) return explicit;
    // Legacy: VideoTexture whose image IS the video element
    const piece = this.slots[slotId];
    if (!piece) return null;
    const img = (piece.image.material as THREE.MeshBasicMaterial).map?.image as
      { play?: unknown } | undefined;
    return img && typeof img.play === "function" ? (img as HTMLVideoElement) : null;
  }

  /**
   * Replace the static thumbnail texture with a live VideoTexture so playback
   * becomes visible on the gallery wall. Called the first time the user clicks
   * play on a thumbnail-poster piece. The entry is removed from videoBySlot so
   * retire() finds the video via the VideoTexture duck-type path instead.
   */
  swapToVideo(object: THREE.Object3D, video: HTMLVideoElement): void {
    const slotId = this.byObject.get(object);
    if (slotId === undefined) return;
    const piece = this.slots[slotId];
    if (!piece) return;
    const mat = piece.image.material as THREE.MeshBasicMaterial;
    if (mat.map instanceof THREE.VideoTexture) return; // already swapped
    const old = mat.map;
    mat.map = new THREE.VideoTexture(video);
    mat.needsUpdate = true;
    old?.dispose();
    // Remove from explicit map — retire() will now find the video via duck-type
    this.videoBySlot.delete(slotId);
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

  /**
   * Blur an already-hung NFT after a late content-flag: hang the neutral
   * placeholder. If the NFT isn't hung yet (its art is still loading), the
   * placeholder is remembered and applied by add() once the art lands instead.
   */
  markSensitive(launcherId: string, placeholder: THREE.Texture): boolean {
    const slotId = this.byLauncher.get(launcherId);
    const piece = slotId === undefined ? null : this.slots[slotId];
    if (slotId === undefined || !piece) {
      this.pendingSensitive.get(launcherId)?.dispose(); // drop a stale earlier flag
      this.pendingSensitive.set(launcherId, placeholder);
      return false;
    }
    piece.event = { ...piece.event, mediaFilter: "sensitive" };
    const mat = piece.image.material as THREE.MeshBasicMaterial;
    // Release whichever video is backing this slot so it can't keep playing
    // (or be resumed) after flagging, whether it's still the lazy pre-play
    // element or has already been swapped to a live VideoTexture.
    this.releaseVideo(slotId, mat);
    (mat.map as THREE.Texture | null)?.dispose();
    mat.map = placeholder;
    mat.color.set(0xffffff);
    mat.needsUpdate = true;
    return true;
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
