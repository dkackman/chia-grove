import * as THREE from "three";
import { FlapGrid } from "./flapgrid.js";
import { BOARD_COLS, clampFrac } from "./rows.js";
import { mojosToXch } from "../../ui/format.js";
import type { DetailStatus } from "./detail.js";

const padR = (s: string, n: number) => s.slice(0, n).padEnd(n);

/** A `▮`/`·` fill bar `width` chars wide. Pure. */
export function mempoolGauge(size: number, width: number, full = 5000): string {
  const raw = Math.round(Math.min(1, size / full) * width);
  const filled = Number.isFinite(raw) ? Math.max(0, Math.min(width, raw)) : 0;
  return "▮".repeat(filled) + "·".repeat(width - filled);
}

/** Pretty-print a netspace byte count (string) as e.g. "38.2 EIB". */
function netspaceText(bytes: string): string {
  const units = ["B", "KIB", "MIB", "GIB", "TIB", "PIB", "EIB"];
  let v = Number(bytes);
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(1)} ${units[u]}`;
}

const clock = (d: Date) =>
  [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");

/**
 * A block's fee total (mojo string) in XCH, e.g. "0.000052 XCH FEES", with up
 * to `maxFrac` decimals (truncated, never rounded up). Pure.
 */
export function feesText(fees: string, maxFrac = 6): string {
  return `${clampFrac(mojosToXch(fees), maxFrac)} XCH FEES`;
}

/**
 * Row-0 text for a block: height, spend count and fees in XCH. Sheds fee
 * decimals until the line fits the board, so a big fee never pushes the unit
 * off the edge. Pure.
 */
export function blockLabel(height: number, spendCount: number, fees: string): string {
  const head = `BLOCK ${height}   ${spendCount} SPENDS   `;
  let text = head + feesText(fees);
  for (let frac = 5; frac >= 0 && text.length > BOARD_COLS; frac--) {
    text = head + feesText(fees, frac);
  }
  return text;
}

/** Elapsed seconds as m:ss (h:mm:ss past an hour); negatives clamp to 0. Pure. */
export function agoText(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const ss = String(s % 60).padStart(2, "0");
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}:${ss}`;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${ss}`;
}

/** Row-0 text for the header's block-detail variant. Pure. */
export function detailBlockLabel(
  height: number,
  status: DetailStatus,
  spendCount: number,
  fees: string
): string {
  switch (status) {
    case "loaded":
      return blockLabel(height, spendCount, fees);
    case "empty":
      return `BLOCK ${height}   NO SPENDS THIS BLOCK`;
    case "loading":
      return `BLOCK ${height}   LOADING…`;
    case "error":
      return `BLOCK ${height}   COULD NOT LOAD`;
  }
}

export type HeaderMode = "live" | "history" | "detail";

/**
 * Row-2 (clock + status) text. Live mode also shows how long ago the newest
 * block landed when `sinceBlock` (seconds) is known. Pure.
 */
export function statusRowText(
  mode: HeaderMode,
  clockText: string,
  sinceBlock: number | null = null
): string {
  if (mode === "detail") return `${clockText}   ★ BLOCK DETAIL`;
  if (mode === "history") return `${clockText}   ★ HISTORY · SCROLL UP FOR LIVE`;
  const ago = sinceBlock === null ? "" : `   LAST BLOCK ${agoText(sinceBlock)} AGO`;
  return `${clockText}   LIVE${ago}`;
}

export class Header {
  private readonly grid: FlapGrid;
  private clockText = "00:00:00";
  private mode: HeaderMode = "live";
  private blockTime: number | null = null; // unix seconds of the newest live block
  private now: number | null = null; // unix seconds at the last tick

  constructor(
    scene: THREE.Scene,
    atlas: THREE.CanvasTexture,
    opts: { originY?: number; light?: { center: THREE.Vector2; half: THREE.Vector2 } } = {}
  ) {
    // 3 rows sitting above the ledger; the ledger sets its own originY below this.
    this.grid = new FlapGrid(scene, atlas, 3, BOARD_COLS, {
      originY: opts.originY ?? 7,
      light: opts.light,
    });
    this.grid.setRow(0, padR("THE BIG BOARD", BOARD_COLS), true);
  }

  /** Shows a live block; `timestamp` (unix seconds) drives LAST BLOCK … AGO. */
  setBlock(height: number, spendCount: number, fees: string, timestamp?: number): void {
    this.grid.setRow(0, padR(blockLabel(height, spendCount, fees), BOARD_COLS));
    if (timestamp !== undefined && timestamp !== this.blockTime) {
      this.blockTime = timestamp;
      this.renderStatusRow();
    }
  }

  setAmbient(mempoolSize: number, netspace: string): void {
    this.grid.setRow(
      1,
      padR(
        `MEMPOOL [${mempoolGauge(mempoolSize, 12)}]   NETSPACE ${netspaceText(netspace)}`,
        BOARD_COLS
      )
    );
  }

  /** Switches the header into block-detail mode and shows that block's own stats. */
  setDetail(height: number, status: DetailStatus, spendCount: number, fees: string): void {
    this.grid.setRow(0, padR(detailBlockLabel(height, status, spendCount, fees), BOARD_COLS));
    this.mode = "detail";
    this.renderStatusRow();
  }

  tick(date: Date): void {
    this.clockText = clock(date);
    this.now = date.getTime() / 1000;
    this.renderStatusRow();
  }

  /** LIVE when following the newest spends; a HISTORY marker when scrolled back. */
  setLive(live: boolean): void {
    const mode: HeaderMode = live ? "live" : "history";
    if (this.mode === mode) return;
    this.mode = mode;
    this.renderStatusRow();
  }

  private renderStatusRow(): void {
    const since = this.blockTime === null || this.now === null ? null : this.now - this.blockTime;
    this.grid.setRow(2, padR(statusRowText(this.mode, this.clockText, since), BOARD_COLS));
  }

  update(dt: number): void {
    this.grid.update(dt);
  }
}
