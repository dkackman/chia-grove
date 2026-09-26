import * as THREE from "three";
import type { SproutEvent } from "@grove/shared";
import { mulberry32 } from "../shared/util.js";
import { GALLERY, FRAME_FINISHES } from "./palette.js";
import { WALL, hangSlot, frameSize } from "./layout.js";
import { PictureLights } from "./lights.js";

interface Piece {
  group: THREE.Group;
  image: THREE.Mesh;
  frame: THREE.Mesh;
  mat: THREE.Mesh;
  event: SproutEvent; // latest event seen for this NFT
  eventCount: number; // how many events this NFT has had while on the wall
  bornAt: number; // set on first update() frame, drives the arrival bloom
  heat: number; // activity energy: spikes on a repeat event, cools over time
}

// the art is inset inside a passe-partout and a bevelled moulding; scaling it
// down keeps each framed piece's outer size close to the layout's frameSize so
// the salon grid still breathes
const ART_SCALE = 0.8;
const MOULD_DEPTH = 0.05; // extrusion depth before the bevel
const BEVEL = 0.045; // bevel size (and thickness) of the moulding's edges
const ART_Z = 0.02; // art sits recessed behind the moulding's front face

// shared passe-partout materials (never disposed with a piece)
let ivoryMat: THREE.MeshStandardMaterial | null = null;
let charcoalMat: THREE.MeshStandardMaterial | null = null;
function matMaterial(pale: boolean): THREE.MeshStandardMaterial {
  if (pale) {
    // the lamp overhead lights the mat: emissive tracks the lamp level
    ivoryMat ??= new THREE.MeshStandardMaterial({
      color: GALLERY.matIvory,
      roughness: 1,
      emissive: GALLERY.matIvory,
      emissiveIntensity: 0.3,
    });
    return ivoryMat;
  }
  charcoalMat ??= new THREE.MeshStandardMaterial({ color: GALLERY.matCharcoal, roughness: 0.9 });
  return charcoalMat;
}

function rect(hx: number, hy: number, hole = false): THREE.Path {
  const path = hole ? new THREE.Path() : new THREE.Shape();
  path.moveTo(-hx, -hy);
  if (hole) {
    path.lineTo(-hx, hy);
    path.lineTo(hx, hy);
    path.lineTo(hx, -hy);
  } else {
    path.lineTo(hx, -hy);
    path.lineTo(hx, hy);
    path.lineTo(-hx, hy);
  }
  path.closePath();
  return path;
}

/** Per-piece frame style: moulding finish and width, mat colour and width. */
export function frameStyle(index: number): {
  finish: (typeof FRAME_FINISHES)[number];
  mould: number;
  mat: number;
  paleMat: boolean;
} {
  const rng = mulberry32((index * 2246822519 + 13) >>> 0);
  const total = FRAME_FINISHES.reduce((n, f) => n + f.weight, 0);
  let pick = rng() * total;
  let finish: (typeof FRAME_FINISHES)[number] = FRAME_FINISHES[0];
  for (const f of FRAME_FINISHES) {
    pick -= f.weight;
    if (pick < 0) {
      finish = f;
      break;
    }
  }
  const paleMat = rng() < 0.75;
  return {
    finish,
    mould: 0.1 + rng() * 0.07,
    mat: paleMat ? 0.13 + rng() * 0.1 : 0.04 + rng() * 0.03,
    paleMat,
  };
}

