import * as THREE from "three";

// The physical board around the flaps: the station-hall wall it hangs on (with
// an overhead light pool and the cabinet's drop shadow), the enamel cabinet with
// its brushed-metal bezel, screws, status lamp and painted column captions, and
// the glass cover's faint sheen. Everything is procedural (SDF shaders + one
// small caption canvas), so it stays crisp at any resolution. None of it is
// pickable — the picker only raycasts the ledger mesh.

/** Where the cabinet sits, in world units. Pure data (see `cabinetLayout`). */
export interface CabinetLayout {
  centerX: number;
  centerY: number;
  /** half-extent of the recessed window the flaps sit in */
  winHalfW: number;
  winHalfH: number;
  /** bezel thickness around the window */
  bezel: number;
  /** outer cabinet size (what the camera must fit) */
  outerW: number;
  outerH: number;
  /** caption rail between the header and the ledger */
  railY: number;
  railH: number;
}

export interface CabinetLayoutInput {
  cols: number;
  cell: number;
  /** flap face size as a fraction of the cell (FlapGrid draws at 0.92) */
  face: number;
  headerOriginY: number;
  headerRows: number;
  ledgerOriginY: number;
  ledgerRows: number;
  /** padding between the flaps and the window edge */
  pad?: number;
  bezel?: number;
}

/**
 * Window, bezel and caption-rail geometry from the two flap grids' placement.
 * Grids are centered on x = 0 (FlapGrid's default originX). Pure.
 */
export function cabinetLayout(i: CabinetLayoutInput): CabinetLayout {
  const pad = i.pad ?? 0.22;
  const bezel = i.bezel ?? 0.5;
  const halfFace = (i.cell * i.face) / 2;
  const gridHalfW = ((i.cols - 1) * i.cell) / 2 + halfFace;
  const top = i.headerOriginY + halfFace + pad;
  const bottom = i.ledgerOriginY - (i.ledgerRows - 1) * i.cell - halfFace - pad;
  const headerBottom = i.headerOriginY - (i.headerRows - 1) * i.cell - halfFace;
  const ledgerTop = i.ledgerOriginY + halfFace;
  const winHalfW = gridHalfW + pad;
  const winHalfH = (top - bottom) / 2;
  return {
    centerX: 0,
    centerY: (top + bottom) / 2,
    winHalfW,
    winHalfH,
    bezel,
    outerW: 2 * (winHalfW + bezel),
    outerH: 2 * (winHalfH + bezel),
    railY: (headerBottom + ledgerTop) / 2,
    railH: Math.max(0, headerBottom - ledgerTop),
  };
}

/** Painted caption above each ledger column: text, first column, alignment. */
export interface Caption {
  text: string;
  col: number;
  /** "right" aligns the caption's end to the last column of `col..col+span-1` */
  align?: "left" | "right";
  span?: number;
}

export type LampState = "live" | "history" | "detail";

const SDF = /* glsl */ `
  float sdRoundRect(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
`;

const WORLD_VERT = /* glsl */ `
  varying vec2 vP;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vP = w.xy;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

// Wall: dark station-hall tile with an overhead light pool centered above the
// board and the cabinet's soft drop shadow. Output is display-referred (no
// color-space conversion in a raw ShaderMaterial).
const WALL_FRAG = /* glsl */ `
  uniform vec2 uCenter;
  uniform vec2 uOuterHalf;
  varying vec2 vP;
  ${SDF}
  void main() {
    vec2 p = vP - uCenter;
    vec3 base = vec3(0.030, 0.032, 0.040);
    // overhead lamp: a warm pool on the wall, brightest just above the cabinet
    vec2 lq = (p - vec2(0.0, uOuterHalf.y * 0.9)) / vec2(uOuterHalf.x * 1.6, uOuterHalf.y * 1.9);
    float pool = exp(-dot(lq, lq) * 1.4);
    vec3 col = base + vec3(0.11, 0.092, 0.07) * pool;
    // large glazed tiles with faint grout, only visible where the light reaches
    vec2 tile = vec2(4.0, 2.0);
    vec2 g = abs(fract(p / tile + vec2(0.5, 0.0)) - 0.5) * tile;
    float grout = 1.0 - smoothstep(0.0, 0.04, min(g.x, g.y));
    col *= 1.0 - grout * 0.22 * pool;
    col += (vnoise(p * 3.0) - 0.5) * 0.008;
    // cabinet drop shadow (light from above → shadow falls below)
    float d = sdRoundRect(p - vec2(0.0, -0.35), uOuterHalf, 0.45);
    col *= 1.0 - 0.8 * (1.0 - smoothstep(-0.4, 1.4, d));
    gl_FragColor = vec4(col, 1.0);
  }
