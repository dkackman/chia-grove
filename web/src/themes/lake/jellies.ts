import * as THREE from "three";
import type { SproutEvent } from "@grove/shared";
import { resolveMedia, thumbnailSrc } from "../../ui/media.js";
import { loadArtTexture } from "../gallery/media.js";
import { LoadPool } from "../shared/load-pool.js";
import { sensitivePlaceholderTexture } from "../shared/textures.js";
import { bandDepth, seatOffset } from "./layout.js";
import { LAKE } from "./palette.js";

const JELLY_CAP = 40;
const PLACEHOLDER = 0x9fb6c9;

/** The bell: a dome, open underneath, with the art panel hanging inside it. */
export function bellGeometry(): THREE.SphereGeometry {
  return new THREE.SphereGeometry(0.95, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
}

interface Jelly {
  group: THREE.Group;
  panel: THREE.Mesh;
  bell: THREE.Mesh;
  meta: SproutEvent | null;
  bornBlock: number;
  radius: number;
  angle: number;
  speed: number;
  bob: number;
}

/**
 * NFT mints as drifting jellyfish. Structurally this is `mine`'s `Paintings`
 * with different geometry, and the machinery it carries over is all load-bearing:
 *
 * - byLauncher dedupe, because a mint arrives as an eve plus a lineage spend and
 *   transfers spend the NFT again — without it one NFT hangs several jellyfish.
 * - LoadPool with a stillWanted guard, because the snapshot replay churns
 *   hundreds of NFTs through this small pool in a couple of seconds; fetching
 *   art for slots that were recycled before anyone saw them bursts past the /img
 *   proxy's rate limit.
 * - resolveMedia for every render decision, so content filtering is uniform by
 *   construction: blocked and sensitive art is never fetched, only placeheld.
 */
export class Jellies {
  private readonly pool: Jelly[];
  private next = 0;
  private readonly byLauncher = new Map<string, number>();
  private readonly loads = new LoadPool(3, 15000);

  constructor(
    scene: THREE.Scene,
    private readonly cap = JELLY_CAP
  ) {
    const bellGeo = bellGeometry();
    const panelGeo = new THREE.PlaneGeometry(0.9, 0.9);
    const tentacleGeo = new THREE.BoxGeometry(0.05, 1.5, 0.05);
    tentacleGeo.translate(0, -0.75, 0);

    this.pool = Array.from({ length: cap }, () => {
      const group = new THREE.Group();
      const bell = new THREE.Mesh(
        bellGeo,
        new THREE.MeshStandardMaterial({
          color: LAKE.jelly,
          transparent: true,
          opacity: 0.42,
          roughness: 0.25,
          emissive: new THREE.Color(LAKE.jelly),
          emissiveIntensity: 0.35,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      );
      // the art hangs inside the bell, billboarded to the camera each frame
      const panel = new THREE.Mesh(
        panelGeo,
        new THREE.MeshBasicMaterial({ color: PLACEHOLDER, side: THREE.DoubleSide })
      );
      panel.position.y = -0.25;
      const tentacleMat = new THREE.MeshStandardMaterial({
        color: LAKE.jelly,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
      });
      group.add(bell, panel);
      for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2;
        const tentacle = new THREE.Mesh(tentacleGeo, tentacleMat);
        tentacle.position.set(Math.cos(angle) * 0.55, -0.1, Math.sin(angle) * 0.55);
        group.add(tentacle);
      }
      group.visible = false;
      scene.add(group);
      return {
        group,
        panel,
        bell,
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
    const j = this.pool[slot];
    this.next = (this.next + 1) % this.cap;
    // a recycled slot may still own a launcher mapping — drop it before reuse
    if (j.meta?.launcherId && this.byLauncher.get(j.meta.launcherId) === slot) {
      this.byLauncher.delete(j.meta.launcherId);
    }

    const seat = seatOffset(event.coinId);
    j.meta = event;
    j.bornBlock = bornBlock;
    // jellyfish drift on a tighter, slower circuit than the fish
    j.radius = seat.radius * 0.8;
    j.angle = seat.angle;
    j.speed = seat.speed * 0.35;
    j.bob = seat.bob;
    j.group.visible = true;
    if (event.launcherId) this.byLauncher.set(event.launcherId, slot);

    // reset a recycled slot to the placeholder before the (async) art loads
    const mat = j.panel.material as THREE.MeshBasicMaterial;
    mat.map = null;
    mat.color.set(PLACEHOLDER);
    mat.needsUpdate = true;

    const media = resolveMedia(event);
    if (media.render === "art") {
      const src = media.src;
      const kind = media.kind;
      const poster = thumbnailSrc(event) ?? undefined;
      this.loads.submit({
        // by the time a queued load reaches the front the slot may have been
        // recycled (replay churns hundreds of NFTs through it) — skip the fetch
        stillWanted: () => j.meta === event,
        start: (done) => {
          loadArtTexture(
            src,
            kind,
            (tex) => {
              done(); // free the pool slot regardless of whether we still want it
              if (j.meta !== event) return; // slot recycled mid-flight
              tex.colorSpace = THREE.SRGBColorSpace;
              mat.map = tex;
              mat.color.set(0xffffff);
              mat.needsUpdate = true;
            },
            done,
            poster
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

  update(camera: THREE.Camera, t: number, blocksSeen: number): void {
    for (const j of this.pool) {
      if (!j.meta) continue;
      const angle = j.angle + t * j.speed;
      j.group.position.set(
        Math.cos(angle) * j.radius,
        bandDepth(blocksSeen - j.bornBlock) + Math.sin(t * 0.5 + j.bob) * 0.5,
        Math.sin(angle) * j.radius
      );
      // pulse the bell; the panel keeps its own scale so the art never squashes
      const pulse = 1 + Math.sin(t * 1.4 + j.bob) * 0.12;
      j.bell.scale.set(pulse, 2 - pulse, pulse);
      // same-Y lookAt is a pure yaw, so the dome stays upright while the art
      // panel turns to face the camera — the trick `Paintings.update` uses
      j.group.lookAt(camera.position.x, j.group.position.y, camera.position.z);
    }
  }

  /** True if an NFT with this launcher id already has a jellyfish. */
  has(launcherId: string): boolean {
    return this.byLauncher.has(launcherId);
  }

  /** Blur an already-drifting jellyfish after a late content flag. */
  markSensitive(launcherId: string): boolean {
    const slot = this.byLauncher.get(launcherId);
    if (slot === undefined) return false;
    const j = this.pool[slot];
    if (!j?.meta) return false;
    j.meta = { ...j.meta, mediaFilter: "sensitive" };
    const mat = j.panel.material as THREE.MeshBasicMaterial;
    mat.map = sensitivePlaceholderTexture();
    mat.color.set(0xffffff);
    mat.needsUpdate = true;
    return true;
  }

  clearAbove(forkHeight: number): void {
    for (let i = 0; i < this.pool.length; i++) {
      const j = this.pool[i];
      if (j.meta && j.meta.height >= forkHeight) {
        if (j.meta.launcherId && this.byLauncher.get(j.meta.launcherId) === i) {
          this.byLauncher.delete(j.meta.launcherId);
        }
        j.meta = null;
        j.group.visible = false;
      }
    }
  }

  pickables(): THREE.Object3D[] {
    return this.pool.filter((j) => j.meta).map((j) => j.panel);
  }

  metaFor(object: THREE.Object3D): SproutEvent | null {
    return this.pool.find((j) => j.panel === object)?.meta ?? null;
  }
}
