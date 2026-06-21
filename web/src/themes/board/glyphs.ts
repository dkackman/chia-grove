import * as THREE from "three";

// Index = atlas cell. Space first so an unknown/blank cell is cell 0.
export const GLYPHS = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-:▸★▮·";
export const ATLAS_COLS = 8; // 8×8 = 64 cells ≥ GLYPHS.length

const INDEX = new Map<string, number>();
for (let i = 0; i < GLYPHS.length; i++) INDEX.set(GLYPHS[i], i);

/** Glyph index for a character; folds case, blanks unknowns. Pure. */
export function charToGlyph(ch: string): number {
  if (!ch) return 0;
  return INDEX.get(ch) ?? INDEX.get(ch.toUpperCase()) ?? 0;
}

/** Atlas cell coordinates for a glyph index. Pure. */
export function glyphCell(index: number): { col: number; row: number } {
  return { col: index % ATLAS_COLS, row: Math.floor(index / ATLAS_COLS) };
}

/** One riffle step from `cur` toward `target`, wrapping the table. Pure. */
export function nextGlyph(cur: number, target: number): number {
  if (cur === target) return target;
  return (cur + 1) % GLYPHS.length;
}

/** Procedural nearest-filtered glyph atlas. DOM access stays inside here. */
export function buildGlyphAtlas(): THREE.CanvasTexture {
  const cell = 32; // px per glyph
  const size = ATLAS_COLS * cell;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#0b0d10"; // flap face baked in
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#f4ead2"; // warm character
  ctx.font = `700 ${Math.round(cell * 0.66)}px ui-monospace, "DejaVu Sans Mono", monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < GLYPHS.length; i++) {
    const { col, row } = glyphCell(i);
    const ch = GLYPHS[i];
    if (ch !== " ") ctx.fillText(ch, col * cell + cell / 2, row * cell + cell * 0.54);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