`;

// Cabinet: enamel body, brushed-aluminum lip around the outer edge and the
// window, recessed window backing with an inner shadow under the top lip,
// screws, a status lamp, and a caption rail between header and ledger.
const CAB_FRAG = /* glsl */ `
  uniform vec2 uCenter;
  uniform vec2 uWinHalf;
  uniform float uBezel;
  uniform vec2 uRail; // (y, height) relative to center
  uniform vec3 uLamp;
  uniform float uLampGlow;
  varying vec2 vP;
  ${SDF}
  vec2 outerHalf() { return uWinHalf + uBezel; }
  float dOuter(vec2 p) { return sdRoundRect(p, outerHalf(), 0.32); }
  float dWin(vec2 p) { return sdRoundRect(p, uWinHalf, 0.1); }
  vec3 screw(vec2 q, vec3 col, float lightY) {
    float r = 0.09;
    float d = length(q) - r;
    if (d > 0.03) return col;
    // countersink shadow ring, then a domed head lit from above with a slot
    col = mix(col, col * 0.35, 1.0 - smoothstep(0.0, 0.03, d));
    float head = 1.0 - smoothstep(-0.01, 0.0, d);
    vec3 metal = vec3(0.36, 0.36, 0.38) * (0.75 + 0.5 * (q.y / r * 0.5 + 0.5)) * lightY;
    float slot = 1.0 - smoothstep(0.008, 0.016, abs(dot(q, vec2(0.6, 0.8))));
    metal *= 1.0 - 0.7 * slot * step(length(q), r * 0.8);
    return mix(col, metal, head);
  }
  void main() {
    vec2 p = vP - uCenter;
    float dO = dOuter(p);
    float dW = dWin(p);
    float aa = fwidth(dO) * 1.2;
    float alpha = 1.0 - smoothstep(-aa, aa, dO);
    if (alpha <= 0.0) discard;

    // overhead light: brighter along the top of the cabinet
    float ny = clamp(p.y / outerHalf().y, -1.0, 1.0);
    float lightY = mix(0.62, 1.15, ny * 0.5 + 0.5);
    float vig = 1.0 - 0.25 * pow(abs(p.x / outerHalf().x), 4.0);
    lightY *= vig;

    vec3 col;
    if (dW > 0.0) {
      // satin black enamel with a faint horizontal brushing
      float brush = vnoise(vec2(p.x * 1.2, p.y * 180.0));
      col = vec3(0.075, 0.077, 0.085) * (0.9 + 0.2 * brush) * lightY;
      // the bezel face rounds over toward the outer edge: a soft highlight band
      col += vec3(0.05, 0.048, 0.045) * smoothstep(0.35, 0.06, -dO) * smoothstep(0.02, 0.07, -dO) * lightY;
      // brushed aluminum lip on the outer edge, lit from above (normal.y)
      float e = 0.01;
      float ny0 = (dOuter(p + vec2(0.0, e)) - dOuter(p - vec2(0.0, e))) / (2.0 * e);
      float lip = 1.0 - smoothstep(0.035, 0.07, -dO);
      vec3 alu = vec3(0.34, 0.345, 0.36) * (0.85 + 0.25 * brush) * (0.55 + 0.6 * (ny0 * 0.5 + 0.5)) * lightY;
      col = mix(col, alu, lip);
      // chamfer into the window: the lower lip catches light, the upper lip is in shadow
      float wy = (dWin(p + vec2(0.0, e)) - dWin(p - vec2(0.0, e))) / (2.0 * e);
      float chamfer = 1.0 - smoothstep(0.0, 0.05, dW);
      vec3 cham = vec3(0.26, 0.265, 0.28) * (0.35 + 0.9 * (-wy * 0.5 + 0.5)) * lightY;
      col = mix(col, cham, chamfer);

      // screws: four corners plus top/bottom centers
      vec2 sp = uWinHalf + uBezel * 0.5;
      col = screw(abs(p) - sp, col, lightY);
      col = screw(vec2(p.x, abs(p.y) - sp.y), col, lightY);

      // status lamp on the top bezel, right of center: a lens with a soft halo
      vec2 lq = p - vec2(uWinHalf.x - 0.9, sp.y);
      float ld = length(lq);
      col += uLamp * uLampGlow * 0.25 * exp(-ld * ld * 60.0);
      float lens = 1.0 - smoothstep(0.085, 0.1, ld);
      vec3 lensCol = mix(vec3(0.05), uLamp * (0.35 + 0.9 * uLampGlow), 0.4 + 0.6 * uLampGlow);
      lensCol += vec3(0.5) * exp(-dot(lq - vec2(-0.03, 0.035), lq - vec2(-0.03, 0.035)) * 2500.0);
      col = mix(col, vec3(0.02), 1.0 - smoothstep(0.1, 0.12, ld)); // bezel ring
      col = mix(col, lensCol, lens);
    } else {
      // recessed window backing: near-black, darkest under the top lip's shadow
      float depth = smoothstep(0.0, 0.5, -dW);
      float topShadow = smoothstep(uWinHalf.y - 0.45, uWinHalf.y, p.y);
      col = vec3(0.018, 0.018, 0.022) * mix(0.6, 1.0, depth) * (1.0 - 0.6 * topShadow);
      // caption rail: a flat enamel strip between header and ledger
      float rail = 1.0 - smoothstep(uRail.y * 0.5 - 0.01, uRail.y * 0.5, abs(p.y - uRail.x));
      col = mix(col, vec3(0.045, 0.046, 0.052) * lightY, rail);
    }
    gl_FragColor = vec4(col, alpha);
  }
