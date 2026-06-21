import * as THREE from "three";
import type { SproutEvent } from "@grove/shared";
import { catColor } from "../shared/cat-color.js";

/** Solari departure-board palette: warm characters on near-black flaps. */
export const BOARD = {
  backdrop: 0x05070a, // room behind the board
  housing: 0x060709, // dark frame showing through the gaps as recessed slots
  flapFace: 0x0b0d10, // unlit flap background (atlas bakes this in)
  flapText: 0xf4ead2, // warm off-white characters
  live: 0x3ad17a, // the LIVE indicator
} as const;

const NFT_ACCENT = new THREE.Color(0xffd166);
const DID_ACCENT = new THREE.Color(0x9b5cff);
const XCH_ACCENT = new THREE.Color(0xf4ead2);

/** Per-kind accent applied to a ledger row's KIND cell. Pure. */
export function kindAccent(event: SproutEvent): THREE.Color {
  if (event.kind === "nft") return NFT_ACCENT.clone();
  if (event.kind === "did") return DID_ACCENT.clone();
  if (event.kind === "cat" && event.assetId) {
    const { h, s, l } = catColor(event.assetId);
    return new THREE.Color().setHSL(h, s, l);
  }
  return XCH_ACCENT.clone();
}
