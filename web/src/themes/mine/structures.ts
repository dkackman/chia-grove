import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { SproutEvent } from "@grove/shared";
import type { XZ } from "../shared/util.js";
import { cellLocal, chunkElevation, type Seat } from "./layout.js";
import { loadArtTexture } from "../gallery/media.js";
import { resolveMedia, thumbnailSrc } from "../../ui/media.js";
import { sensitivePlaceholderTexture } from "../shared/textures.js";
import { LoadPool } from "../shared/load-pool.js";

// Cap concurrent /img fetches. During snapshot replay hundreds of NFTs churn
// through the 40 painting slots in ~3 s; loading every one bursts past the
// proxy's per-IP rate limit (429s). A small cap paces the fetches and — because
// a slot is usually recycled before a queued load reaches the front — collapses
// them to roughly the handful of paintings that actually stay on screen.
const ART_LOAD_CONCURRENCY = 10;
// Safety net for a load that never settles (a stalled fetch, a video whose
// loadedmetadata/seeked/error never fires) — without it, the job would hold
// its LoadPool slot forever, silently shrinking effective concurrency.
const ART_LOAD_TIMEOUT_MS = 20_000;

const VILLAGER_CAP = 80;
const POP_SECONDS = 0.6;
const HOVER_BOOST = 1.6;

/** Blocky villager (robe body, head, big nose) merged into one geometry. */
export function villagerGeometry(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(0.5, 0.7, 0.35);
  body.translate(0, 0.35, 0);
  const head = new THREE.BoxGeometry(0.45, 0.45, 0.45);
  head.translate(0, 0.92, 0);
  const nose = new THREE.BoxGeometry(0.14, 0.28, 0.18);
  nose.translate(0, 0.86, 0.22);
  return mergeGeometries([body, head, nose]);
}

/** Shortest signed angle from `a` to `b`, in (-π, π]. */
export function angleDelta(a: number, b: number): number {
  const d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) return d - Math.PI * 2;
  if (d <= -Math.PI) return d + Math.PI * 2;
  return d;
}

interface Villager {
  meta: SproutEvent | null;
  bornAt: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  phase: number;
}

const WHITE = new THREE.Color(0xffffff);

/**
 * DID villagers — one InstancedMesh for the whole 80-cap pool (one draw call).
 * After popping in they idle: a small hop and a slow turn toward the orbiting
 * camera with a wandering glance. Reduced motion drops the hop and glance and
 * just faces the (static) camera.
 */
export class Villagers {
  readonly mesh: THREE.InstancedMesh;
  private readonly pool: Villager[];
  private next = 0;
  private readonly matrix = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly highlight = new THREE.Color();

