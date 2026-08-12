import * as THREE from "three";
import type { SproutEvent } from "@grove/shared";
import { resolveMedia, thumbnailSrc } from "../../ui/media.js";
import { loadArtTexture } from "../gallery/media.js";
import { LoadPool } from "../shared/load-pool.js";
import { sensitivePlaceholderTexture } from "../shared/textures.js";
import { bandDepth, seatOffset } from "./layout.js";
import { jellyPulse, PULSE_SKEW } from "./motion.js";
import { LAKE } from "./palette.js";

const JELLY_CAP = 40;
const PLACEHOLDER = 0x9fb6c9;
const PULSE_FREQ = 2.2;

/** The bell: a dome, open underneath, finely segmented so the rim can flare. */
export function bellGeometry(): THREE.SphereGeometry {
  return new THREE.SphereGeometry(0.95, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.6);
}

/** One tentacle: a segmented ribbon hanging from its root at the origin. */
export function tentacleGeometry(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(0.09, 1.5, 1, 8);
  g.translate(0, -0.75, 0);
  return g;
}

interface PulseUniforms {
  uTime: { value: number };
  uPhase: { value: number };
}

/** Shared preamble: the asymmetric medusa beat, mirroring motion.ts jellyPulse. */
const PULSE_GLSL = `
  float pulseP = uTime * ${PULSE_FREQ.toFixed(4)} + uPhase;
  float pulse = sin(pulseP + ${PULSE_SKEW.toFixed(4)} * sin(pulseP));`;

function applyPulseShader(
  material: THREE.Material,
  phase: number,
  displacement: string
): PulseUniforms {
  const uniforms: PulseUniforms = { uTime: { value: 0 }, uPhase: { value: phase } };
  material.onBeforeCompile = (s) => {
    s.uniforms.uTime = uniforms.uTime;
    s.uniforms.uPhase = uniforms.uPhase;
    s.vertexShader =
      "uniform float uTime;\nuniform float uPhase;\n" +
      s.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\n${PULSE_GLSL}\n${displacement}`
      );
  };
  // The default cache key is onBeforeCompile.toString(), which cannot see the
  // captured `displacement` — both materials would collide onto one compiled
  // program and one displacement would be silently discarded.
  material.customProgramCacheKey = () => displacement;
  return uniforms;
}

interface Jelly {
  group: THREE.Group;
  panel: THREE.Mesh;
  bell: THREE.Mesh;
  bellUniforms: PulseUniforms;
  tentacleUniforms: PulseUniforms;
  phase: number;
  meta: SproutEvent | null;
  bornBlock: number;
  radius: number;
  angle: number;
  speed: number;
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
 *
 * Bell contraction and tentacle whip are GPU-side (per-jelly shader uniforms,
 * driven from `update()`), synced to the CPU pulse-and-coast vertical motion
 * through the shared `jellyPulse` waveform in `motion.ts`.
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
    const tentacleGeo = tentacleGeometry();

    this.pool = Array.from({ length: cap }, (_, idx) => {
      const phase = idx * 2.399; // golden-angle spacing keeps neighbours out of sync
      const group = new THREE.Group();

      const bellMat = new THREE.MeshStandardMaterial({
        color: LAKE.jelly,
        transparent: true,
        opacity: 0.42,
        roughness: 0.25,
        emissive: new THREE.Color(LAKE.jelly),
        emissiveIntensity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      // radial squeeze traveling apex→rim: zero at the apex (y≈0.95), full at the rim
      const bellUniforms = applyPulseShader(
        bellMat,
        phase,
        `float rim = clamp(1.0 - position.y / 0.95, 0.0, 1.2);
         float squeeze = max(pulse, 0.0);
         transformed.x *= 1.0 - squeeze * 0.16 * rim;
         transformed.z *= 1.0 - squeeze * 0.16 * rim;
         transformed.y += squeeze * 0.10 * rim;`
      );
      const bell = new THREE.Mesh(bellGeo, bellMat);

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
        side: THREE.DoubleSide, // ribbons are planes, visible from both sides
      });
      // whip follow-through: displacement grows with droop², lagging the bell by 1.1 rad
      const tentacleUniforms = applyPulseShader(
        tentacleMat,
        phase,
        `float droop = clamp(-position.y / 1.5, 0.0, 1.0);
         float lagP = pulseP - 1.1 - droop * 1.6;
         float lag = sin(lagP + ${PULSE_SKEW.toFixed(4)} * sin(lagP));
         transformed.x += lag * droop * droop * 0.45;
         transformed.z += sin(uTime * 1.7 + uPhase - droop * 2.1) * droop * droop * 0.25;`
      );

      group.add(bell, panel);
      for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2;
        const tentacle = new THREE.Mesh(tentacleGeo, tentacleMat);
        tentacle.position.set(Math.cos(angle) * 0.55, -0.1, Math.sin(angle) * 0.55);
        group.add(tentacle);
      }
      const centerTentacle = new THREE.Mesh(tentacleGeo, tentacleMat);
      // offset off z=0 so it isn't coplanar with the art panel near its root
      // (that coplanarity z-fights a stripe across the NFT art)
      centerTentacle.position.set(0, -0.1, -0.15);
      group.add(centerTentacle);

      group.visible = false;
      scene.add(group);
      return {
        group,
        panel,
        bell,
        bellUniforms,
        tentacleUniforms,
        phase,
        meta: null,
        bornBlock: 0,
        radius: 0,
        angle: 0,
        speed: 0,
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
      j.bellUniforms.uTime.value = t;
      j.tentacleUniforms.uTime.value = t;
      const angle = j.angle + t * j.speed;
      const { lift } = jellyPulse(t * PULSE_FREQ + j.phase);
      j.group.position.set(
        Math.cos(angle) * j.radius,
        bandDepth(blocksSeen - j.bornBlock) + lift * 0.55,
        Math.sin(angle) * j.radius
      );
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
