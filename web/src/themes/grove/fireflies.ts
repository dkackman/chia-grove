import * as THREE from "three";
import { type XZ, safeBigInt } from "../shared/util.js";
import { COLORS } from "./palette.js";
import { glowTexture } from "../shared/textures.js";

const MAX = 400;
/** Fewest fireflies ever shown, even with an empty mempool. */
export const MIN_VISIBLE = 20;
/** Full in → hold → out cycle of a dive into a new block's cluster. */
export const DIVE_SECONDS = 3.2;
/** Default dive party when a block doesn't report mempoolIncluded. */
const DEFAULT_DIVERS = 50;
/** Never send more than this many fireflies at one block. */
export const MAX_DIVERS = 120;
/** Fade rate (per second) for fireflies joining / leaving the visible swarm. */
const FADE_PER_SECOND = 0.8;
/** Reorg scatter: a burst of extra orbit speed that decays away. */
const SCATTER_BOOST = 4;
const SCATTER_DECAY = 1.5;

/**
 * Dive pull envelope over a dive's progress p ∈ [0, 1]: eases in, holds at
 * the cluster, then eases back out to the orbit, so a fly never snaps home.
 * Symmetric — env(p) === env(1 - p).
 */
export function diveEnvelope(p: number): number {
  if (p <= 0 || p >= 1) return 0;
  const edge = 0.35;
  const s = (x: number) => x * x * (3 - 2 * x);
  if (p < edge) return s(p / edge);
  if (p > 1 - edge) return s((1 - p) / edge);
  return 1;
}

/** Visible swarm size for a mempool item count. */
export function visibleForMempool(size: number, max: number): number {
  return Math.max(MIN_VISIBLE, Math.min(max, MIN_VISIBLE + Math.max(0, size)));
}

/** How many fireflies dive at a block: its mempool inclusions, capped. */
export function diversFor(included: number | undefined, visible: number): number {
  const wanted = included === undefined ? DEFAULT_DIVERS : Math.max(0, Math.round(included));
  return Math.min(wanted, MAX_DIVERS, visible);
}

export interface Fly {
  cx: number;
  cz: number;
  baseY: number;
  orbitRadius: number;
  speed: number;
  phase: number;
  /** orbit angle, accumulated per frame so agitation changes never jump it */
  angle: number;
  /** 0..1 presence; fades toward 1 inside the visible count, 0 outside */
  fade: number;
  /** dive start time; NaN when not diving */
  diveStart: number;
  diveX: number;
  diveZ: number;
}

/**
 * Firefly swarm motion without any GPU: writes positions and per-fly
 * brightness into flat arrays. Pure enough to unit-test.
 */
export class FlySwarm {
  readonly flies: Fly[];
  readonly positions: Float32Array;
  /** per-fly brightness (fade), fed to the vertex colours */
  readonly brightness: Float32Array;
  visible = 60;
  agitation = 1;
  /** time scale for all motion: 1 normally, small under reduced motion */
  motion = 1;
  /** extra agitation after a reorg scatter, decaying to 0 */
  private boost = 0;
  /** highest fly index + 1 with any brightness; the draw range */
  drawCount = 0;
  private readonly scratch: number[] = [];

  constructor(
    readonly max = MAX,
    rand: () => number = Math.random
  ) {
    this.positions = new Float32Array(max * 3);
    this.brightness = new Float32Array(max);
    this.flies = Array.from({ length: max }, () => {
      const phase = rand() * Math.PI * 2;
      return {
        cx: (rand() - 0.5) * 70,
        cz: (rand() - 0.5) * 70,
        baseY: 1.5 + rand() * 6,
        orbitRadius: 1 + rand() * 4,
        speed: 0.3 + rand() * 0.8,
        phase,
        angle: phase,
        fade: 0,
        diveStart: NaN,
        diveX: 0,
        diveZ: 0,
      };
    });
    // the opening swarm is already there, not fading in from nothing
    for (let i = 0; i < Math.min(this.visible, max); i++) this.flies[i].fade = 1;
  }

  setVisible(count: number): void {
    this.visible = Math.max(0, Math.min(this.max, Math.round(count)));
  }