`;

// Glass cover: a faint overhead reflection at the top and a diagonal sheen
// streak that drifts with the camera's sway (it's a reflection, so it slides as
// the viewpoint moves). Additive and very low — legibility first.
const GLASS_FRAG = /* glsl */ `
  uniform vec2 uCenter;
  uniform vec2 uWinHalf;
  uniform float uShift;
  varying vec2 vP;
  ${SDF}
  void main() {
    vec2 p = vP - uCenter;
    float d = sdRoundRect(p, uWinHalf, 0.1);
    float inside = 1.0 - smoothstep(-0.02, 0.0, d);
    vec2 n = p / uWinHalf;
    float top = smoothstep(0.35, 1.0, n.y) * 0.035;
    // steep diagonal bands (world units): a broad soft one and a thin bright one
    float u = p.x + p.y * 0.7 - uShift;
    float a = (u + 5.0) / 1.8;
    float b = (u + 2.6) / 0.35;
    float streak = exp(-a * a) * 0.04 + exp(-b * b) * 0.03;
    streak *= smoothstep(-1.0, 0.2, n.y); // fades toward the bottom
    vec3 c = vec3(0.85, 0.9, 1.0) * (top + streak) * inside;
    gl_FragColor = vec4(c, 1.0);
  }
`;

const LAMP_COLORS: Record<LampState, THREE.Color> = {
  live: new THREE.Color(0.23, 0.95, 0.5),
  history: new THREE.Color(1.0, 0.68, 0.12),
  detail: new THREE.Color(0.45, 0.75, 1.0),
};

export class Cabinet {
  private readonly lampColor = new THREE.Vector3();
  private readonly lampGlow = { value: 1 };
  private readonly shift = { value: 0 };
  private lamp: LampState = "live";
  private readonly disposables: Array<{ dispose(): void }> = [];

  constructor(
    scene: THREE.Scene,
    layout: CabinetLayout,
    captions: { cell: number; cols: number; items: Caption[] }
  ) {
    const L = layout;
    const center = new THREE.Vector2(L.centerX, L.centerY);
    const winHalf = new THREE.Vector2(L.winHalfW, L.winHalfH);
    this.setLamp("live");

    // wall — big enough to fill the view at the phone-portrait fit distance
    const wall = this.plane(400, 400, WALL_FRAG, {
      uCenter: { value: center },
      uOuterHalf: { value: new THREE.Vector2(L.outerW / 2, L.outerH / 2) },
    });
    wall.position.set(L.centerX, L.centerY, -1.2);
    scene.add(wall);

    const cab = this.plane(L.outerW + 0.1, L.outerH + 0.1, CAB_FRAG, {
      uCenter: { value: center },
      uWinHalf: { value: winHalf },
      uBezel: { value: L.bezel },
      uRail: { value: new THREE.Vector2(L.railY - L.centerY, L.railH) },
      uLamp: { value: this.lampColor },
      uLampGlow: this.lampGlow,
    });
    (cab.material as THREE.ShaderMaterial).transparent = true;
    cab.position.set(L.centerX, L.centerY, -0.05);
    scene.add(cab);

    if (L.railH > 0) {
      const tex = captionTexture(L, captions);
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
      const geo = new THREE.PlaneGeometry(2 * L.winHalfW, L.railH);
      const rail = new THREE.Mesh(geo, mat);
      rail.position.set(L.centerX, L.railY, -0.04);
      scene.add(rail);
      this.disposables.push(tex, mat, geo);
    }

    const glass = this.plane(2 * L.winHalfW, 2 * L.winHalfH, GLASS_FRAG, {
      uCenter: { value: center },
      uWinHalf: { value: winHalf },
      uShift: this.shift,
    });
    const gm = glass.material as THREE.ShaderMaterial;
    gm.transparent = true;
    gm.depthWrite = false;
    gm.blending = THREE.AdditiveBlending;
    glass.position.set(L.centerX, L.centerY, 0.03);
    glass.renderOrder = 10;
    scene.add(glass);
  }

  /** Bezel status lamp: green LIVE, amber HISTORY, blue BLOCK DETAIL. */
  setLamp(state: LampState): void {
    this.lamp = state;
    const c = LAMP_COLORS[state];
    this.lampColor.set(c.r, c.g, c.b);
  }

  /** Per-frame: breathe the live lamp and slide the glass sheen with the camera. */
  update(t: number, cameraX: number, reducedMotion: boolean): void {
    this.lampGlow.value =
      this.lamp === "live" && !reducedMotion ? 0.75 + 0.25 * Math.sin(t * 2.2) : 0.9;
    this.shift.value = cameraX * 6.0; // ±0.25 sway → ±1.5 units of drift
  }

  private plane(
    w: number,
    h: number,
    frag: string,
    uniforms: Record<string, THREE.IUniform>
  ): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: WORLD_VERT,
      fragmentShader: frag,
    });
    this.disposables.push(geo, mat);
    return new THREE.Mesh(geo, mat);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}

/** Painted cream column captions on the rail, aligned to the ledger columns. */
function captionTexture(
  L: CabinetLayout,
  { cell, cols, items }: { cell: number; cols: number; items: Caption[] }
): THREE.CanvasTexture {
  const ppu = 140; // canvas px per world unit
  const w = Math.min(4096, Math.round(2 * L.winHalfW * ppu));
  const scale = w / (2 * L.winHalfW);
  const h = Math.max(8, Math.round(L.railH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const px = (worldX: number) => (worldX + L.winHalfW) * scale;
  const colX = (c: number) => -((cols - 1) * cell) / 2 + c * cell; // FlapGrid column center
  const fontPx = Math.round(h * 0.5);
  ctx.font = `600 ${fontPx}px "Helvetica Neue", Arial, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(226, 219, 199, 0.8)";
  const spacing = fontPx * 0.18;
  for (const item of items) {
    const chars = [...item.text];
    const widths = chars.map((ch) => ctx.measureText(ch).width);
    const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
    const halfFace = (cell * 0.92) / 2;
    let x =
      item.align === "right"
        ? px(colX(item.col + (item.span ?? 1) - 1) + halfFace) - total
        : px(colX(item.col) - halfFace);
    for (let k = 0; k < chars.length; k++) {
      ctx.fillText(chars[k], x, h / 2);
      x += widths[k] + spacing;
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
