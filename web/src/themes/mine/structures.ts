import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { SproutEvent } from "@grove/shared";
import type { XZ } from "../shared/util.js";
import { cellLocal, chunkElevation } from "./layout.js";
import { loadArtTexture } from "../gallery/media.js";
import { resolveMedia } from "../../ui/media.js";
import { sensitivePlaceholderTexture } from "../shared/textures.js";
import { LoadPool } from "../shared/load-pool.js";

// Cap concurrent /img fetches. During snapshot replay hundreds of NFTs churn
// through the 40 painting slots in ~3 s; loading every one bursts past the
// proxy's per-IP rate limit (429s). A small cap paces the fetches and — because
// a slot is usually recycled before a queued load reaches the front — collapses
// them to roughly the handful of paintings that actually stay on screen.
const ART_LOAD_CONCURRENCY = 10;

const VILLAGER_CAP = 80;

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

interface Villager {
  mesh: THREE.Mesh;
  meta: SproutEvent | null;
  bornAt: number;
}

export class Villagers {
  private readonly pool: Villager[];
  private next = 0;
  private readonly group = new THREE.Group();

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    const geometry = villagerGeometry();
    const material = new THREE.MeshStandardMaterial({
      color: 0x7a6a52,
      roughness: 0.9,
      flatShading: true,
    });
    this.pool = Array.from({ length: VILLAGER_CAP }, () => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      this.group.add(mesh);
      return { mesh, meta: null, bornAt: 0 };
    });
  }

  plant(
    event: SproutEvent,
    chunk: XZ,
    seat: { col: number; row: number; layer: number },
    t: number
  ): void {
    const v = this.pool[this.next];
    this.next = (this.next + 1) % VILLAGER_CAP;
    const local = cellLocal({ col: seat.col, row: seat.row }, seat.layer);
    v.mesh.position.set(chunk.x + local.x, chunkElevation(chunk) + local.y, chunk.z + local.z);
    v.mesh.scale.setScalar(0); // start collapsed so the pop-in grows from nothing
    v.mesh.visible = true;
    v.meta = event;
    v.bornAt = t;
  }

  update(t: number): void {
    for (const v of this.pool) {
      if (!v.meta) continue;
      const p = Math.min((t - v.bornAt) / 0.6, 1);
      v.mesh.scale.setScalar(p); // pop-in
    }
  }
  clearAbove(forkHeight: number): void {
    for (const v of this.pool) {
      if (v.meta && v.meta.height >= forkHeight) {
        v.meta = null;
        v.mesh.visible = false;
      }
    }
  }
  pickables(): THREE.Object3D[] {
    return this.pool.filter((v) => v.meta).map((v) => v.mesh);
  }
  metaFor(object: THREE.Object3D): SproutEvent | null {
    return this.pool.find((v) => v.mesh === object)?.meta ?? null;
  }
}

const PAINTING_CAP = 40;
const FRAME_HALF = 0.65; // half the 1.3-tall frame
const POST_H = 1.0; // easel post height above the ground surface

interface Painting {
  group: THREE.Group;
  panel: THREE.Mesh;
  meta: SproutEvent | null;
}

export class Paintings {
  private readonly pool: Painting[];
  /** launcher id -> slot index, so a repeat lineage spend doesn't hang a duplicate */
  private readonly byLauncher = new Map<string, number>();
  private next = 0;
  private readonly loads = new LoadPool(ART_LOAD_CONCURRENCY);

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
    // easel post: hangs below the frame (group origin = frame centre) so its base
    // reaches the ground, making the painting read as planted on land, not floating
    const postGeo = new THREE.BoxGeometry(0.12, POST_H, 0.12);
    postGeo.translate(0, -(FRAME_HALF + POST_H / 2), 0);
    const postMat = new THREE.MeshStandardMaterial({
      color: 0x4a3119,
      roughness: 0.85,
      flatShading: true,
    });
    this.pool = Array.from({ length: cap }, () => {
      const group = new THREE.Group();
      const frame = new THREE.Mesh(frameGeo, frameMat);
      const panel = new THREE.Mesh(panelGeo, new THREE.MeshBasicMaterial({ color: 0x9fb6c9 }));
      panel.position.z = 0.07;
      const post = new THREE.Mesh(postGeo, postMat);
      group.add(frame, panel, post);
      group.visible = false;
      scene.add(group);
      return { group, panel, meta: null };
    });
  }

  plant(event: SproutEvent, chunk: XZ, seat: { col: number; row: number; layer: number }): void {
    const slot = this.next;
    const p = this.pool[slot];
    this.next = (this.next + 1) % this.cap;
    // a recycled slot may still own a launcher mapping — drop it before reuse
    if (p.meta?.launcherId && this.byLauncher.get(p.meta.launcherId) === slot) {
      this.byLauncher.delete(p.meta.launcherId);
    }
    const local = cellLocal({ col: seat.col, row: seat.row }, seat.layer);
    // stand the easel on the ground surface (ground cube top = elevation + 1),
    // independent of the seat layer so paintings never float up in mid-air
    const groundTop = chunkElevation(chunk) + 1;
    p.group.position.set(chunk.x + local.x, groundTop + POST_H + FRAME_HALF, chunk.z + local.z);
    p.group.visible = true;
    p.meta = event;
    if (event.launcherId) this.byLauncher.set(event.launcherId, slot);
    // reset a recycled slot to the placeholder before the (async) art loads
    const mat = p.panel.material as THREE.MeshBasicMaterial;
    mat.map = null;
    mat.color.set(0x9fb6c9);
    mat.needsUpdate = true;
    const media = resolveMedia(event);
    if (media.render === "art") {
      const src = media.src;
      const kind = media.kind;
      this.loads.submit({
        // by the time a queued load reaches the front the slot may have been
        // recycled (replay churns hundreds of NFTs through it) — skip the fetch
        stillWanted: () => p.meta === event,
        start: (done) => {
          loadArtTexture(
            src,
            kind,
            (tex) => {
              done(); // free the pool slot regardless of whether we still want the art
              // guard against a slot recycled while this load was in flight
              if (p.meta !== event) return;
              tex.magFilter = THREE.NearestFilter;
              tex.colorSpace = THREE.SRGBColorSpace;
              mat.map = tex;
              mat.color.set(0xffffff);
              mat.needsUpdate = true;
            },
            done
          );
        },
      });
    } else if (media.render === "blur" || media.render === "placeholder") {
      // filtered → neutral placeholder texture; never fetch the real art
      mat.map = sensitivePlaceholderTexture();
      mat.color.set(0xffffff);
      mat.needsUpdate = true;
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
  clearAbove(forkHeight: number): void {
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i];
      if (p.meta && p.meta.height >= forkHeight) {
        if (p.meta.launcherId && this.byLauncher.get(p.meta.launcherId) === i) {
          this.byLauncher.delete(p.meta.launcherId);
        }
        p.meta = null;
        p.group.visible = false;
      }
    }
  }
  pickables(): THREE.Object3D[] {
    return this.pool.filter((p) => p.meta).map((p) => p.panel);
  }
  metaFor(object: THREE.Object3D): SproutEvent | null {
    return this.pool.find((p) => p.panel === object)?.meta ?? null;
  }
}