  constructor(scene: THREE.Scene) {
    const material = new THREE.MeshStandardMaterial({
      color: 0x7a6a52,
      roughness: 0.9,
      flatShading: true,
    });
    this.mesh = new THREE.InstancedMesh(villagerGeometry(), material, VILLAGER_CAP);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < VILLAGER_CAP; i++) {
      this.mesh.setMatrixAt(i, zero);
      this.mesh.setColorAt(i, WHITE);
    }
    // pin bounds (see InstancedKind): the cached sphere would otherwise be
    // computed while every instance is scale-0 and make every raycast miss
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2, 0), 80);
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.pool = Array.from({ length: VILLAGER_CAP }, () => ({
      meta: null,
      bornAt: 0,
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      phase: 0,
    }));
  }

  plant(event: SproutEvent, chunk: XZ, seat: Seat, t: number): void {
    const i = this.next;
    this.next = (this.next + 1) % VILLAGER_CAP;
    if (i + 1 > this.mesh.count) this.mesh.count = i + 1;
    const v = this.pool[i];
    const local = cellLocal({ col: seat.col, row: seat.row }, seat.layer);
    v.x = chunk.x + local.x;
    v.y = chunkElevation(chunk) + local.y;
    v.z = chunk.z + local.z;
    v.meta = event;
    v.bornAt = t;
    v.phase = (parseInt(event.coinId.slice(0, 6) || "0", 16) % 1000) / 159; // 0..2π-ish
    v.yaw = v.phase;
    this.mesh.setColorAt(i, WHITE); // drop a recycled slot's hover tint
    this.mesh.instanceColor!.needsUpdate = true;
  }

  update(t: number, dt: number, camera: THREE.Camera, reducedMotion: boolean): void {
    let any = false;
    for (let i = 0; i < this.mesh.count; i++) {
      const v = this.pool[i];
      if (!v.meta) continue;
      any = true;
      const p = Math.min((t - v.bornAt) / POP_SECONDS, 1); // pop-in
      // nose is +z, so yaw = atan2(dx, dz) faces the camera
      const face = Math.atan2(camera.position.x - v.x, camera.position.z - v.z);
      if (reducedMotion) {
        v.yaw = face;
      } else {
        const target = face + Math.sin(t * 0.35 + v.phase * 3) * 0.6; // wandering glance
        v.yaw += angleDelta(v.yaw, target) * Math.min(1, dt * 1.5);
      }
      const hop = reducedMotion ? 0 : Math.max(0, Math.sin(t * 1.3 + v.phase * 5)) ** 8 * 0.12;
      this.matrix.compose(
        this.pos.set(v.x, v.y + hop, v.z),
        this.quat.setFromAxisAngle(this.up, v.yaw),
        this.scale.setScalar(p)
      );
      this.mesh.setMatrixAt(i, this.matrix);
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Remove every villager whose event matches (reorg, chunk revisit). */
  clearWhere(predicate: (meta: SproutEvent) => boolean): void {
    let cleared = false;
    this.matrix.makeScale(0, 0, 0);
    for (let i = 0; i < this.pool.length; i++) {
      const v = this.pool[i];
      if (v.meta && predicate(v.meta)) {
        v.meta = null;
        this.mesh.setMatrixAt(i, this.matrix);
        cleared = true;
      }
    }
    if (cleared) this.mesh.instanceMatrix.needsUpdate = true;
  }
  clearAbove(forkHeight: number): void {
    this.clearWhere((m) => m.height >= forkHeight);
  }
  /** Number of live villagers (for tests / debugging). */
  get liveCount(): number {
    return this.pool.filter((v) => v.meta).length;
  }
  pickables(): THREE.Object3D[] {
    return this.pool.some((v) => v.meta) ? [this.mesh] : [];
  }
  metaFor(object: THREE.Object3D, instanceId: number | undefined): SproutEvent | null {
    if (object !== this.mesh || instanceId === undefined) return null;
    return this.pool[instanceId]?.meta ?? null;
  }
  setHighlight(object: THREE.Object3D, instanceId: number | undefined, on: boolean): boolean {
    if (object !== this.mesh || instanceId === undefined || !this.pool[instanceId]?.meta) {
      return false;
    }
    this.mesh.setColorAt(instanceId, on ? this.highlight.setScalar(HOVER_BOOST) : WHITE);
    this.mesh.instanceColor!.needsUpdate = true;
    return true;
  }
}

const PAINTING_CAP = 40;
const FRAME_HALF = 0.65; // half the 1.3-tall frame
const POST_H = 1.0; // easel post height above the seat
const PLACEHOLDER_COLOR = 0x9fb6c9;

interface Painting {
  group: THREE.Group;
  panel: THREE.Mesh;
  post: THREE.Mesh;
  meta: SproutEvent | null;
  /** true when panel.map is this painting's own loaded art (ours to dispose) —
   *  never set for the shared sensitive placeholder */
  ownsMap: boolean;
  /** lazily-held <video> handed back with a thumbnail poster (never played) */
  video?: HTMLVideoElement;
  baseColor: THREE.Color;
  hovered: boolean;
}

/** Stop a <video> and release its decoder/network resources. */
function releaseVideo(video: HTMLVideoElement): void {
  video.pause();
  video.removeAttribute("src");
  video.load();
}

function isVideo(image: unknown): image is HTMLVideoElement {
  return (
    typeof image === "object" &&
    image !== null &&
    typeof (image as HTMLVideoElement).pause === "function"
  );
}

export class Paintings {
  private readonly pool: Painting[];
  /** launcher id -> slot index, so a repeat lineage spend doesn't hang a duplicate */
  private readonly byLauncher = new Map<string, number>();
  private next = 0;
  private readonly loads = new LoadPool(ART_LOAD_CONCURRENCY, ART_LOAD_TIMEOUT_MS);

  constructor(
    scene: THREE.Scene,
    private readonly cap = PAINTING_CAP
  ) {
    const frameGeo = new THREE.BoxGeometry(1.1, 1.3, 0.12);
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x5a3d23,
      roughness: 0.8,
      flatShading: true,
    });
    const panelGeo = new THREE.PlaneGeometry(0.9, 1.1);
    // easel post: a unit-tall box hanging below the frame (top at the frame's
    // lower edge), scaled per painting so its base always reaches the ground
    // even when the painting is seated on a stacked layer
    const postGeo = new THREE.BoxGeometry(0.12, 1, 0.12);
    postGeo.translate(0, -0.5, 0);
    const postMat = new THREE.MeshStandardMaterial({
      color: 0x4a3119,
      roughness: 0.85,
      flatShading: true,
    });
    this.pool = Array.from({ length: cap }, () => {
      const group = new THREE.Group();
      const frame = new THREE.Mesh(frameGeo, frameMat);
      const panel = new THREE.Mesh(
        panelGeo,
        new THREE.MeshBasicMaterial({ color: PLACEHOLDER_COLOR })
      );
      panel.position.z = 0.07;
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.y = -FRAME_HALF;
      post.scale.y = POST_H;
      group.add(frame, panel, post);
      group.visible = false;
      scene.add(group);
      return {
        group,
        panel,
        post,
        meta: null,
        ownsMap: false,
        baseColor: new THREE.Color(PLACEHOLDER_COLOR),
        hovered: false,
      };
    });
  }

  private material(p: Painting): THREE.MeshBasicMaterial {
    return p.panel.material as THREE.MeshBasicMaterial;
  }

  /** Release the slot's own art (texture + any <video>); never the shared placeholder. */
  private releaseArt(p: Painting): void {
    const mat = this.material(p);
    if (p.ownsMap && mat.map) {
      if (isVideo(mat.map.image)) releaseVideo(mat.map.image);
      mat.map.dispose();
    }
    if (p.video) releaseVideo(p.video);
    p.video = undefined;
    p.ownsMap = false;
    mat.map = null;
    mat.needsUpdate = true;
  }

  private setMap(p: Painting, map: THREE.Texture | null, color: number): void {
    const mat = this.material(p);
    mat.map = map;
    p.baseColor.set(color);
    this.paint(p);
    mat.needsUpdate = true;
  }

  private paint(p: Painting): void {
    const c = this.material(p).color.copy(p.baseColor);
    if (p.hovered) c.multiplyScalar(HOVER_BOOST);
    p.group.scale.setScalar(p.hovered ? 1.08 : 1);
  }

  plant(event: SproutEvent, chunk: XZ, seat: Seat): void {
    const slot = this.next;
    const p = this.pool[slot];
    this.next = (this.next + 1) % this.cap;
    // a recycled slot may still own a launcher mapping — drop it before reuse
    if (p.meta?.launcherId && this.byLauncher.get(p.meta.launcherId) === slot) {
      this.byLauncher.delete(p.meta.launcherId);
    }
    const local = cellLocal({ col: seat.col, row: seat.row }, seat.layer);
    // the easel stands on its seat's column top (ground cube top = elevation +
    // 1, plus any layers stacked beneath it) so it never shares space with
    // cubes or villagers; its post stretches down to the ground so a painting
    // left on a recycled stack still reads as planted rather than floating
    const lift = Math.max(0, seat.layer - 1);
    const base = chunkElevation(chunk) + 1 + lift;
    p.group.position.set(chunk.x + local.x, base + POST_H + FRAME_HALF, chunk.z + local.z);
    p.post.scale.y = POST_H + lift;
    p.group.visible = true;
    p.hovered = false;
    p.meta = event;
    if (event.launcherId) this.byLauncher.set(event.launcherId, slot);
    // reset a recycled slot to the placeholder before the (async) art loads,
    // releasing its previous art (VideoTextures keep their decoder alive)
    this.releaseArt(p);
    this.setMap(p, null, PLACEHOLDER_COLOR);
    const media = resolveMedia(event);
    if (media.render === "art") {
      const src = media.src;
      const kind = media.kind;
      const poster = thumbnailSrc(event) ?? undefined;
      this.loads.submit({
        // by the time a queued load reaches the front the slot may have been
        // recycled (replay churns hundreds of NFTs through it) — skip the fetch
        stillWanted: () => p.meta === event,
        start: (done) => {
          loadArtTexture(
            src,
            kind,
            (tex, video) => {
              done(); // free the pool slot regardless of whether we still want the art
              // a slot recycled (or flagged sensitive) while this load was in
              // flight → drop the art instead of leaking it
              if (p.meta !== event) {
                if (isVideo(tex.image)) releaseVideo(tex.image);
                tex.dispose();
                if (video) releaseVideo(video);
                return;
              }
              tex.magFilter = THREE.NearestFilter; // sRGB is set by loadArtTexture
              this.releaseArt(p);
              p.ownsMap = true;
              p.video = video;
              this.setMap(p, tex, 0xffffff);
            },
            done,
            poster
          );
        },
      });
    } else if (media.render === "blur" || media.render === "placeholder") {
      // filtered → neutral placeholder texture; never fetch the real art
      this.setMap(p, sensitivePlaceholderTexture(), 0xffffff);
    }
    // render === "none" → leave the solid placeholder color set above
  }

  /** Face the painting toward the orbiting camera each frame. */
  update(camera: THREE.Camera): void {
    for (const p of this.pool) {
      if (p.meta) p.group.lookAt(camera.position.x, p.group.position.y, camera.position.z);
    }
  }
  /** True if an NFT with this launcher id currently has a painting hung. */
  has(launcherId: string): boolean {
    return this.byLauncher.has(launcherId);
  }

  /** Blur an already-hung painting after a late content-flag. */
  markSensitive(launcherId: string): boolean {
    const slot = this.byLauncher.get(launcherId);
    if (slot === undefined) return false;
    const p = this.pool[slot];
    if (!p?.meta) return false;
    // a new meta object also invalidates any in-flight load for this slot
    p.meta = { ...p.meta, mediaFilter: "sensitive" };
    this.releaseArt(p);
    this.setMap(p, sensitivePlaceholderTexture(), 0xffffff);
    return true;
  }

  /** Take down every painting whose event matches (reorg, chunk revisit). */
  clearWhere(predicate: (meta: SproutEvent) => boolean): void {
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i];
      if (p.meta && predicate(p.meta)) {
        if (p.meta.launcherId && this.byLauncher.get(p.meta.launcherId) === i) {
          this.byLauncher.delete(p.meta.launcherId);
        }
        p.meta = null;
        p.hovered = false;
        p.group.visible = false;
        this.releaseArt(p);
      }
    }
  }
  clearAbove(forkHeight: number): void {
    this.clearWhere((m) => m.height >= forkHeight);
  }
  pickables(): THREE.Object3D[] {
    return this.pool.filter((p) => p.meta).map((p) => p.panel);
  }
  metaFor(object: THREE.Object3D): SproutEvent | null {
    return this.pool.find((p) => p.panel === object)?.meta ?? null;
  }
  /** Hover feedback: brighten the art and nudge the easel forward. */
  setHighlight(object: THREE.Object3D, on: boolean): boolean {
    const p = this.pool.find((q) => q.panel === object);
    if (!p?.meta) return false;
    p.hovered = on;
    this.paint(p);
    return true;
  }
}
