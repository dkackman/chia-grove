import * as THREE from "three";
import type { SproutEvent } from "@grove/shared";
import { loadArtTexture } from "../gallery/media.js";
import { resolveMedia, thumbnailSrc } from "../../ui/media.js";
import { sensitivePlaceholderTexture } from "../shared/textures.js";
import { LoadPool } from "../shared/load-pool.js";
import { mulberry32 } from "../shared/util.js";
import { cardPosition, type Vec3 } from "./layout.js";

// Same pacing as the mine paintings: replay churns hundreds of NFTs through a
// small pool, so cap concurrent /img fetches and drop loads for recycled slots.
const ART_LOAD_CONCURRENCY = 8;
const ART_LOAD_TIMEOUT_MS = 20_000;
const CARD_CAP = 56;
const CARD_HEIGHT = 2.1;
const FLY_SECONDS = 1.5;

const FRAME_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** Holographic foil border: an iridescent band that shimmers as the card turns. */
const FRAME_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uPhase;
uniform float uHover;
uniform float uFlash;
uniform float uFade;
uniform vec2 uAspect;
uniform float uMint;
varying vec2 vUv;
vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
void main() {
  // distance to the card edge in world-ish units (aspect-corrected)
  vec2 p = (vUv - 0.5) * uAspect;
  vec2 q = abs(p) - (uAspect * 0.5 - 0.09);
  float edge = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  float band = 1.0 - smoothstep(0.0, 0.09, abs(edge));
  float glow = exp(-max(edge, 0.0) * 22.0) * 0.5;
  float h = uPhase + (vUv.x + vUv.y) * 0.6 + uTime * 0.08;
  vec3 foil = mix(hue(h), vec3(1.0, 0.8, 0.35), uMint * 0.7);
  float intensity = (band * 1.4 + glow) * (1.0 + uHover * 1.5 + uFlash * 3.0);
  gl_FragColor = vec4(foil * intensity * uFade, 1.0);
}
`;

interface Card {
  group: THREE.Group;
  panel: THREE.Mesh;
  frame: THREE.Mesh;
  panelMat: THREE.MeshBasicMaterial;
  frameMat: THREE.ShaderMaterial;
  meta: SproutEvent | null;
  /** texture this card owns (disposed on recycle) — never the shared placeholder */
  owned: THREE.Texture | null;
  from: Vec3;
  to: Vec3;
  bornAt: number;
  dieAt: number;
  flashAt: number;
  width: number;
  bob: number;
}

/**
 * NFTs as holographic trading cards floating just outside the helix, each
 * tethered by a filament of light to the block that carried its spend. Cards
 * fly out of their crystal when the block lands, turn to face the viewer, and
 * show the NFT's art — routed through `resolveMedia`, so blocked art is never
 * fetched and sensitive art shows only the neutral placeholder.
 */
export class Cards {
  private readonly pool: Card[];
  private readonly byLauncher = new Map<string, number>();
  private readonly loads = new LoadPool(ART_LOAD_CONCURRENCY, ART_LOAD_TIMEOUT_MS);
  private readonly tethers: THREE.LineSegments;
  private readonly tetherPos: Float32Array;
  private readonly tetherCol: Float32Array;
  private next = 0;
  private hovered = -1;
  private readonly tmp = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    const plane = new THREE.PlaneGeometry(1, 1);
    this.pool = Array.from({ length: CARD_CAP }, (_, i) => {
      const group = new THREE.Group();
      const panelMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        side: THREE.DoubleSide,
      });
      const panel = new THREE.Mesh(plane, panelMat);
      const frameMat = new THREE.ShaderMaterial({
        vertexShader: FRAME_VERTEX,
        fragmentShader: FRAME_FRAGMENT,
        uniforms: {
          uTime: { value: 0 },
          uPhase: { value: i * 0.137 },
          uHover: { value: 0 },
          uFlash: { value: 0 },
          uFade: { value: 1 },
          uAspect: { value: new THREE.Vector2(1, 1) },
          uMint: { value: 0 },
        },
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const frame = new THREE.Mesh(plane, frameMat);
      frame.position.z = -0.02;
      group.add(frame, panel);
      group.visible = false;
      scene.add(group);
      return {
        group,
        panel,
        frame,
        panelMat,
        frameMat,
        meta: null,
        owned: null,
        from: { x: 0, y: 0, z: 0 },
        to: { x: 0, y: 0, z: 0 },
        bornAt: 0,
        dieAt: 0,
        flashAt: -10,
        width: CARD_HEIGHT,
        bob: 0,
      };
    });

    const geo = new THREE.BufferGeometry();
    this.tetherPos = new Float32Array(CARD_CAP * 6);
    this.tetherCol = new Float32Array(CARD_CAP * 6);
    geo.setAttribute("position", new THREE.BufferAttribute(this.tetherPos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(this.tetherCol, 3));
    this.tethers = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      })
    );
    this.tethers.frustumCulled = false;
    scene.add(this.tethers);
  }

  /** True when this launcher already has a card up — the caller pings it instead. */
  ping(launcherId: string, t: number): Vec3 | null {
    const slot = this.byLauncher.get(launcherId);
    if (slot === undefined) return null;
    const c = this.pool[slot];
    c.flashAt = t;
    return c.to;
  }

  plant(event: SproutEvent, crystal: Vec3, blockSeq: number, k: number, t: number): Vec3 {
    const slot = this.next;
    this.next = (this.next + 1) % CARD_CAP;
    const c = this.pool[slot];
    this.release(slot);

    c.meta = event;
    c.from = crystal;
    c.to = cardPosition(blockSeq, k);
    c.bornAt = t;
    c.dieAt = 0;
    c.flashAt = event.mint ? t + FLY_SECONDS * 0.8 : -10;
    c.bob = Math.random() * Math.PI * 2;
    c.frameMat.uniforms.uMint.value = event.mint ? 1 : 0;
    c.group.visible = true;
    if (event.launcherId) this.byLauncher.set(event.launcherId, slot);

    this.setShape(c, 1);
    c.panelMat.map = sigilTexture(event.launcherId ?? event.coinId);
    c.owned = c.panelMat.map;
    c.panelMat.needsUpdate = true;

    const media = resolveMedia(event);
    if (media.render === "art") {
      const poster = thumbnailSrc(event) ?? undefined;
      this.loads.submit({
        stillWanted: () => c.meta === event,
        start: (done) =>
          loadArtTexture(
            media.src,
            media.kind,
            (tex) => {
              done();
              if (c.meta !== event) {
                tex.dispose();
                return;
              }
              tex.colorSpace = THREE.SRGBColorSpace;
              c.owned?.dispose();
              c.owned = tex;
              c.panelMat.map = tex;
              c.panelMat.needsUpdate = true;
              const img = tex.image as {
                width?: number;
                height?: number;
                videoWidth?: number;
                videoHeight?: number;
              };
              const w = img.videoWidth || img.width || 1;
              const h = img.videoHeight || img.height || 1;
              this.setShape(c, w / h);
            },
            done,
            poster
          ),
      });
    } else if (media.render === "blur" || media.render === "placeholder") {
      this.showPlaceholder(c);
    }
    return c.to;
  }

  /** A late content flag: swap the art for the neutral placeholder. */
  markSensitive(launcherId: string): void {
    const slot = this.byLauncher.get(launcherId);
    if (slot === undefined) return;
    const c = this.pool[slot];
    if (!c.meta) return;
    c.meta = { ...c.meta, mediaFilter: "sensitive" };
    this.showPlaceholder(c);
  }

  clearAbove(forkHeight: number, t: number): void {
    for (let i = 0; i < this.pool.length; i++) {
      const c = this.pool[i];
      if (c.meta && c.meta.height >= forkHeight) this.retire(i, t);
    }
  }

  /** Retire cards whose block was recycled off the bottom of the helix. */
  clearHeight(height: number, t: number): void {
    for (let i = 0; i < this.pool.length; i++) {
      const c = this.pool[i];
      if (c.meta && c.meta.height === height) this.retire(i, t);
    }
  }

  update(t: number, camera: THREE.Camera, focusY: number): void {
    for (let i = 0; i < this.pool.length; i++) {
      const c = this.pool[i];
      const o = i * 6;
      if (!c.group.visible) {
        this.tetherPos.fill(0, o, o + 6);
        continue;
      }
      const fly = Math.max(0, Math.min(1, (t - c.bornAt) / FLY_SECONDS));
      const e = 1 - (1 - fly) ** 4;
      let s = e;
      if (c.dieAt > 0) {
        const k = Math.min(1, (t - c.dieAt) / 0.8);
        s *= 1 - k;
        if (k >= 1) {
          c.group.visible = false;
          continue;
        }
      }
      const bob = Math.sin(t * 0.7 + c.bob) * 0.18;
      c.group.position.set(
        c.from.x + (c.to.x - c.from.x) * e,
        c.from.y + (c.to.y - c.from.y) * e + bob * e,
        c.from.z + (c.to.z - c.from.z) * e
      );
      c.group.scale.setScalar(Math.max(0.001, s) * (this.hovered === i ? 1.25 : 1));
      c.group.quaternion.copy(camera.quaternion);

      const dy = c.group.position.y - focusY;
      // …and cards that drift right up against the lens (history view) fade away
      const near = smoothstep(9, 16, c.group.position.distanceTo(camera.position));
      const fade = smoothstep(-64, -6, dy) * (1 - smoothstep(12, 34, dy)) * near;
      c.panelMat.opacity = fade;
      c.panel.visible = fade > 0.02;
      c.frame.visible = fade > 0.02;
      const flash = Math.max(0, 1 - Math.abs(t - c.flashAt) / 0.9);
      const fu = c.frameMat.uniforms;
      fu.uTime.value = t;
      fu.uFade.value = fade;
      fu.uFlash.value = flash;
      fu.uHover.value = this.hovered === i ? 1 : 0;

      // tether: crystal → card, brightest at the card end
      this.tmp.copy(c.group.position);
      this.tetherPos.set(
        [c.from.x, c.from.y, c.from.z, this.tmp.x, this.tmp.y - 0.9 * s, this.tmp.z],
        o
      );
      const b = 0.35 * fade * (1 + flash * 2 + (this.hovered === i ? 1.5 : 0));
      const mint = c.meta?.mint;
      this.tetherCol.set(
        [
          0.05 * b,
          0.25 * b,
          0.2 * b,
          (mint ? 1 : 0.5) * b,
          (mint ? 0.8 : 0.9) * b,
          (mint ? 0.4 : 1) * b,
        ],
        o
      );
    }
    this.tethers.geometry.attributes.position.needsUpdate = true;
    this.tethers.geometry.attributes.color.needsUpdate = true;
  }

  setHovered(object: THREE.Object3D | null): void {
    this.hovered = object ? this.pool.findIndex((c) => c.panel === object) : -1;
  }

  pickables(): THREE.Object3D[] {
    return this.pool.filter((c) => c.meta && c.panel.visible).map((c) => c.panel);
  }

  metaFor(object: THREE.Object3D): SproutEvent | null {
    return this.pool.find((c) => c.panel === object)?.meta ?? null;
  }

  private showPlaceholder(c: Card): void {
    c.owned?.dispose();
    c.owned = null;
    c.panelMat.map = sensitivePlaceholderTexture();
    c.panelMat.needsUpdate = true;
    this.setShape(c, 1);
  }

  private setShape(c: Card, aspect: number): void {
    const a = Math.max(0.6, Math.min(1.6, aspect));
    c.width = CARD_HEIGHT * a;
    c.panel.scale.set(c.width, CARD_HEIGHT, 1);
    const pad = 0.28;
    c.frame.scale.set(c.width + pad, CARD_HEIGHT + pad, 1);
    (c.frameMat.uniforms.uAspect.value as THREE.Vector2).set(c.width + pad, CARD_HEIGHT + pad);
  }

  private retire(slot: number, t: number): void {
    const c = this.pool[slot];
    if (c.meta?.launcherId && this.byLauncher.get(c.meta.launcherId) === slot) {
      this.byLauncher.delete(c.meta.launcherId);
    }
    c.meta = null;
    c.dieAt = t;
  }

  private release(slot: number): void {
    const c = this.pool[slot];
    if (c.meta?.launcherId && this.byLauncher.get(c.meta.launcherId) === slot) {
      this.byLauncher.delete(c.meta.launcherId);
    }
    c.owned?.dispose();
    c.owned = null;
    c.panelMat.map = null;
    c.meta = null;
  }
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * A deterministic generative sigil for an NFT with no fetchable art (or while
 * its art loads): concentric arcs and a lattice seeded from the launcher id,
 * so the same NFT always wears the same face.
 */
function sigilTexture(seedHex: string): THREE.CanvasTexture {
  const rand = mulberry32(parseInt(seedHex.slice(0, 8), 16) || 1);
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const h = Math.floor(rand() * 360);
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, `hsl(${h}, 55%, 14%)`);
  g.addColorStop(1, `hsl(${(h + 60) % 360}, 60%, 24%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.translate(size / 2, size / 2);
  ctx.lineCap = "round";
  for (let ring = 0; ring < 5; ring++) {
    const r = 12 + ring * 10;
    const arcs = 1 + Math.floor(rand() * 3);
    for (let k = 0; k < arcs; k++) {
      const start = rand() * Math.PI * 2;
      ctx.strokeStyle = `hsla(${(h + ring * 25) % 360}, 90%, ${55 + ring * 6}%, ${0.5 + rand() * 0.5})`;
      ctx.lineWidth = 1.5 + rand() * 3;
      ctx.beginPath();
      ctx.arc(0, 0, r, start, start + 0.6 + rand() * 2.8);
      ctx.stroke();
    }
  }
  const sides = 3 + Math.floor(rand() * 4);
  ctx.strokeStyle = `hsla(${(h + 180) % 360}, 90%, 75%, 0.9)`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= sides; i++) {
    const a = (i / sides) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * 9;
    const y = Math.sin(a) * 9;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
