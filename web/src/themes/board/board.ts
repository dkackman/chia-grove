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

  // board housing
  const cell = 0.6;
  const boardW = BOARD_COLS * cell + 1.2;
  const boardH = (LEDGER_ROWS + 4) * cell + 1.2;
  const housing = new THREE.Mesh(
    new THREE.PlaneGeometry(boardW, boardH),
    new THREE.MeshBasicMaterial({ color: BOARD.housing })
  );
  housing.position.set(0, (7 - (LEDGER_ROWS - 1) * cell) / 2, -0.05);
  scene.add(housing);

  const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 1000);
  const baseZ = boardH * 1.15;
  camera.position.set(0, housing.position.y, baseZ);
  camera.lookAt(0, housing.position.y, 0);

  const atlas = buildGlyphAtlas();
  // ledger sits below the 3-row header (header originY 7 → rows at 7,6.4,5.8)
  const ledger = new FlapGrid(scene, atlas, LEDGER_ROWS, BOARD_COLS, { cell, originY: 5 });
  const header = new Header(scene, atlas, { originY: 7 });
  const artPool = new LoadPool(ART_CONCURRENCY);
  const nowShowing = new NowShowing(scene, artPool, { x: boardW / 2 + 2.2 });
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
    camera.lookAt(0, housing.position.y, 0);

    for (const fn of frameCallbacks) fn();
    renderer.render(scene, camera);
  }
  frame();

  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // toggle clatter by clicking the housing background (no row hit)
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
