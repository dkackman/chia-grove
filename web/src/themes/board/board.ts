// web/src/themes/board/board.ts
import * as THREE from "three";
import type { GroveFeed } from "../../net/feed.js";
import type { BlockEvent, GroveEvent, SproutEvent } from "@grove/shared";
import type { VisualizationHandle } from "../types.js";
import { createFrameLimiter } from "../shared/frame-limiter.js";
import { BOARD } from "./palette.js";
import { buildGlyphAtlas } from "./glyphs.js";
import { FlapGrid } from "./flapgrid.js";
import { Header } from "./header.js";
import {
  rowTextFor,
  shouldShowHeight,
  cardMetaFor,
  toDisplayRows,
  BOARD_COLS,
  HEIGHT_COLS,
} from "./rows.js";
import type { DisplayRow } from "./rows.js";
import { fitDistance } from "./fit.js";
import { BlockDetail, type DetailStatus } from "./detail.js";
import { readBlockParam, writeBlockParam } from "./url-state.js";
import { BoardNav } from "./block-nav.js";

const LEDGER_ROWS = 20;
const HISTORY = 500; // spends kept in memory for scrolling back through
// Sprouts/frame above which an already-busy board snaps instead of riffling.
// Tuned just under the feed's 60/frame drain budget so only the sustained
// connect-snapshot backlog snaps; a normal live block (even one overlapping a
// still-settling riffle) stays under this and riffles. A settled board always
// riffles regardless — this only gates the `!wasIdle` case.
const FAST_FORWARD = 48;
const SCROLL_PX_PER_ROW = 30; // wheel delta per row scrolled

