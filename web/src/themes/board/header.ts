import * as THREE from "three";
import { FlapGrid } from "./flapgrid.js";
import { BOARD_COLS } from "./rows.js";

const padR = (s: string, n: number) => s.slice(0, n).padEnd(n);

/** A `▮`/`·` fill bar `width` chars wide. Pure. */
export function mempoolGauge(size: number, width: number, full = 5000): string {
  const filled = Math.round(Math.min(1, size / full) * width);
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

export class Header {
  private readonly grid: FlapGrid;
  private mempoolSize = 0;
  private netspace = "0";

  constructor(scene: THREE.Scene, atlas: THREE.CanvasTexture, opts: { originY?: number } = {}) {
    // 3 rows sitting above the ledger; the ledger sets its own originY below this.
    this.grid = new FlapGrid(scene, atlas, 3, BOARD_COLS, { originY: opts.originY ?? 7 });
    this.grid.setRow(0, padR("THE BIG BOARD", BOARD_COLS), true);
  }

  setBlock(height: number, spendCount: number, fees: string): void {
    this.grid.setRow(0, padR(`BLOCK ${height}   ${spendCount} SPENDS   ${fees} MOJO FEES`, BOARD_COLS));
  }

  setAmbient(mempoolSize: number, netspace: string): void {
    this.mempoolSize = mempoolSize;
    this.netspace = netspace;
    this.grid.setRow(
      1,
      padR(`MEMPOOL [${mempoolGauge(mempoolSize, 12)}]   NETSPACE ${netspaceText(netspace)}`, BOARD_COLS)
    );
  }

  tick(date: Date): void {
    this.grid.setRow(2, padR(`${clock(date)}   LIVE`, BOARD_COLS));
  }

  update(dt: number): void {
    this.grid.update(dt);
  }
}
