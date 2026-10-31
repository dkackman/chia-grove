// web/src/themes/board/board.ts
import * as THREE from "three";
import type { GroveFeed } from "../../net/feed.js";
import type { BlockEvent, GroveEvent, SproutEvent } from "@grove/shared";
import type { VisualizationHandle } from "../types.js";
import { createRenderLoop } from "../shared/render-loop.js";
import { BOARD } from "./palette.js";
import { buildGlyphAtlas } from "./glyphs.js";
import { FlapGrid } from "./flapgrid.js";
import { Header } from "./header.js";
import {
  rowTextFor,
  shouldShowHeight,
  isBlockStart,
  cardMetaFor,
  cellHoverKey,
  patchMediaFilter,
  BOARD_COLS,
  HEIGHT_COLS,
} from "./rows.js";
import type { DisplayRow } from "./rows.js";
import { fitDistance } from "./fit.js";
import { BlockDetail, type DetailStatus } from "./detail.js";
import { readBlockParam, writeBlockParam } from "./url-state.js";
import { BoardNav, stepHeight } from "./block-nav.js";
import { Cabinet, cabinetLayout } from "./cabinet.js";
import { BlockLedger } from "./ledger.js";
import { FloodDetector } from "./flood.js";

const LEDGER_ROWS = 20;
const HISTORY_BLOCKS = 300; // blocks of display rows kept for scrolling back through
const SCROLL_PX_PER_ROW = 30; // wheel delta per row scrolled
const DRAG_THRESHOLD_PX = 8; // pointer travel before a press becomes a scroll-drag

const DETAIL_MESSAGES: Record<Exclude<DetailStatus, "loaded">, string> = {
  loading: "LOADING…",
  empty: "NO SPENDS THIS BLOCK",
  error: "COULD NOT LOAD BLOCK",
};

