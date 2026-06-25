// web/src/themes/board/board.ts
import * as THREE from "three";
import type { GroveFeed } from "../../net/feed.js";
import type { SproutEvent } from "@grove/shared";
import type { VisualizationHandle } from "../types.js";
import { createFrameLimiter } from "../shared/frame-limiter.js";
import { BOARD } from "./palette.js";
import { buildGlyphAtlas } from "./glyphs.js";
import { FlapGrid } from "./flapgrid.js";
import { Header } from "./header.js";
import { Clatter } from "./clatter.js";
import { rowTextFor, shouldShowHeight, toDisplayRows, BOARD_COLS } from "./rows.js";
import type { DisplayRow } from "./rows.js";
import { fitDistance } from "./fit.js";

const LEDGER_ROWS = 20;
const HISTORY = 500; // spends kept in memory for scrolling back through
const FAST_FORWARD = 8; // sprouts/frame above which we snap instead of riffle
const SCROLL_PX_PER_ROW = 30; // wheel delta per row scrolled

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
  const clatter = new Clatter();

  const events: SproutEvent[] = []; // newest first, capped at HISTORY
  let displayRows: DisplayRow[] = [];
  let ledgerDirty = false;
  let sproutsSinceFrame = 0;
  let pushZ = 0; // decaying camera push-in on a new block
  let scrollOffset = 0; // rows scrolled back from the newest (0 = following live)
  let scrollAccum = 0; // sub-row wheel remainder
  let lastRenderedOffset = -1;

  const maxOffset = () => Math.max(0, displayRows.length - LEDGER_ROWS);

  function renderLedger(instant: boolean): void {
    for (let r = 0; r < LEDGER_ROWS; r++) {
      const i = r + scrollOffset;
      const row = displayRows[i];
      if (row) {
        const showHeight = shouldShowHeight(displayRows[i - 1], row, r === 0);
        ledger.setRow(r, rowTextFor(row, showHeight), instant);
      } else {
        ledger.clearRow(r);
      }
    }
  }

  feed.onEvent((event) => {
    switch (event.type) {
      case "sprout":
        events.unshift(event);
        if (events.length > HISTORY) events.pop();
        ledgerDirty = true;
        sproutsSinceFrame++;
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

    if (scrollOffset > maxOffset()) scrollOffset = maxOffset(); // a reorg may have shrunk history
    const scrolled = scrollOffset !== lastRenderedOffset;
    if (ledgerDirty || scrolled) {
      const wasIdle = ledger.idle();
      if (ledgerDirty) {
        const prevLen = displayRows.length;
        displayRows = toDisplayRows(events);
        // keep the same block in view when scrolled back
        if (scrollOffset > 0) {
          scrollOffset = Math.min(scrollOffset + displayRows.length - prevLen, maxOffset());
        }
        ledgerDirty = false;
      }
      // scrubbing through history snaps instantly; live arrivals riffle
      renderLedger(scrolled || reducedMotion || sproutsSinceFrame > FAST_FORWARD);
      lastRenderedOffset = scrollOffset;
      if (!scrolled && (!wasIdle || !ledger.idle())) clatter.flap(Math.min(1, sproutsSinceFrame / 6));
      header.setLive(scrollOffset === 0);
    }
    sproutsSinceFrame = 0;

    if (t - lastClock > 1) {
      header.tick(new Date());
      lastClock = t;
    }

    ledger.update(dt);
    header.update(dt);

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

  // wheel / trackpad scrolls vertically through history; scrolling down reveals
  // older spends, scrolling back to the top resumes following live
  canvas.addEventListener(
    "wheel",
    (e) => {
      const max = maxOffset();
      if (max === 0) return;
      scrollAccum += e.deltaY;
      const step = Math.trunc(scrollAccum / SCROLL_PX_PER_ROW);
      if (step !== 0) {
        scrollAccum -= step * SCROLL_PX_PER_ROW;
        scrollOffset = Math.max(0, Math.min(max, scrollOffset + step));
      }
      e.preventDefault();
    },
    { passive: false }
  );

  // double-click anywhere on the board toggles the clatter sound
  canvas.addEventListener("dblclick", () => clatter.setEnabled(!clatter.enabled));

  return {
    camera,
    onFrame: (fn) => frameCallbacks.push(fn),
    pickables: () => [ledger.mesh],
    metaFor: (object, instanceId) => {
      if (object !== ledger.mesh || instanceId === undefined) return null;
      const row = displayRows[scrollOffset + ledger.rowOf(instanceId)];
      return row?.type === "sprout" ? row : null;
    },
    setHovered: (object, instanceId) =>
      ledger.highlightRow(object === ledger.mesh && instanceId !== undefined ? ledger.rowOf(instanceId) : null),
  };
}
