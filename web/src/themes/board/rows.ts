import type { SproutEvent } from "@grove/shared";
import { mojosToXch, mojosToCAT } from "../../ui/format.js";

export const BOARD_COLS = 48;

const padL = (s: string, n: number) => s.slice(0, n).padStart(n);
const padR = (s: string, n: number) => s.slice(0, n).padEnd(n);

/** Trim a decimal string to at most `maxFrac` fraction digits (no rounding). */
function clampFrac(s: string, maxFrac: number): string {
  const dot = s.indexOf(".");
  return dot < 0 ? s : s.slice(0, dot + 1 + maxFrac).replace(/\.?0+$/, "") || "0";
}

function kindLabel(e: SproutEvent): string {
  return e.kind.toUpperCase(); // XCH / CAT / NFT / DID
}

function asset(e: SproutEvent): string {
  if (e.kind === "cat") return (e.catTicker ?? e.catName ?? "CAT").toUpperCase();
  if (e.kind === "nft") return e.mint ? "MINT" : "TRANSFER";
  if (e.kind === "did") return "PROFILE";
  return "-";
}

function amount(e: SproutEvent): string {
  if (e.kind === "xch") return clampFrac(mojosToXch(e.amount), 4);
  if (e.kind === "cat") return clampFrac(mojosToCAT(e.amount), 3);
  return "-";
}

function status(e: SproutEvent): string {
  return e.mint ? "★ NEW" : "CONFRM";
}

/** One fixed-width ledger line for a spend. Pure. */
export function rowText(event: SproutEvent): string {
  return (
    padR(kindLabel(event), 3) +
    " ▸ " +
    padR(asset(event), 12) +
    " " +
    padL(amount(event), 13) +
    " " +
    padL(String(event.height), 8) +
    " " +
    padR(status(event), 6)
  );
}
