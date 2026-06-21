import * as THREE from "three";
import type { SproutEvent } from "@grove/shared";
import { mediaSrc } from "../../ui/media.js";
import type { LoadPool } from "../shared/load-pool.js";

/** True when an NFT mint has static (image) art we can hang on the tile. Pure. */
export function shouldShowArt(event: SproutEvent): boolean {
  if (event.kind !== "nft") return false;
  if ((event.mediaKind ?? "image") !== "image") return false;
  return mediaSrc(event) !== null;
}

const SIZE = 3.2;

export class NowShowing {
  private readonly mesh: THREE.Mesh;
  private readonly mat: THREE.MeshBasicMaterial;
  private fade = 0;
  private want: string | null = null; // launcherId we're currently loading/showing

  constructor(scene: THREE.Scene, private readonly pool: LoadPool, opts: { x?: number } = {}) {
    this.mat = new THREE.MeshBasicMaterial({ color: 0x0b0d10, transparent: true, opacity: 0 });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), this.mat);
    this.mesh.position.set(opts.x ?? 17, 0, 0);
    scene.add(this.mesh);
  }

  show(event: SproutEvent): void {
    if (!shouldShowArt(event) || !event.launcherId) return;
    const src = mediaSrc(event);
    if (!src) return;
    const launcher = event.launcherId;
    this.want = launcher;
    this.pool.submit({
      stillWanted: () => this.want === launcher,
      start: (done) => {
        new THREE.TextureLoader().load(
          src,
          (tex) => {
            done();
            if (this.want !== launcher) return; // superseded while loading
            tex.colorSpace = THREE.SRGBColorSpace;
            this.mat.map?.dispose();
            this.mat.map = tex;
            this.mat.color.set(0xffffff);
            this.mat.needsUpdate = true;
            this.fade = 0; // restart the cross-fade
          },
          undefined,
          () => done() // silent on failure; tile keeps prior art
        );
      },
    });
  }

  update(dt: number): void {
    const targetOpacity = this.mat.map ? 1 : 0;
    this.fade = Math.min(1, this.fade + dt * 1.5);
    this.mat.opacity += (targetOpacity - this.mat.opacity) * Math.min(dt * 3, 1);
  }
}
