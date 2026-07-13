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
 *
 * When `repeat === 1`, a single canvas is stretched across the entire surface.
 * No tiling is needed, so we use a smaller canvas (256×256), fewer blotches (120),
 * and smaller radii for natural ground grain. Each blotch is drawn once.
 *
 * When `repeat > 1`, the texture tiles across the surface. A tiled texture requires
 * more resolution (each tile covers far less ground) and more/larger blotches so
 * grain is visible at tile scale. Each blotch is drawn nine times — offset by ±1
 * tile in each axis — so that it wraps continuously across tile boundaries; drawn
 * once it would be clipped at the canvas edge and every boundary would show as a seam.
 */
export function mottledTexture(
  base: number,
  light: number,
  dark: number,
  strength = 1,
  repeat = 1
): THREE.CanvasTexture {
  const tiled = repeat !== 1;
  const size = tiled ? 512 : 256;
  const blotchCount = tiled ? 220 : 120;
  const radiusBase = tiled ? 12 : 8;
  const radiusRandom = tiled ? 70 : 40;
  const offsets = tiled ? [-size, 0, size] : [0];

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = hex(base);
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < blotchCount; i++) {
    const r = radiusBase + Math.random() * radiusRandom;
    const x = Math.random() * size;
    const y = Math.random() * size;
    const color = Math.random() < 0.5 ? hex(light) : hex(dark);
    ctx.globalAlpha = Math.min(1, (0.1 + Math.random() * 0.16) * strength);
    for (const ox of offsets) {
      for (const oy of offsets) {
        const grad = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        grad.addColorStop(0, color);
        grad.addColorStop(1, "transparent");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat !== 1) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat, repeat);
  }
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
