// web/src/themes/board/board.ts
import * as THREE from "three";
import type { GroveFeed } from "../../net/feed.js";
import type { SproutEvent } from "@grove/shared";
import type { VisualizationHandle } from "../types.js";
import { createFrameLimiter } from "../shared/frame-limiter.js";
import { LoadPool } from "../shared/load-pool.js";
import { BOARD, kindAccent } from "./palette.js";
import { buildGlyphAtlas } from "./glyphs.js";
import { FlapGrid } from "./flapgrid.js";
import { Header } from "./header.js";
import { NowShowing, shouldShowArt } from "./nowshowing.js";
import { Clatter } from "./clatter.js";
import { rowText, BOARD_COLS } from "./rows.js";
import { fitDistance } from "./fit.js";

const LEDGER_ROWS = 20;
const FAST_FORWARD = 8; // sprouts/frame above which we snap instead of riffle
const ART_CONCURRENCY = 2;

export function startBoard(canvas: HTMLCanvasElement, feed: GroveFeed): VisualizationHandle {
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.setSize(innerWidth, innerHeight);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BOARD.backdrop);

  // Layout: a 3-row header (originY HEADER_ORIGIN_Y) above the ledger (originY
  // LEDGER_ORIGIN_Y). Frame the camera on the true content center so the header
  // is never clipped, and fit the whole board to the viewport on any aspect.
  const cell = 0.6;
  const HEADER_ORIGIN_Y = 7;
  const LEDGER_ORIGIN_Y = 5;
  const VFOV = 40;
  const contentTop = HEADER_ORIGIN_Y + cell; // top edge of the header row
  const contentBottom = LEDGER_ORIGIN_Y - (LEDGER_ROWS - 1) * cell - cell; // bottom of the last ledger row
  const centerY = (contentTop + contentBottom) / 2;
  const contentH = contentTop - contentBottom;
  const contentW = BOARD_COLS * cell + cell * 2;

  const housing = new THREE.Mesh(
    new THREE.PlaneGeometry(contentW + 0.8, contentH + 0.8),
    new THREE.MeshBasicMaterial({ color: BOARD.housing })
  );
  housing.position.set(0, centerY, -0.05);
  scene.add(housing);

  const camera = new THREE.PerspectiveCamera(VFOV, innerWidth / innerHeight, 0.1, 1000);
  let baseZ = fitDistance(contentW, contentH, VFOV, innerWidth / innerHeight);
  camera.position.set(0, centerY, baseZ);
  camera.lookAt(0, centerY, 0);

  const atlas = buildGlyphAtlas();
  const ledger = new FlapGrid(scene, atlas, LEDGER_ROWS, BOARD_COLS, { cell, originY: LEDGER_ORIGIN_Y });
  const header = new Header(scene, atlas, { originY: HEADER_ORIGIN_Y });
  const artPool = new LoadPool(ART_CONCURRENCY);
  // float the NFT tile in front of the board's bottom-right corner so it stays
  // on-screen regardless of how the board is fit to the viewport
  const nowShowing = new NowShowing(scene, artPool, {
    x: contentW / 2 - 2.2,
    y: centerY - contentH / 2 + 2.2,
    z: 0.6,
  });
  const clatter = new Clatter();

  const events: SproutEvent[] = []; // newest first, capped at LEDGER_ROWS
  let ledgerDirty = false;
  let sproutsSinceFrame = 0;
  let pushZ = 0; // decaying camera push-in on a new block

  function renderLedger(instant: boolean): void {
    for (let r = 0; r < LEDGER_ROWS; r++) {
      const e = events[r];
      if (e) {
        ledger.setRow(r, rowText(e), instant);
        ledger.tintRow(r, kindAccent(e));
      } else {
        ledger.clearRow(r);
      }
    }
  }

  feed.onEvent((event) => {
    switch (event.type) {
      case "sprout":
        events.unshift(event);
        if (events.length > LEDGER_ROWS) events.pop();
        ledgerDirty = true;
        sproutsSinceFrame++;
        if (shouldShowArt(event)) nowShowing.show(event);
        break;
      case "block":
        header.setBlock(event.height, event.spendCount, event.fees);
        pushZ = 1;
        break;
      case "ambient":
        header.setAmbient(event.mempoolSize, event.netspace);
        break;
      case "reorg": {
        const before = events.length;
        for (let i = events.length - 1; i >= 0; i--) {
          if (events[i].height >= event.forkHeight) events.splice(i, 1);
        }
        if (events.length !== before) ledgerDirty = true;
        break;
      }
    }
  });

  const frameCallbacks: Array<() => void> = [];
  const timer = new THREE.Timer();
  const limiter = createFrameLimiter();
  let lastClock = 0;

  function frame(): void {
    requestAnimationFrame(frame);
    if (!limiter.shouldRender(performance.now())) return;
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.1);
    const t = timer.getElapsed();

    if (ledgerDirty) {
      const wasIdle = ledger.idle();
      renderLedger(reducedMotion || sproutsSinceFrame > FAST_FORWARD);
      ledgerDirty = false;
      if (!wasIdle || !ledger.idle()) clatter.flap(Math.min(1, sproutsSinceFrame / 6));
    }
    sproutsSinceFrame = 0;

    if (t - lastClock > 1) {
      header.tick(new Date());
      lastClock = t;
    }

    ledger.update(dt);
    header.update(dt);
    nowShowing.update(dt);

    // gentle idle parallax sway + decaying push-in on a new block
    pushZ = Math.max(0, pushZ - dt);
    const sway = reducedMotion ? 0 : Math.sin(t * 0.4) * 0.25;
    camera.position.x += (sway - camera.position.x) * Math.min(dt, 1);
    camera.position.z += (baseZ - pushZ * 4 - camera.position.z) * Math.min(dt * 2, 1);
    camera.lookAt(0, centerY, 0);

    for (const fn of frameCallbacks) fn();
    renderer.render(scene, camera);
  }
  frame();

  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    baseZ = fitDistance(contentW, contentH, VFOV, camera.aspect);
  });

  // double-click anywhere on the board toggles the clatter sound
  canvas.addEventListener("dblclick", () => clatter.setEnabled(!clatter.enabled));

  return {
    camera,
    onFrame: (fn) => frameCallbacks.push(fn),
    pickables: () => [ledger.mesh],
    metaFor: (object, instanceId) =>
      object === ledger.mesh && instanceId !== undefined ? events[ledger.rowOf(instanceId)] ?? null : null,
    setHovered: (object, instanceId) =>
      ledger.highlightRow(object === ledger.mesh && instanceId !== undefined ? ledger.rowOf(instanceId) : null),
  };
}
