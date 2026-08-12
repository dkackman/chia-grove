import { mempoolGauge, netspaceText } from "../../ui/gauges.js";

const GAUGE_WIDTH = 10;

export interface LakeStrip {
  setMempool(size: number): void;
  setNetspace(bytes: string): void;
}

/**
 * One line of chain weather. Pure, so the formatting is testable without a DOM.
 * A non-finite mempool size prints an em dash rather than "NaN" — the strip
 * renders before the first AmbientEvent arrives.
 */
export function stripText(mempoolSize: number, netspaceBytes: string): string {
  const size = Number.isFinite(mempoolSize) ? String(mempoolSize) : "—";
  const gauge = mempoolGauge(mempoolSize, GAUGE_WIDTH);
  return `MEMPOOL ${gauge} ${size}   NETSPACE ${netspaceText(netspaceBytes)}`;
}

/** Mount the strip into `root` (the `#lake-strip` div) and return its setters. */
export function createLakeStrip(root: HTMLElement): LakeStrip {
  let mempoolSize = NaN;
  let netspaceBytes = "0";
  root.hidden = false;
  const render = () => {
    root.textContent = stripText(mempoolSize, netspaceBytes);
  };
  render();
  return {
    setMempool(size) {
      mempoolSize = size;
      render();
    },
    setNetspace(bytes) {
      netspaceBytes = bytes;
      render();
    },
  };
}
