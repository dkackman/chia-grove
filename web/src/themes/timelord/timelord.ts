import * as THREE from "three";
import type { BlockEvent, GroveEvent, SproutEvent } from "@grove/shared";
import type { GroveFeed } from "../../net/feed.js";
import type { VisualizationHandle } from "../types.js";
import { createFrameLimiter } from "../shared/frame-limiter.js";
import { createPostFx } from "../shared/postfx.js";
import { catColor } from "../shared/cat-color.js";
import { mulberry32 } from "../shared/util.js";
import {
  MAX_BLOCKS,
  PER_BLOCK_BUDGET,
  PITCH,
  STEP_ANGLE,
  blockPosition,
  coinColor,
  coinSize,
  crystalScale,
  feeHeat,
  helixAngle,
  includedMotes,
  mempoolParticles,
  orbitFor,
  starFraction,
  type Vec3,
} from "./layout.js";
import { createSceneUniforms } from "./shading.js";
import { Orbiters } from "./orbiters.js";
import { Thread, INFUSE_SECONDS } from "./thread.js";
import { Glows, Vortex } from "./particles.js";
import { Cards } from "./cards.js";
import { Fx } from "./fx.js";
import { createStage, dialSweep } from "./stage.js";
import { TimeTravel, createCameraControl } from "./controls.js";
import { Hud } from "./hud.js";
import { crystalGeometry, coinGeometry, gemGeometry, haloGeometry } from "./geometry.js";

interface BlockMeta {
  seq: number;
  height: number;
}

interface BlockRec {
  seq: number;
  height: number;
  pos: Vec3;
  glow: number;
  drawn: number;
  nfts: number;
}

/** A replayed block older than this is history: no fanfare, the funnel snaps. */
const FRESH_SECONDS = 240;
/** Only a block this recent plays the mempool migration (keeps reconnect replays brisk). */
const MIGRATE_FRESH_SECONDS = 90;
/** How long a live block is held back so the migration leads its infusion. */
const MIGRATE_HOLD_SECONDS = 1.8;
/** Included motes reach the block's slot just as its coins erupt (see onSprout's `born`). */
const MIGRATE_SECONDS = MIGRATE_HOLD_SECONDS + INFUSE_SECONDS;
const VORTEX_CAP = 1400;

const TEAL = new THREE.Color(0x3ff2c8);
const AMBER = new THREE.Color(0xffa63d);
const DID_VIOLET = new THREE.Color(0xb97aff);

