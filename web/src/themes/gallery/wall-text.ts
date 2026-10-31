import * as THREE from "three";
import { srgb } from "./media.js";

export interface WallTextStyle {
  width: number; // canvas px
  height: number;
  background: string;
  color: string;
  font: string;
  /** optional thin inset border colour (brass plaques, the placard) */
  border?: string;
}

/**
 * A small canvas texture with one or more centred lines of text — the wall
 * labels (acquisition tags, block plaques, the installation placard). Returns
 * null where there is no DOM canvas (unit tests under node), in which case the
 * caller falls back to its plain material colour.
 */
export function wallTextTexture(lines: string[], style: WallTextStyle): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = style.width;
  canvas.height = style.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = style.background;
  ctx.fillRect(0, 0, style.width, style.height);
  if (style.border) {
    ctx.strokeStyle = style.border;
    ctx.lineWidth = Math.max(2, style.height * 0.04);
    const inset = ctx.lineWidth * 1.5;
    ctx.strokeRect(inset, inset, style.width - inset * 2, style.height - inset * 2);
  }
  ctx.fillStyle = style.color;
  ctx.font = style.font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const step = style.height / (lines.length + 1);
  lines.forEach((line, i) => ctx.fillText(line, style.width / 2, step * (i + 1)));
  const texture = srgb(new THREE.CanvasTexture(canvas));
  texture.anisotropy = 4;
  return texture;
}
