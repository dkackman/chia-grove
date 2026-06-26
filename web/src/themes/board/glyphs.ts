import * as THREE from "three";

// The board's flap set, one glyph per atlas cell. Space first so an unknown or
// blank cell is cell 0. Letters are uppercase only — charToGlyph folds case. The
// full printable-ASCII symbol block is included because CAT names use it on
// occasion; anything outside this set (emoji, accents) falls back to ▮.
const PUNCT = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"; // all 32 printable ASCII symbols
const SPECIAL = "▸★▮·×"; // markers: block-start ▸, mint ★, missing-glyph ▮, mid-dot ·, times ×
export const GLYPHS = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" + PUNCT + SPECIAL;
export const ATLAS_COLS = 9; // 9×9 = 81 cells ≥ GLYPHS.length (74)

const INDEX = new Map<string, number>();
for (let i = 0; i < GLYPHS.length; i++) INDEX.set(GLYPHS[i], i);

/** Glyph index for a character; folds case, blanks unknowns. Pure. */
export function charToGlyph(ch: string): number {
  if (!ch) return 0;
  return INDEX.get(ch) ?? INDEX.get(ch.toUpperCase()) ?? 0;
}

/**
 * Whether a character has its own flap in the atlas (case-folded). Space counts
 * — it's a real blank cell — so this can't be inferred from `charToGlyph`, which
 * also returns 0 for unknowns. Used to strip un-renderable text before display.
 * Pure.
 */
export function isRenderable(ch: string): boolean {
  return INDEX.has(ch) || INDEX.has(ch.toUpperCase());
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

/**
 * Draw one Solari split-flap card filling [x0,y0 .. x0+S,y0+S]: a plastic face
 * with a vertical sheen, a beveled/recessed edge, the character, and the
 * signature horizontal seam where the two leaves meet (it cuts the glyph).
 */
function drawFlap(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  S: number,
  ch: string
): void {
  const t = Math.max(1, Math.round(S / 32)); // unit line thickness
  const m = Math.max(1, Math.round(S * 0.03)); // gap to the recessed slot
  const r = Math.round(S * 0.1); // rounded card corners
  const w = S - 2 * m;
  const fold = 0.48; // vertical fold position — a touch above the tile center

  // near-black slot the card sits in (shows at the rounded corners + gaps)
  ctx.fillStyle = "#050506";
  ctx.fillRect(x0, y0, S, S);

  // gray plastic card face, lit from the top — kept dark enough that the shader's
  // glyph mask (bright = ink) never mistakes the card for a character
  const face = ctx.createLinearGradient(0, y0, 0, y0 + S);
  face.addColorStop(0, "#525258");
  face.addColorStop(fold - 0.01, "#45454b");
  face.addColorStop(fold, "#3c3c42");
  face.addColorStop(1, "#34343a");
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.roundRect(x0 + m, y0 + m, w, w, r);
  ctx.fill();

  // glyph in WHITE — the shader recolors these bright pixels to the ink color
  if (ch !== " ") {
    ctx.fillStyle = "#ffffff";
    ctx.fillText(ch, x0 + S / 2, y0 + S * 0.5);
  }

  // seam where the two leaves meet (drawn over the glyph so it splits the char);
  // kept faint so it reads as a fold without competing with the glyph
  const mid = Math.round(y0 + S * fold);
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.fillRect(x0 + m, mid - t, w, t); // underside of the upper leaf
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(x0 + m, mid, w, t); // the gap
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(x0 + m, mid + t, w, Math.max(1, t - 1)); // lit top edge of the lower leaf

  // soft top highlight + bottom shadow so the card reads as raised plastic
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  ctx.fillRect(x0 + m + r, y0 + m, w - 2 * r, t);
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(x0 + m + r, y0 + S - m - t, w - 2 * r, t);
}

/** Procedural split-flap glyph atlas (one realistic flap per cell). DOM access stays here. */
export function buildGlyphAtlas(): THREE.CanvasTexture {
  const cell = 64; // px per glyph — room for the seam, bevel, and smooth shading
  const size = ATLAS_COLS * cell;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.font = `700 ${Math.round(cell * 0.6)}px ui-monospace, "DejaVu Sans Mono", monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < GLYPHS.length; i++) {
    const { col, row } = glyphCell(i);
    drawFlap(ctx, col * cell, row * cell, cell, GLYPHS[i]);
  }
  const tex = new THREE.CanvasTexture(canvas);
  // smooth (not pixelated) so the plastic shading and seam read as physical;
  // every cell edge is dark face, so linear/mip bleed between cells is invisible
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  // Canvas is drawn top-down (cell row 0 at the top). flipY defaults to true,
  // which would invert the v axis so glyph row r samples canvas row (cols-1-r).
  // Disable it so texture v aligns with canvas y, and let the shader flip the
  // per-cell uv to keep glyphs upright. Keeps glyphCell() and the shader in sync.
  tex.flipY = false;
  return tex;
}