export function startTimelord(canvas: HTMLCanvasElement, feed: GroveFeed): VisualizationHandle {
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.setSize(innerWidth, innerHeight);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.1, 900);
  const shared = createSceneUniforms();

  const postfx = createPostFx(renderer, scene, camera, {
    toneMapping: THREE.ACESFilmicToneMapping,
    exposure: 1.1,
    bloomStrength: 0.6,
    bloomRadius: 0.5,
    bloomThreshold: 0.5,
  });

  const stage = createStage(scene, shared, reducedMotion);
  const thread = new Thread(scene, shared, MAX_BLOCKS);
  const crystals = new Orbiters<BlockMeta>(
    scene,
    shared,
    crystalGeometry(),
    MAX_BLOCKS,
    { metal: 0.15, spec: 1.2, shininess: 60, rim: 1.1, ambient: 0.1, glow: 0.22 },
    { localTilt: 0, pickScale: 1.1 }
  );
  const glows = new Glows(scene, shared, MAX_BLOCKS);
  const coins = new Orbiters<SproutEvent>(scene, shared, coinGeometry(), 12000, {
    metal: 0.92,
    spec: 2.2,
    shininess: 90,
    rim: 0.35,
    ambient: 0.05,
    glow: 0.04,
  });
  const gems = new Orbiters<SproutEvent>(scene, shared, gemGeometry(), 4000, {
    metal: 0.3,
    spec: 1.8,
    shininess: 70,
    rim: 1.1,
    ambient: 0.12,
    glow: 0.3,
  });
  const halos = new Orbiters<SproutEvent>(scene, shared, haloGeometry(), 600, {
    metal: 0.2,
    spec: 1.2,
    shininess: 40,
    rim: 0.8,
    ambient: 0.1,
    glow: 0.9,
  });
  const cards = new Cards(scene);
  const vortex = new Vortex(scene, shared, VORTEX_CAP);
  const fx = new Fx(scene);

  // ---- chain state -------------------------------------------------------
  const blocks = new Map<number, BlockRec>(); // seq → block
  const seqByHeight = new Map<number, number>();
  let headSeq = -1;
  let oldestSeq = 0;
  let skipHeight: number | null = null; // a re-sent block (reconnect snapshot) and its spends
  let lastBlockWall = performance.now();
  let lastFanfare = -10;
  let t = 0;
  let orbitTime = 0;

  const travel = new TimeTravel();
  let traveled = false;
  const goLive = () => travel.live();
  const control = createCameraControl(
    canvas,
    (n) => {
      if (headSeq < 0) return;
      travel.scroll(n, headSeq, oldestSeq);
      if (n > 0) traveled = true;
    },
    goLive
  );
  const hud = new Hud(goLive);

  const color = new THREE.Color();

  function recycleOldest(): void {
    const rec = blocks.get(oldestSeq);
    if (rec) {
      const height = rec.height;
      crystals.kill((m) => m.seq === rec.seq, t, true);
      glows.kill(rec.glow, t - 5);
      for (const o of [coins, gems, halos]) o.kill((m) => m.height === height, t, true);
      cards.clearHeight(height, t);
      blocks.delete(oldestSeq);
      if (seqByHeight.get(height) === oldestSeq) seqByHeight.delete(height);
    }
    oldestSeq++;
  }

  function onBlock(event: BlockEvent): void {
    // Not newer than the head → a re-sent block (reconnect snapshot replay),
    // including ones already recycled off the bottom of the helix. A reorg
    // rewinds the head below the fork first, so replacement blocks still land.
    const head = blocks.get(headSeq);
    if (head && event.height <= head.height) {
      skipHeight = event.height;
      return;
    }
    skipHeight = null;
    const seq = ++headSeq;
    while (seq - oldestSeq >= MAX_BLOCKS) recycleOldest();
    const pos = blockPosition(seq);
    const heat = feeHeat(event.fees);
    color.copy(TEAL).lerp(AMBER, heat);

    thread.add(seq, t);
    // the crystal condenses as the thread's infusion front reaches it
    const infused = t + INFUSE_SECONDS * 0.85;
    crystals.add(
      { seq, height: event.height },
      pos,
      { radius: 0, phase: seq * 0.7, speed: 0, incl: 0, node: 0, yOff: 0, spin: 0.35 },
      crystalScale(event.spendCount),
      color,
      infused,
      0.5
    );
    const glow = glows.add(
      pos,
      color.clone().multiplyScalar(0.8),
      1.2 + crystalScale(event.spendCount) * 1.2,
      infused,
      seq % MAX_BLOCKS
    );
    blocks.set(seq, { seq, height: event.height, pos, glow, drawn: 0, nfts: 0 });
    seqByHeight.set(event.height, seq);

    shared.uHeadPos.value.set(pos.x, pos.y, pos.z);
    shared.uHeadColor.value.copy(color).multiplyScalar(0.9);

    const fresh = Date.now() / 1000 - event.timestamp < FRESH_SECONDS;
    vortex.moveTo(blockPosition(seq + 1), !fresh);
    if (fresh) lastBlockWall = performance.now();
    // fanfare only for a block that stands alone — a burst of catch-up blocks
    // (demo backlog, reconnect) would otherwise stack dozens of flares
    if (fresh && t - lastFanfare > 2) {
      lastFanfare = t;
      shared.uPulse.value = 1;
      fx.shockwave(pos, color, 6, infused, 2.2);
      fx.flare(pos, 0xeafff6, 3.2, infused, 1.4);
    }
  }

  function onSprout(event: SproutEvent): void {
    if (event.height === skipHeight) return;
    const seq = seqByHeight.get(event.height) ?? headSeq;
    const rec = blocks.get(seq);
    if (!rec) return;

    if (event.kind === "nft") {
      if (event.launcherId) {
        const at = cards.ping(event.launcherId, t);
        if (at) return;
      }
      if (rec.nfts >= 15) return;
      const to = cards.plant(event, rec.pos, rec.seq, rec.nfts++, t + INFUSE_SECONDS);
      if (event.mint) {
        fx.flare(to, 0xffd66b, 3.5, t + INFUSE_SECONDS + 1.3, 1.6, 2.5);
        fx.shockwave(to, 0xffc94a, 3.5, t + INFUSE_SECONDS + 1.3, 1.4);
      }
      return;
    }

    if (rec.drawn >= PER_BLOCK_BUDGET) return;
    const j = rec.drawn++;
    const rand = mulberry32(parseInt(event.coinId.slice(0, 8), 16) || j + 1);
    const orbit = orbitFor(j, rand);
    // a block's spends erupt from its crystal in a quick cascade once it's infused
    const born = t + INFUSE_SECONDS + Math.min(1.2, j * 0.01);

    if (event.kind === "xch") {
      const [r, g, b] = coinColor(event.amount);
      color.setRGB(r, g, b, THREE.SRGBColorSpace);
      coins.add(event, rec.pos, orbit, coinSize(event.amount), color, born, 0.35);
    } else if (event.kind === "cat") {
      const hsl = catColor(event.assetId ?? event.coinId);
      color.setHSL(hsl.h, 0.85, 0.58, THREE.SRGBColorSpace);
      const tokens = Number(event.amount) / 1000;
      const size = Math.min(
        0.75,
        0.26 + 0.07 * Math.log10(1 + (Number.isFinite(tokens) ? tokens : 0))
      );
      gems.add(event, rec.pos, orbit, size, color, born, 1);
    } else if (event.kind === "did") {
      halos.add(
        event,
        rec.pos,
        { ...orbit, radius: orbit.radius + 0.4 },
        0.6,
        DID_VIOLET,
        born,
        1.2
      );
    }
  }

  function onReorg(forkHeight: number): void {
    const doomed = [...blocks.values()]
      .filter((b) => b.height >= forkHeight)
      .sort((a, b) => a.seq - b.seq);
    if (doomed.length === 0) return;
    const firstSeq = doomed[0].seq;
    thread.burn(firstSeq, t);
    crystals.kill((m) => m.height >= forkHeight, t);
    for (const o of [coins, gems, halos]) o.kill((m) => m.height >= forkHeight, t);
    cards.clearAbove(forkHeight, t);
    for (const rec of doomed) {
      glows.kill(rec.glow, t);
      blocks.delete(rec.seq);
      seqByHeight.delete(rec.height);
    }
    for (const rec of doomed.slice(-6)) fx.flare(rec.pos, 0xff5a2a, 5, t, 1.4);
    headSeq = firstSeq - 1;
    const head = blocks.get(headSeq);
    if (head) shared.uHeadPos.value.set(head.pos.x, head.pos.y, head.pos.z);
    vortex.moveTo(blockPosition(headSeq + 1), false);
    skipHeight = null;
  }

  function onContentFlag(launcherId: string): void {
    cards.markSensitive(launcherId);
  }

  /**
   * A live block that took mempool items is held briefly while those motes
   * whirl down into its slot; it (and every event behind it, to keep order)
   * lands once they arrive.
   */
  function startsMigration(event: BlockEvent): boolean {
    if (reducedMotion || !(event.mempoolIncluded && event.mempoolIncluded > 0)) return false;
    const head = blocks.get(headSeq);
    if (!head || event.height <= head.height) return false;
    if (Date.now() / 1000 - event.timestamp > MIGRATE_FRESH_SECONDS) return false;
    const n = includedMotes(event.mempoolIncluded, event.mempoolRemaining ?? 0, vortex.count);
    if (n <= 0) return false;
    vortex.migrate(n, blockPosition(headSeq + 1), t, MIGRATE_SECONDS);
    return true;
  }

  const held: GroveEvent[] = [];
  let holdUntil = 0;
  let migrated: GroveEvent | null = null;

  function release(): void {
    while (held.length > 0 && t >= holdUntil) {
      const event = held[0];
      if (event.type === "block" && event !== migrated && startsMigration(event)) {
        migrated = event;
        holdUntil = t + MIGRATE_HOLD_SECONDS;
        return;
      }
      held.shift();
      handle(event);
    }
  }

  feed.onEvent((event: GroveEvent) => {
    held.push(event);
    release();
  });

  function handle(event: GroveEvent): void {
    switch (event.type) {
      case "block":
        onBlock(event);
        break;
      case "sprout":
        onSprout(event);
        break;
      case "ambient":
        vortex.setCount(mempoolParticles(event.mempoolSize, VORTEX_CAP));
        stage.setNetspace(starFraction(event.netspace));
        break;
      case "reorg":
        onReorg(event.forkHeight);
        break;
      case "content-flag":
        onContentFlag(event.launcherId);
        break;
    }
  }
  feed.onStatus((status) => stage.setSignalLost(status === "stale"));

  // ---- camera + frame loop -------------------------------------------------
  let focusSeq = 0;
  let focusInit = false;
  const lookAt = new THREE.Vector3();
  const frameCallbacks: Array<() => void> = [];
  const timer = new THREE.Timer();
  const limiter = createFrameLimiter();
  const size = new THREE.Vector2();

  function frame(): void {
    requestAnimationFrame(frame);
    if (!limiter.shouldRender(performance.now())) return;
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.1);
    t = timer.getElapsed();
    orbitTime += dt * (reducedMotion ? 0.12 : 1);

    const target = headSeq < 0 ? 0 : travel.target(headSeq, oldestSeq);
    if (!focusInit && headSeq >= 0) {
      focusSeq = target;
      focusInit = true;
    }
    // glide: quick enough to follow a scrub, slow enough to feel like a crane
    focusSeq += (target - focusSeq) * (reducedMotion ? 1 : Math.min(1, dt * 1.8));
    const focusY = focusSeq * PITCH;
    const focusAngle = focusSeq * STEP_ANGLE;

    const aspect = innerWidth / innerHeight;
    const dist = 27 * Math.max(1, (1.25 / aspect) ** 0.75);
    const sway = reducedMotion ? 0 : Math.sin(t * 0.05) * 0.14;
    // portrait screens swing the camera nearer the head's bearing and aim at it,
    // so the newest block isn't pushed off the narrow frame's edge
    const portrait = Math.min(1, Math.max(0, (1.1 - aspect) / 0.6));
    const camAngle = focusAngle + 0.5 - portrait * 0.2 + sway + control.getOrbit();
    camera.position.set(
      Math.cos(camAngle) * dist,
      focusY + 8.5 + (reducedMotion ? 0 : Math.sin(t * 0.08) * 0.8),
      Math.sin(camAngle) * dist
    );
    const aim = 5 + portrait * 5;
    lookAt.set(Math.cos(focusAngle) * aim, focusY - 5, Math.sin(focusAngle) * aim);
    camera.lookAt(lookAt);

    shared.uFocusY.value = focusY;
    shared.uPulse.value = Math.max(0, shared.uPulse.value - dt * 0.9);

    renderer.getDrawingBufferSize(size);
    const sweep = dialSweep((performance.now() - lastBlockWall) / 1000);
    stage.update(t, dt, camera, focusY, helixAngle(Math.max(headSeq, 0)), sweep, size.y);
    thread.update(t);
    crystals.update(t, orbitTime);
    coins.update(t, orbitTime);
    gems.update(t, orbitTime);
    halos.update(t, orbitTime);
    glows.update(t, size.y);
    release();
    vortex.update(t, dt, size.y);
    cards.update(t, camera, focusY);
    fx.update(t);

    const pinned = travel.pinned !== null;
    const shown = blocks.get(Math.round(target));
    hud.update(!pinned, shown?.height ?? null, Math.max(0, headSeq - Math.round(target)), traveled);

    for (const fn of frameCallbacks) fn();
    postfx.render();
  }
  frame();

  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    postfx.setSize(innerWidth, innerHeight);
  });

  const spendSets = [coins, gems, halos];
  return {
    camera,
    onFrame: (fn) => frameCallbacks.push(fn),
    isDragging: () => control.isDragging(),
    pickables: () => [crystals.mesh, coins.mesh, gems.mesh, halos.mesh, ...cards.pickables()],
    metaFor(object, instanceId) {
      for (const set of spendSets) if (object === set.mesh) return set.metaAt(instanceId);
      return cards.metaFor(object);
    },
    pickHeight(object, instanceId) {
      if (object !== crystals.mesh) return null;
      return crystals.metaAt(instanceId)?.height ?? null;
    },
    selectHeight(height) {
      const seq = seqByHeight.get(height);
      if (seq === undefined) return;
      travel.jump(seq, headSeq);
      traveled = true;
    },
    setHovered(object, instanceId) {
      crystals.setHovered(object === crystals.mesh ? instanceId : undefined);
      for (const set of spendSets) set.setHovered(object === set.mesh ? instanceId : undefined);
      cards.setHovered(object);
    },
  };
}