  /** Send up to `count` currently-visible, non-diving flies toward `target`. */
  diveTo(target: XZ, t: number, count: number, rand: () => number = Math.random): number {
    const pool = this.scratch;
    pool.length = 0;
    for (let i = 0; i < this.visible; i++) {
      if (Number.isNaN(this.flies[i].diveStart)) pool.push(i);
    }
    const n = Math.min(count, pool.length);
    for (let k = 0; k < n; k++) {
      // partial Fisher–Yates: a uniform pick without replacement
      const j = k + Math.floor(rand() * (pool.length - k));
      const pick = pool[j];
      pool[j] = pool[k];
      pool[k] = pick;
      const fly = this.flies[pick];
      fly.diveStart = t;
      fly.diveX = target.x + (rand() - 0.5) * 3;
      fly.diveZ = target.z + (rand() - 0.5) * 3;
    }
    return n;
  }

  /** Reorg: break off every dive (easing back out) and stir the swarm. */
  scatter(t: number): void {
    for (const fly of this.flies) {
      if (Number.isNaN(fly.diveStart)) continue;
      const p = (t - fly.diveStart) / DIVE_SECONDS;
      // mirror into the out-phase at the same pull, so it eases home from here
      if (p < 0.5) fly.diveStart = t - (1 - p) * DIVE_SECONDS;
    }
    this.boost = SCATTER_BOOST;
  }

  update(t: number, dt: number): void {
    const m = this.motion;
    this.boost = Math.max(0, this.boost - SCATTER_DECAY * dt);
    const agitation = this.agitation + this.boost;
    const fadeStep = FADE_PER_SECOND * dt;
    let drawCount = 0;
    for (let i = 0; i < this.max; i++) {
      const fly = this.flies[i];
      const target = i < this.visible ? 1 : 0;
      if (fly.fade < target) fly.fade = Math.min(target, fly.fade + fadeStep);
      else if (fly.fade > target) fly.fade = Math.max(target, fly.fade - fadeStep);
      this.brightness[i] = fly.fade;
      if (fly.fade <= 0) {
        fly.diveStart = NaN;
        continue;
      }
      drawCount = i + 1;

      fly.angle += fly.speed * agitation * dt * m;
      const angle = fly.angle;
      let x = fly.cx + Math.cos(angle) * fly.orbitRadius;
      let z = fly.cz + Math.sin(angle * 0.8) * fly.orbitRadius;
      let y = fly.baseY + Math.sin(t * 0.9 * m + fly.phase) * 0.8;

      if (!Number.isNaN(fly.diveStart)) {
        const p = (t - fly.diveStart) / DIVE_SECONDS;
        if (p >= 1) {
          fly.diveStart = NaN;
        } else {
          const pull = diveEnvelope(p);
          x += (fly.diveX - x) * pull;
          z += (fly.diveZ - z) * pull;
          y += (0.8 - y) * pull;
        }
      }

      this.positions[i * 3] = x;
      this.positions[i * 3 + 1] = y;
      this.positions[i * 3 + 2] = z;
    }
    this.drawCount = drawCount;
  }
}

export class Fireflies {
  private readonly points: THREE.Points;
  private readonly colors: Float32Array;
  readonly swarm: FlySwarm;
  private reducedMotion = false;

  constructor(scene: THREE.Scene, max = MAX) {
    this.swarm = new FlySwarm(max);
    this.colors = new Float32Array(max * 3);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.swarm.positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
    this.points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size: 0.35,
        map: glowTexture(),
        color: COLORS.firefly,
        // additive: a vertex colour scaled by the fly's fade is its opacity
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
    this.swarm.motion = reduced ? 0.3 : 1;
  }

  setMempool(size: number, cost: string): void {
    this.swarm.setVisible(visibleForMempool(size, this.swarm.max));
    const costNum = Number(safeBigInt(cost) / 1_000_000_000n); // ~CLVM cost in billions
    this.swarm.agitation = Math.max(0.5, Math.min(3, 0.5 + costNum / 400));
  }

  /** A live block: `included` fireflies dive in; `remaining` sets the swarm. */
  onBlock(target: XZ, t: number, included?: number, remaining?: number): void {
    if (remaining !== undefined) {
      this.swarm.setVisible(visibleForMempool(remaining, this.swarm.max));
    }
    if (this.reducedMotion) return;
    this.swarm.diveTo(target, t, diversFor(included, this.swarm.visible));
  }

  scatter(t: number): void {
    this.swarm.scatter(t);
  }

  update(t: number, dt: number): void {
    const swarm = this.swarm;
    swarm.update(t, dt);
    const n = swarm.drawCount;
    for (let i = 0; i < n; i++) {
      const b = swarm.brightness[i];
      this.colors[i * 3] = b;
      this.colors[i * 3 + 1] = b;
      this.colors[i * 3 + 2] = b;
    }
    const geometry = this.points.geometry;
    geometry.setDrawRange(0, n);
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
  }
}