const DETAIL_MESSAGES: Record<Exclude<DetailStatus, "loaded">, string> = {
  loading: "LOADING…",
  empty: "NO SPENDS THIS BLOCK",
  error: "COULD NOT LOAD BLOCK",
};

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
  const ledger = new FlapGrid(scene, atlas, LEDGER_ROWS, BOARD_COLS, {
    cell,
    originY: LEDGER_ORIGIN_Y,
  });
  const header = new Header(scene, atlas, { originY: HEADER_ORIGIN_Y });

  const navRoot = document.getElementById("board-nav") as HTMLDivElement;
  navRoot.hidden = false;
  const nav = new BoardNav(navRoot, {
    onFind: (height) => enterDetail(height),
    onPrev: () => stepDetail(-1),
    onNext: () => stepDetail(1),
    onReturnToLive: () => returnToLive(),
  });

  const events: SproutEvent[] = []; // newest first, capped at HISTORY
  let displayRows: DisplayRow[] = [];
  let ledgerDirty = false;
  let sproutsSinceFrame = 0;
  let scrollOffset = 0; // rows scrolled back from the newest (0 = following live)
  let scrollAccum = 0; // sub-row wheel remainder
  let lastRenderedOffset = -1;

  // --- block-detail mode -------------------------------------------------
  let mode: "live" | "detail" = "live";
  let detailMessage: string | null = null; // non-null replaces the ledger with a status line
  let detailDirty = false;
  let lastLiveBlock: BlockEvent | null = null; // so returning to live doesn't wait for the next block

  const maxOffset = () => Math.max(0, displayRows.length - LEDGER_ROWS);

  function renderLedger(instant: boolean): void {
    for (let r = 0; r < LEDGER_ROWS; r++) {
      if (detailMessage !== null) {
        ledger.setRow(r, r === 0 ? detailMessage : "", instant);
        continue;
      }
      const i = r + scrollOffset;
      const row = displayRows[i];
      if (row) {
        const showHeight = shouldShowHeight(displayRows[i - 1], row, r === 0);
        ledger.setRow(r, rowTextFor(row, { showHeight }), instant);
      } else {
        ledger.clearRow(r);
      }
    }
  }

  const detail = new BlockDetail(
    (height) =>
      fetch(`/block/${height}`).then((res) => {
        if (!res.ok) throw new Error(`block fetch failed: ${res.status}`);
        return res.json() as Promise<{ events: GroveEvent[] }>;
      }),
    (state) => {
      mode = "detail";
      detailMessage = state.status === "loaded" ? null : DETAIL_MESSAGES[state.status];
      if (state.status === "loaded" || state.status === "empty") {
        displayRows = state.rows;
      }
      scrollOffset = 0;
      lastRenderedOffset = -1;
      header.setDetail(state.height, state.status, state.spendCount, state.fees);
      nav.setMode("detail");
      detailDirty = true;
    }
  );

  function enterDetail(height: number, pushUrl = true): void {
    if (pushUrl) writeBlockParam(height);
    void detail.load(height);
  }

  function stepDetail(delta: number): void {
    enterDetail(detail.currentHeight + delta);
  }

  function returnToLive(pushUrl = true): void {
    mode = "live";
    detailMessage = null;
    scrollOffset = 0;
    lastRenderedOffset = -1;
    ledgerDirty = true;
    if (lastLiveBlock) {
      header.setBlock(lastLiveBlock.height, lastLiveBlock.spendCount, lastLiveBlock.fees);
    }
    header.setLive(true);
    nav.setMode("live");
    if (pushUrl) writeBlockParam(null);
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
        lastLiveBlock = event;
        if (mode === "live") header.setBlock(event.height, event.spendCount, event.fees);
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
      case "content-flag": {
        for (const e of events) {
          if (e.kind === "nft" && e.launcherId === event.launcherId) {
            e.mediaFilter = event.mediaFilter;
          }
        }
        if (mode === "detail") {
          for (const row of displayRows) {
            if (row.type === "sprout" && row.kind === "nft" && row.launcherId === event.launcherId) {
              row.mediaFilter = event.mediaFilter;
            }
          }
        }
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

    if (mode === "live") {
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
        // Scrubbing through history snaps instantly; a settled board always
        // riffles a fresh block no matter how many spends it carries. Only snap
        // when we're already mid-riffle and being flooded (e.g. the startup
        // snapshot replay) so the board can catch up instead of churning forever.
        const flooding = !wasIdle && sproutsSinceFrame > FAST_FORWARD;
        renderLedger(scrolled || reducedMotion || flooding);
        lastRenderedOffset = scrollOffset;
        header.setLive(scrollOffset === 0);
      }
    } else if (detailDirty) {
      // block navigation and the live↔detail switch always riffle, like any
      // other board update — only reduced-motion forces an instant cut
      renderLedger(reducedMotion);
      lastRenderedOffset = scrollOffset;
      detailDirty = false;
    }
    sproutsSinceFrame = 0;

    if (t - lastClock > 1) {
      header.tick(new Date());
      lastClock = t;
    }

    ledger.update(dt);
    header.update(dt);

    // gentle idle parallax sway; hold the framing distance (eased so a resize
    // settles smoothly rather than jumping)
    const sway = reducedMotion ? 0 : Math.sin(t * 0.4) * 0.25;
    camera.position.x += (sway - camera.position.x) * Math.min(dt, 1);
    camera.position.z += (baseZ - camera.position.z) * Math.min(dt * 2, 1);
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

  // wheel / trackpad scrolls vertically through history (live) or through a
  // busy block's spend list (detail); scrolling down reveals older rows
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

  addEventListener("popstate", () => {
    const height = readBlockParam(location.search);
    if (height !== null) enterDetail(height, false);
    else returnToLive(false);
  });

  const initialHeight = readBlockParam(location.search);
  if (initialHeight !== null) enterDetail(initialHeight, false);

  return {
    camera,
    onFrame: (fn) => frameCallbacks.push(fn),
    pickables: () => [ledger.mesh],
    metaFor: (object, instanceId) => {
      if (object !== ledger.mesh || instanceId === undefined) return null;
      if (instanceId % BOARD_COLS < HEIGHT_COLS) return null; // height gutter: see pickHeight
      const row = displayRows[scrollOffset + ledger.rowOf(instanceId)];
      return row ? cardMetaFor(row) : null;
    },
    pickHeight: (object, instanceId) => {
      if (object !== ledger.mesh || instanceId === undefined) return null;
      if (instanceId % BOARD_COLS >= HEIGHT_COLS) return null;
      const row = displayRows[scrollOffset + ledger.rowOf(instanceId)];
      return row ? row.height : null;
    },
    selectHeight: (height) => enterDetail(height),
    setHovered: (object, instanceId) =>
      ledger.highlightRow(
        object === ledger.mesh && instanceId !== undefined ? ledger.rowOf(instanceId) : null
      ),
  };
}
