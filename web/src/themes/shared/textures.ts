import * as THREE from "three";

let _glow: THREE.CanvasTexture | undefined;

/** Soft radial glow dot, tintable via material color. Shared singleton — one GPU upload. */
export function glowTexture(): THREE.CanvasTexture {
  if (_glow) return _glow;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.35, "rgba(255,255,255,0.55)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return (_glow = new THREE.CanvasTexture(canvas));
}

/** Wide horizontal aurora band with vertical falloff. */
export function auroraTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const vertical = ctx.createLinearGradient(0, 0, 0, 128);
  vertical.addColorStop(0, "rgba(0,0,0,0)");
  vertical.addColorStop(0.45, "rgba(61,220,132,0.8)");
  vertical.addColorStop(0.65, "rgba(95,200,255,0.5)");
  vertical.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = vertical;
  ctx.fillRect(0, 0, 512, 128);
  return new THREE.CanvasTexture(canvas);
}

const hex = (c: number) => "#" + c.toString(16).padStart(6, "0");

/**
 * A base color flecked with soft lighter/darker blotches, for use as a ground
 * `map` so a large flat disc reads as a varied surface instead of felt. Set the
 * material color to white so the texture supplies the color.
 */
export function mottledTexture(
  base: number,
  light: number,
  dark: number,
  strength = 1
): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = hex(base);
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 120; i++) {
    const r = 8 + Math.random() * 40;
    const x = Math.random() * size;
    const y = Math.random() * size;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, Math.random() < 0.5 ? hex(light) : hex(dark));
    grad.addColorStop(1, "transparent");
    ctx.globalAlpha = Math.min(1, (0.1 + Math.random() * 0.16) * strength);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Transparent texture with faint horizontal furrow lines; `lines` ≈ row count. */
export function furrowTexture(lines: number): THREE.CanvasTexture {
  const w = 8;
  const h = 512;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.strokeStyle = "rgba(58,72,38,0.65)";
  ctx.lineWidth = 1.5;
  for (let i = 0; i < lines; i++) {
    const y = ((i + 0.5) / lines) * h;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let placeholderTex: THREE.CanvasTexture | null = null;

/**
 * Neutral "content hidden" tile shown in WebGL frames (gallery walls, mine
 * paintings) in place of blocked/sensitive NFT art. A single shared instance —
 * the real art is never fetched for filtered NFTs.
 */
export function sensitivePlaceholderTexture(): THREE.CanvasTexture {
  if (placeholderTex) return placeholderTex;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#1b2230";
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "rgba(159, 182, 201, 0.22)";
  ctx.lineWidth = 4;
  for (let i = -size; i < size; i += 12) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + size, size);
    ctx.stroke();
  }
  placeholderTex = new THREE.CanvasTexture(canvas);
  placeholderTex.colorSpace = THREE.SRGBColorSpace;
  return placeholderTex;
}
