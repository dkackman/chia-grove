import * as THREE from "three";

/**
 * Procedural 16×16 pixel-art block textures, nearest-filtered for the crisp
 * Minecraft look. CAT textures are grayscale (centered near white) so the
 * per-instance `instanceColor` tint shows through; the ground textures bake in
 * their own colors (grass green / dirt brown) so the grass block can be green
 * on top and dirt on the sides. Built once on a <canvas>; document access lives
 * only inside these functions so the module stays importable in the (DOM-less)
 * test environment.
 */

function px(size: number): { ctx: CanvasRenderingContext2D; canvas: HTMLCanvasElement } {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return { ctx: canvas.getContext("2d")!, canvas };
}

function nearest(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function clamp(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}
function gray(v: number): string {
  const c = clamp(v);
  return `rgb(${c},${c},${c})`;
}
function rgb(r: number, g: number, b: number): string {
  return `rgb(${clamp(r)},${clamp(g)},${clamp(b)})`;
}

/** Fill a rect with colored noise + occasional darker clumps. */
function speckRGB(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  w: number,
  h: number,
  r: number,
  g: number,
  b: number,
  spread: number,
  clumpChance = 0.1,
  clumpDelta = -24
): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const n = (Math.random() - 0.5) * spread + (Math.random() < clumpChance ? clumpDelta : 0);
      ctx.fillStyle = rgb(r + n, g + n, b + n);
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

// Ground colors match palette.MINE (grassTop 0x6aa84f, dirt 0x7a5a3a).
const GRASS = [106, 168, 79] as const;
const DIRT = [122, 90, 58] as const;

/** Grass block top: speckled green. */
export function grassTopTexture(size = 16): THREE.CanvasTexture {
  const { ctx, canvas } = px(size);
  speckRGB(ctx, 0, 0, size, size, GRASS[0], GRASS[1], GRASS[2], 26);
  return nearest(canvas);
}

/** Dirt: speckled brown (block sides/bottom of dirt, and grass-block bottom). */
export function dirtTexture(size = 16): THREE.CanvasTexture {
  const { ctx, canvas } = px(size);
  speckRGB(ctx, 0, 0, size, size, DIRT[0], DIRT[1], DIRT[2], 22, 0.14, -20);
  return nearest(canvas);
}

/** Grass block side: dirt with the iconic jagged green overhang along the top. */
export function grassSideTexture(size = 16): THREE.CanvasTexture {
  const { ctx, canvas } = px(size);
  speckRGB(ctx, 0, 0, size, size, DIRT[0], DIRT[1], DIRT[2], 22, 0.14, -20);
  for (let x = 0; x < size; x++) {
    const depth = 2 + Math.floor(Math.random() * 3); // 2..4 px of green
    for (let y = 0; y < depth; y++) {
      const n = (Math.random() - 0.5) * 26;
      ctx.fillStyle = rgb(GRASS[0] + n, GRASS[1] + n, GRASS[2] + n);
      ctx.fillRect(x, y, 1, 1);
    }
    if (Math.random() < 0.25) {
      const n = (Math.random() - 0.5) * 26;
      ctx.fillStyle = rgb(GRASS[0] + n, GRASS[1] + n, GRASS[2] + n);
      ctx.fillRect(x, depth, 1, 1); // a dribble below the overhang
    }
  }
  return nearest(canvas);
}

/** Fine fabric weave for wool / concrete / terracotta CATs (tinted per-instance). */
export function woolTexture(size = 16): THREE.CanvasTexture {
  const { ctx, canvas } = px(size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const weave = (x + y) % 2 === 0 ? 9 : -9;
      ctx.fillStyle = gray(214 + weave + (Math.random() - 0.5) * 8);
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return nearest(canvas);
}

/** Glassy pane: bright border + a diagonal sheen over a clear field. */
export function glassTexture(size = 16): THREE.CanvasTexture {
  const { ctx, canvas } = px(size);
  ctx.fillStyle = gray(224);
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = gray(255);
  ctx.fillRect(0, 0, size, 1);
  ctx.fillRect(0, 0, 1, size);
  ctx.fillRect(0, size - 1, size, 1);
  ctx.fillRect(size - 1, 0, 1, size);
  ctx.fillStyle = gray(248);
  for (let i = 2; i < size - 2; i++) ctx.fillRect(i, i, 1, 1);
  return nearest(canvas);
}

/** Glowstone-style cells: bright field, darker mortar grid, a few hot nuggets. */
export function emissiveCellTexture(size = 16): THREE.CanvasTexture {
  const { ctx, canvas } = px(size);
  ctx.fillStyle = gray(232);
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = gray(150);
  for (let i = 0; i < size; i += 4) {
    ctx.fillRect(i, 0, 1, size);
    ctx.fillRect(0, i, size, 1);
  }
  ctx.fillStyle = gray(255);
  for (let k = 0; k < 6; k++) {
    ctx.fillRect(1 + ((k * 5) % (size - 2)), 1 + ((k * 3) % (size - 2)), 2, 2);
  }
  return nearest(canvas);
}