export function startBoard(canvas: HTMLCanvasElement, feed: GroveFeed): VisualizationHandle {
  const loop = createRenderLoop(canvas);
  let reducedMotion = loop.reducedMotion;
  loop.onReducedMotionChange((reduced) => (reducedMotion = reduced));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BOARD.backdrop);

  // Layout: a 3-row header (originY HEADER_ORIGIN_Y) above the ledger (originY
  // LEDGER_ORIGIN_Y), with a painted caption rail in the gap between them, all
  // inside the cabinet. Frame the camera on the cabinet itself so its bezel is
  // never clipped, and fit the whole board to the viewport on any aspect.
  const cell = 0.6;
  const HEADER_ORIGIN_Y = 7;
  const LEDGER_ORIGIN_Y = 4.72;
  const VFOV = 40;
  const layout = cabinetLayout({
    cols: BOARD_COLS,
    cell,
    face: 0.92,
    headerOriginY: HEADER_ORIGIN_Y,
    headerRows: 3,
    ledgerOriginY: LEDGER_ORIGIN_Y,
    ledgerRows: LEDGER_ROWS,
  });
  const centerY = layout.centerY;
  const contentW = layout.outerW + 0.2;
  const contentH = layout.outerH + 0.2;

  const cabinet = new Cabinet(scene, layout, {
    cell,
    cols: BOARD_COLS,
    // painted captions over the ledger's fields (see rowText's column layout)
    items: [
      { text: "BLOCK", col: 0 },
      { text: "TYPE", col: 9 },
      { text: "ASSET", col: 13 },
      { text: "AMOUNT", col: 26, span: 11, align: "right" },
      { text: "STATUS", col: 38 },
    ],
  });
  const light = {
    center: new THREE.Vector2(layout.centerX, layout.centerY),
    half: new THREE.Vector2(layout.winHalfW, layout.winHalfH),
  };

  const camera = new THREE.PerspectiveCamera(VFOV, innerWidth / innerHeight, 0.1, 1000);
  let baseZ = fitDistance(contentW, contentH, VFOV, innerWidth / innerHeight);
  camera.position.set(0, centerY, baseZ);
  camera.lookAt(0, centerY, 0);

  const atlas = buildGlyphAtlas();
  const ledger = new FlapGrid(scene, atlas, LEDGER_ROWS, BOARD_COLS, {
    cell,
    originY: LEDGER_ORIGIN_Y,
    light,
  });
  const header = new Header(scene, atlas, { originY: HEADER_ORIGIN_Y, light });

  const navRoot = document.getElementById("board-nav") as HTMLDivElement;
  navRoot.hidden = false;
  const nav = new BoardNav(navRoot, {
    onFind: (height) => enterDetail(height),
    onPrev: () => stepDetail(-1),
    onNext: () => stepDetail(1),
    onReturnToLive: () => returnToLive(),
  });

  // live scrollback as per-block display rows (newest first), capped by blocks
  const history = new BlockLedger(HISTORY_BLOCKS);
  const flood = new FloodDetector();
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
        const prev = displayRows[i - 1];
        const showHeight = shouldShowHeight(prev, row, r === 0);
        const blockStart = isBlockStart(prev, row);
        ledger.setRow(r, rowTextFor(row, { showHeight, blockStart }), instant);
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
      nav.setAtTip(lastLiveBlock !== null && state.height >= lastLiveBlock.height);
      cabinet.setLamp("detail");
      detailDirty = true;
    }
  );

  function enterDetail(height: number, pushUrl = true): void {
    if (pushUrl) writeBlockParam(height);
    void detail.load(height);
  }

  function stepDetail(delta: number): void {
    // never step past the chain tip — there's no block there to load yet
    const height = stepHeight(detail.currentHeight, delta, lastLiveBlock?.height ?? null);
    if (height !== detail.currentHeight) enterDetail(height);
  }

  function returnToLive(pushUrl = true): void {
    mode = "live";
    detailMessage = null;
    scrollOffset = 0;
    lastRenderedOffset = -1;
    ledgerDirty = true;
    if (lastLiveBlock) {
      header.setBlock(
        lastLiveBlock.height,
        lastLiveBlock.spendCount,
        lastLiveBlock.fees,
        lastLiveBlock.timestamp
      );
    }
    header.setLive(true);
    cabinet.setLamp("live");
    nav.setMode("live");
    if (pushUrl) writeBlockParam(null);
  }

  feed.onEvent((event) => {
    switch (event.type) {
      case "sprout":
        history.add(event);
        ledgerDirty = true;
        sproutsSinceFrame++;
        break;
      case "block":
        lastLiveBlock = event;
        if (mode === "live")
          header.setBlock(event.height, event.spendCount, event.fees, event.timestamp);
        else nav.setAtTip(detail.currentHeight >= event.height);
        break;
      case "ambient":
        header.setAmbient(event.mempoolSize, event.netspace);
        break;
      case "reorg":
        if (history.reorg(event.forkHeight)) ledgerDirty = true;
        break;
      case "content-flag": {
        patchMediaFilter(history.sprouts(), event.launcherId, event.mediaFilter);
        if (mode === "detail") {
          patchMediaFilter(
            displayRows.filter((r): r is SproutEvent => r.type === "sprout"),
            event.launcherId,
            event.mediaFilter
          );
        }
        break;
      }
    }
  });

  let lastClock = 0;

  function update(dt: number, t: number): void {
    // fed every frame so the detector sees the quiet frames between blocks too
    const flooded = flood.observe(sproutsSinceFrame);
    if (mode === "live") {
      if (scrollOffset > maxOffset()) scrollOffset = maxOffset(); // a reorg may have shrunk history
      const scrolled = scrollOffset !== lastRenderedOffset;
      if (ledgerDirty || scrolled) {
        const wasIdle = ledger.idle();
        if (ledgerDirty) {
          const prevLen = displayRows.length;
          const anchor = scrollOffset > 0 ? displayRows[scrollOffset] : undefined;
          displayRows = history.rows();
          // keep the same row in view when scrolled back (rows are stable
          // objects; fall back to the length delta if the anchor was evicted)
          if (anchor) {
            const at = displayRows.indexOf(anchor);
            const next = at >= 0 ? at : scrollOffset + displayRows.length - prevLen;
            scrollOffset = Math.max(0, Math.min(next, maxOffset()));
          }
          ledgerDirty = false;
        }
        // Scrubbing through history snaps instantly; a settled board always
        // riffles a fresh block no matter how many spends it carries. Only snap
        // when we're already mid-riffle and being flooded for many frames on
        // end (the connect-snapshot replay) so the board can catch up instead
        // of churning forever — a big live block still riffles.
        const flooding = !wasIdle && flooded;
        renderLedger(scrolled || reducedMotion || flooding);
        lastRenderedOffset = scrollOffset;
        header.setLive(scrollOffset === 0);
        cabinet.setLamp(scrollOffset === 0 ? "live" : "history");
      }
    } else if (detailDirty) {
      // block navigation and the live↔detail switch always riffle, like any
      // other board update — only reduced-motion forces an instant cut
      renderLedger(reducedMotion);
      lastRenderedOffset = scrollOffset;
      detailDirty = false;
    } else if (scrollOffset !== lastRenderedOffset) {
      // scrolling within a busy block's rows snaps instantly, matching the
      // live ledger's own history-scrub behavior
      renderLedger(true);
      lastRenderedOffset = scrollOffset;
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
    cabinet.update(t, camera.position.x, reducedMotion);
  }
  loop.onResize(() => {
    baseZ = fitDistance(contentW, contentH, VFOV, camera.aspect);
  });
  loop.start({ camera, scene, update });

  /** Scrolls by `px` (positive = toward older rows) at `pxPerRow`. */
  function scrollByPx(px: number, pxPerRow: number): void {
    const max = maxOffset();
    if (max === 0) return;
    scrollAccum += px;
    const step = Math.trunc(scrollAccum / pxPerRow);
    if (step !== 0) {
      scrollAccum -= step * pxPerRow;
      scrollOffset = Math.max(0, Math.min(max, scrollOffset + step));
    }
  }

  // wheel / trackpad scrolls vertically through history (live) or through a
  // busy block's spend list (detail); scrolling down reveals older rows
  canvas.addEventListener(
    "wheel",
    (e) => {
      if (maxOffset() === 0) return;
      scrollByPx(e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY, SCROLL_PX_PER_ROW);
      e.preventDefault();
    },
    { passive: false }
  );

  // Vertical pointer drag (touch, or a mouse) scrolls the same way, grabbing the
  // rows: pull up to reveal older ones. A press that travels less than the
  // threshold stays a tap, so picking a row still works; a real drag swallows
  // the click the browser fires on release (see isDragging).
  let dragPointer: number | null = null;
  let dragStartY = 0;
  let dragLastY = 0;
  let dragging = false;
  let suppressClick = false;
  // one ledger row's on-screen height, so the rows track the finger 1:1
  const rowPx = () =>
    (cell / (2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(VFOV) / 2))) *
    canvas.clientHeight;

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    dragPointer = e.pointerId;
    dragStartY = dragLastY = e.clientY;
    dragging = false;
    suppressClick = false;
    scrollAccum = 0;
  });
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerId !== dragPointer || !(e.buttons & 1)) return;
    if (!dragging) {
      if (Math.abs(e.clientY - dragStartY) <= DRAG_THRESHOLD_PX) return;
      dragging = true;
      canvas.setPointerCapture?.(e.pointerId);
    }
    scrollByPx(dragLastY - e.clientY, Math.max(4, rowPx()));
    dragLastY = e.clientY;
  });
  const endDrag = (e: PointerEvent) => {
    if (e.pointerId !== dragPointer) return;
    dragPointer = null;
    if (dragging) {
      dragging = false;
      // the click (if any) fires right after pointerup in the same task
      suppressClick = true;
      setTimeout(() => (suppressClick = false), 0);
    }
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  addEventListener("popstate", () => {
    const height = readBlockParam(location.search);
    if (height !== null) enterDetail(height, false);
    else returnToLive(false);
  });

  const initialHeight = readBlockParam(location.search);
  if (initialHeight !== null) enterDetail(initialHeight, false);

  return {
    camera,
    onFrame: loop.onFrame,
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
    isDragging: () => dragging || suppressClick,
    setHovered: (object, instanceId) =>
      ledger.highlightRow(
        object === ledger.mesh && instanceId !== undefined ? ledger.rowOf(instanceId) : null
      ),
    // Collapse a row's ~40 cells to one hover identity so the picker doesn't
    // rebuild the detail card (and reload its thumbnail) as the pointer sweeps
    // across a single row's columns.
    hoverKey: (object, instanceId) =>
      object === ledger.mesh && instanceId !== undefined
        ? cellHoverKey(instanceId, scrollOffset + ledger.rowOf(instanceId))
        : "",
  };
}