// activity "heat": each repeat event adds energy (stacking, capped) that decays
// over a few seconds, driving a frame glow + scale pop so busy NFTs stand out
const HEAT_PER_EVENT = 0.6;
const HEAT_MAX = 1.5;
const HEAT_COOL = 0.5; // per second
const HEAT_GLOW = 0.3; // emissive intensity per unit of heat
const HEAT_POP = 0.1; // extra scale per unit of heat
// steady emissive on the hovered frame — kept low: a flat emissive washes out
// the moulding's bevel, and the lamp overhead already brightens on hover
const HOVER_GLOW = 0.08;
const HOVER_LAMP = 0.33; // extra lamp glow on the hovered piece

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
  private focused: number | null = null;
  private lights: PictureLights;
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
    this.lights = new PictureLights(scene, cap);
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
    const size = frameSize(index, aspect);
    const w = size.w * ART_SCALE;
    const h = size.h * ART_SCALE;
    const pos = hangSlot(index);
    const style = frameStyle(index);
    const ax = w / 2 + style.mat; // inner edge of the moulding
    const ay = h / 2 + style.mat;
    const ox = ax + style.mould; // outer edge
    const oy = ay + style.mould;

    const group = new THREE.Group();
    group.position.set(pos.x, pos.y, pos.z);

    // bevelled moulding: a rectangular ring extruded with rounded bevels on
    // both edges, so the picture-light catches a highlight along the top rail.
    // The bevel grows the ring outward on both contours; inset them to match.
    const shape = rect(ox - BEVEL, oy - BEVEL) as THREE.Shape;
    shape.holes.push(rect(ax + BEVEL, ay + BEVEL, true));
    const frameGeo = new THREE.ExtrudeGeometry(shape, {
      depth: MOULD_DEPTH,
      bevelEnabled: true,
      bevelThickness: BEVEL,
      bevelSize: BEVEL,
      bevelSegments: 2,
      curveSegments: 1,
    });
    // per-piece frame material so hover and activity heat can glow one frame
    // at a time (emissive starts dark, lit up in update())
    const frame = new THREE.Mesh(
      frameGeo,
      new THREE.MeshStandardMaterial({
        color: style.finish.color,
        roughness: style.finish.roughness,
        metalness: style.finish.metalness,
        emissive: GALLERY.spot,
        emissiveIntensity: 0,
      })
    );
    frame.position.z = -MOULD_DEPTH / 2;

    // passe-partout: a flat ring between the moulding and the art
    const matShape = rect(ax + 0.01, ay + 0.01) as THREE.Shape;
    matShape.holes.push(rect(w / 2, h / 2, true));
    const mat = new THREE.Mesh(new THREE.ShapeGeometry(matShape), matMaterial(style.paleMat));
    mat.position.z = ART_Z - 0.004;

    const image = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })
    );
    image.position.z = ART_Z;
    group.add(frame, mat, image);
    this.scene.add(group);
    this.lights.place(slotId, pos.x, pos.y, ox, oy);

    const piece: Piece = { group, image, frame, mat, event, eventCount: 1, bornAt: -1, heat: 0 };
    this.slots[slotId] = piece;
    this.byObject.set(frame, slotId);
    this.byObject.set(mat, slotId);
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
    this.byObject.delete(old.mat);
    this.byObject.delete(old.image);
    this.lights.clear(slotId);
    if (old.event.launcherId && this.byLauncher.get(old.event.launcherId) === slotId) {
      this.byLauncher.delete(old.event.launcherId);
    }
    this.scene.remove(old.group);
    old.frame.geometry.dispose();
    (old.frame.material as THREE.Material).dispose();
    old.mat.geometry.dispose(); // its material is shared
    old.image.geometry.dispose();
    const mat = old.image.material as THREE.MeshBasicMaterial;
    this.releaseVideo(slotId, mat);
    mat.map?.dispose();
    mat.dispose();
    // drop a stale hover pointer so the next piece to occupy this slot isn't
    // mistakenly shown as hovered
    if (this.hovered === slotId) this.hovered = null;
    if (this.focused === slotId) this.focused = null;
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
    // frame the whole piece — moulding included — not just the art
    const geo = piece.frame.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const height = geo.boundingBox!.max.y - geo.boundingBox!.min.y;
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

  /** The piece the camera is framing: its picture-light stays up while the room dims. */
  setFocused(object: THREE.Object3D | null): void {
    this.focused = object ? (this.byObject.get(object) ?? null) : null;
  }

  /** Room-level picture-light brightness (live level, and the undimmed rest level). */
  setLightLevel(intensity: number, rest: number): void {
    this.lights.setLevel(intensity, rest);
    matMaterial(true).emissiveIntensity = 0.1 + intensity * 0.3;
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

      const hover = this.hovered === i ? HOVER_GLOW : 0;
      const mat = piece.frame.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = Math.min(0.55, hover + piece.heat * HEAT_GLOW);
      // the lamp over a busy or hovered piece brightens with it
      this.lights.setGlow(
        i,
        piece.heat * 0.5 + (this.hovered === i ? HOVER_LAMP : 0),
        this.focused === i
      );
    }
  }
}
