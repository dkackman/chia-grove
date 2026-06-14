import * as THREE from "three";

/**
 * Procedural 16×16 pixel-art block textures, nearest-filtered for the crisp
 * Minecraft look. All are grayscale (centered near white) so the per-instance
 * `instanceColor` tint shows through — one texture serves every dye/hue. Built
 * once on a <canvas>; document access lives only inside these functions so the
 * module stays importable in the (DOM-less) test environment.
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

function gray(v: number): string {
  const c = Math.max(0, Math.min(255, Math.round(v)));
  return `rgb(${c},${c},${c})`;
}

/** Speckled noise with occasional darker clumps — grass / dirt / stone ground. */
export function speckleTexture(size = 16, base = 206, spread = 34): THREE.CanvasTexture {
  const { ctx, canvas } = px(size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const clump = Math.random() < 0.12 ? -30 : 0;
      ctx.fillStyle = gray(base + (Math.random() - 0.5) * spread + clump);
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return nearest(canvas);
}

/** Fine fabric weave for wool / concrete / terracotta CATs. */
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
