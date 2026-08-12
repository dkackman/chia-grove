import * as THREE from "three";
import { FlapGrid } from "./flapgrid.js";
import { BOARD_COLS } from "./rows.js";
import type { DetailStatus } from "./detail.js";
import { mempoolGauge, netspaceText } from "../../ui/gauges.js";

const padR = (s: string, n: number) => s.slice(0, n).padEnd(n);

export { mempoolGauge };

const clock = (d: Date) =>
  [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");

/** Row-0 text for the header's block-detail variant. Pure. */
export function detailBlockLabel(
  height: number,
  status: DetailStatus,
  spendCount: number,
  fees: string
): string {
  switch (status) {
    case "loaded":
      return `BLOCK ${height}   ${spendCount} SPENDS   ${fees} MOJO FEES`;
    case "empty":
      return `BLOCK ${height}   NO SPENDS THIS BLOCK`;
    case "loading":
      return `BLOCK ${height}   LOADING…`;
    case "error":
      return `BLOCK ${height}   COULD NOT LOAD`;
  }
}

export type HeaderMode = "live" | "history" | "detail";

/** Row-2 (clock + status) text. Pure. */
export function statusRowText(mode: HeaderMode, clockText: string): string {
  const status =
    mode === "detail"
      ? "★ BLOCK DETAIL"
      : mode === "history"
        ? "★ HISTORY · SCROLL UP FOR LIVE"
        : "LIVE";
  return `${clockText}   ${status}`;
}

export class Header {
  private readonly grid: FlapGrid;
  private clockText = "00:00:00";
  private mode: HeaderMode = "live";

  constructor(scene: THREE.Scene, atlas: THREE.CanvasTexture, opts: { originY?: number } = {}) {
    // 3 rows sitting above the ledger; the ledger sets its own originY below this.
    this.grid = new FlapGrid(scene, atlas, 3, BOARD_COLS, { originY: opts.originY ?? 7 });
    this.grid.setRow(0, padR("THE BIG BOARD", BOARD_COLS), true);
  }

  setBlock(height: number, spendCount: number, fees: string): void {
    this.grid.setRow(
      0,
      padR(`BLOCK ${height}   ${spendCount} SPENDS   ${fees} MOJO FEES`, BOARD_COLS)
    );
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
    this.grid.setRow(2, padR(statusRowText(this.mode, this.clockText), BOARD_COLS));
  }

  update(dt: number): void {
    this.grid.update(dt);
  }
}
