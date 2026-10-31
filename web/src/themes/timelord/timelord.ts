import * as THREE from "three";
import type { BlockEvent, GroveEvent, SproutEvent } from "@grove/shared";
import type { GroveFeed } from "../../net/feed.js";
import type { VisualizationHandle } from "../types.js";
import { createRenderLoop } from "../shared/render-loop.js";
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
import { Hud, blockSummaryText } from "./hud.js";
import { HoldQueue } from "./held.js";
import { HeightUrl, readHeightParam } from "./deep-link.js";
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
  /** spends drawn as orbiters */
  drawn: number;
  /** NFT cards planted */
  nfts: number;
  /** spends past the per-block budgets that were not drawn */
  skipped: number;
  spendCount: number;
  fees: string;
  timestamp: number;
}

/** NFT cards planted per block at most. */
const NFTS_PER_BLOCK = 15;
/**
 * Spare crystal/glow slots beyond MAX_BLOCKS: a reorg rewinds `seq`, so the
 * replacement blocks are added while the orphans are still imploding, and the
 * rings must not overwrite the oldest live block to make room.
 */
const REORG_SLACK = 32;
/** Held events handed to the scene per frame at most (the feed drains its snapshot at 120). */
const RELEASE_BUDGET = 240;

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
  const loop = createRenderLoop(canvas);
  const { renderer } = loop;
  let reducedMotion = loop.reducedMotion;
  loop.onReducedMotionChange((reduced) => (reducedMotion = reduced));

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
    MAX_BLOCKS + REORG_SLACK,
    { metal: 0.15, spec: 1.2, shininess: 60, rim: 1.1, ambient: 0.1, glow: 0.22 },
    { localTilt: 0, pickScale: 1.1 }
  );
  const glows = new Glows(scene, shared, MAX_BLOCKS + REORG_SLACK);
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
  let lastBlockWall = performance.now();
  let lastFanfare = -10;
  let t = 0;
  let orbitTime = 0;

  const travel = new TimeTravel();
  let traveled = false;
  // any travel by hand overrides a deep link still waiting for its block
  const cancelDeepLink = () => (deepLink.pending = deepLink.seq = null);
  const goLive = () => {
    cancelDeepLink();
    travel.live();
  };
  const control = createCameraControl(
    canvas,
    (n) => {
      if (headSeq < 0) return;
      cancelDeepLink();
      travel.scroll(n, headSeq, oldestSeq);
      if (n > 0) traveled = true;
    },
    goLive
  );
  const hud = new Hud(goLive);

  // ?height= deep link: `pending` until the replay delivers that block (`seq`)
  const deepLink: { pending: number | null; seq: number | null } = {
    pending: readHeightParam(location.search),
    seq: null,
  };
  const heightUrl = new HeightUrl(deepLink.pending);

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
    // The feed never re-sends a block (snapshot dedupe) and a reorg rewinds the
    // head below its fork first, so heights only climb — this is just a cheap
    // guard on the helix's seq ↔ height ordering.
    const head = blocks.get(headSeq);
    if (head && event.height <= head.height) return;
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
      infused
    );
    blocks.set(seq, {
      seq,
      height: event.height,
      pos,
      glow,
      drawn: 0,
      nfts: 0,
      skipped: 0,
      spendCount: event.spendCount,
      fees: event.fees,
      timestamp: event.timestamp,
    });
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
      // reduced motion: a soft head-light swell, no expanding rings or flares
      shared.uPulse.value = reducedMotion ? 0.3 : 1;
      if (!reducedMotion) {
        fx.shockwave(pos, color, 6, infused, 2.2);
        fx.flare(pos, 0xeafff6, 3.2, infused, 1.4);
      }
    }
    if (deepLink.pending === event.height) deepLink.seq = seq;
    else if (
      deepLink.pending !== null &&
      deepLink.seq === null &&
      event.height > deepLink.pending
    ) {
      // heights only climb: the linked block is older than anything retained
      deepLink.pending = null;
    }
  }

  function onSprout(event: SproutEvent): void {
    const seq = seqByHeight.get(event.height);
    const rec = seq === undefined ? undefined : blocks.get(seq);
    if (!rec) return;

    if (event.kind === "nft") {
      if (event.launcherId) {
        const at = cards.ping(event.launcherId, t);
        if (at) return;
      }
      if (rec.nfts >= NFTS_PER_BLOCK) {
        rec.skipped++;
        return;
      }
      const to = cards.plant(event, rec.pos, rec.seq, rec.nfts++, t + INFUSE_SECONDS);
      if (event.mint && !reducedMotion) {
        fx.flare(to, 0xffd66b, 3.5, t + INFUSE_SECONDS + 1.3, 1.6, 2.5);
        fx.shockwave(to, 0xffc94a, 3.5, t + INFUSE_SECONDS + 1.3, 1.4);
      }
      return;
    }

    if (rec.drawn >= PER_BLOCK_BUDGET) {
      rec.skipped++;
      return;
    }
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
    // the linked block was orphaned: wait for its replacement at that height
    if (deepLink.seq !== null && deepLink.seq >= firstSeq) deepLink.seq = null;
  }

  function onContentFlag(launcherId: string): void {
    cards.markSensitive(launcherId);
  }

  /**
   * A live block that took mempool items is held briefly while those motes
   * whirl down into its slot; it (and every event behind it, to keep order)
   * lands once they arrive.
   */
  function startsMigration(event: GroveEvent): boolean {
    if (event.type !== "block") return false;
    // a hidden tab's frame clock is frozen, so a hold would never expire
    if (reducedMotion || document.hidden) return false;
    if (!(event.mempoolIncluded && event.mempoolIncluded > 0)) return false;
    const head = blocks.get(headSeq);
    if (!head || event.height <= head.height) return false;
    if (Date.now() / 1000 - event.timestamp > MIGRATE_FRESH_SECONDS) return false;
    const n = includedMotes(event.mempoolIncluded, event.mempoolRemaining ?? 0, vortex.count);
    if (n <= 0) return false;
    vortex.migrate(n, blockPosition(headSeq + 1), t, MIGRATE_SECONDS);
    return true;
  }

  const held = new HoldQueue<GroveEvent>(MIGRATE_HOLD_SECONDS);
  let releasedThisFrame = 0;

  function release(): void {
    if (document.hidden) {
      // no frames run while hidden: break any hold and land everything now
      // rather than letting the queue grow until the tab returns
      held.release(Infinity, Infinity, handle, startsMigration);
      return;
    }
    releasedThisFrame += held.release(
      t,
      RELEASE_BUDGET - releasedThisFrame,
      handle,
      startsMigration
    );
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
  const size = new THREE.Vector2();

  function update(dt: number, elapsed: number): void {
    t = elapsed;
    releasedThisFrame = 0;
    orbitTime += dt * (reducedMotion ? 0.12 : 1);

    if (deepLink.seq !== null) {
      // travel once the linked block has a successor (so the jump pins it rather
      // than going live); a link to the live head itself just stays live
      if (headSeq > deepLink.seq) {
        travel.jump(deepLink.seq, headSeq);
        traveled = true;
        deepLink.pending = deepLink.seq = null;
      } else if (Date.now() / 1000 - (blocks.get(headSeq)?.timestamp ?? 0) < FRESH_SECONDS) {
        deepLink.pending = deepLink.seq = null;
      }
    }

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
    // the URL waits until a pending deep link resolves, so it isn't clobbered first
    if (deepLink.pending === null) {
      heightUrl.update(pinned ? (shown?.height ?? null) : null, performance.now());
    }

    // rebuilt once per frame; the picker may ask several times
    pickList.length = staticPicks.length;
    for (const panel of cards.pickables()) pickList.push(panel);
  }

  const spendSets = [coins, gems, halos];
  const staticPicks: THREE.Object3D[] = [crystals.mesh, coins.mesh, gems.mesh, halos.mesh];
  const pickList: THREE.Object3D[] = [...staticPicks];
  loop.start({ camera, postfx, update });

  return {
    camera,
    onFrame: loop.onFrame,
    isDragging: () => control.isDragging(),
    pickables: () => pickList,
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
      cancelDeepLink();
      travel.jump(seq, headSeq);
      traveled = true;
    },
    setHovered(object, instanceId) {
      const crystal = object === crystals.mesh ? crystals.metaAt(instanceId) : null;
      const rec = crystal ? blocks.get(crystal.seq) : undefined;
      hud.setBlockInfo(rec ? blockSummaryText(rec, Date.now() / 1000) : null);
      crystals.setHovered(object === crystals.mesh ? instanceId : undefined);
      for (const set of spendSets) set.setHovered(object === set.mesh ? instanceId : undefined);
      cards.setHovered(object);
    },
  };
}
