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

/**
 * Draw one Solari split-flap card filling [x0,y0 .. x0+S,y0+S]: a plastic face
 * with a vertical sheen, a beveled/recessed edge, the character, and the
 * signature horizontal seam where the two leaves meet (it cuts the glyph).
 */
function drawFlap(ctx: CanvasRenderingContext2D, x0: number, y0: number, S: number, ch: string): void {
  // matte plastic face — slightly lit at the top, falling off toward the bottom
  const face = ctx.createLinearGradient(0, y0, 0, y0 + S);
  face.addColorStop(0, "#191c22");
  face.addColorStop(0.48, "#101216");
  face.addColorStop(0.5, "#0c0e12");
  face.addColorStop(1, "#08090c");
  ctx.fillStyle = face;
  ctx.fillRect(x0, y0, S, S);

  // character (drawn before the seam so the seam splits it like a real flap)
  if (ch !== " ") {
    ctx.fillStyle = "#f6edd6";
    ctx.fillText(ch, x0 + S / 2, y0 + S * 0.52);
  }

  // the seam: a dark gap, with the upper leaf's underside shadow above it and
  // the lower leaf's lit top edge below it
  const mid = Math.round(y0 + S / 2);
  const t = Math.max(1, Math.round(S / 32));
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(x0, mid - t, S, t); // underside of the upper leaf
  ctx.fillStyle = "rgba(0,0,0,0.92)";
  ctx.fillRect(x0, mid, S, t); // the gap
  ctx.fillStyle = "rgba(246,237,214,0.10)";
  ctx.fillRect(x0, mid + t, S, Math.max(1, t - 1)); // lit top edge of the lower leaf

  // recessed-card bevel
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(x0, y0, S, t); // top highlight
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(x0, y0 + S - t, S, t); // bottom shadow into the slot
  ctx.fillStyle = "rgba(0,0,0,0.40)";
  ctx.fillRect(x0, y0, t, S); // left side shadow
  ctx.fillRect(x0 + S - t, y0, t, S); // right side shadow
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
