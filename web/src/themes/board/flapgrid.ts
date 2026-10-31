// web/src/themes/board/flapgrid.ts
import * as THREE from "three";
import { ATLAS_COLS, FLAP_FOLD, charToGlyph, nextGlyph } from "./glyphs.js";

const FLIP_TIME = 0.06; // seconds per single flap
const STAGGER = 0.012; // per-column riffle start delay
const HIGHLIGHT = 1.8; // hovered-row brightness boost
const ROW_COLOR = new THREE.Color(1, 1, 1);
const HOVER_COLOR = ROW_COLOR.clone().multiplyScalar(HIGHLIGHT);

// Custom unlit shader: each instance samples atlas cells and is tinted by
// instanceColor. ShaderMaterial gets three's instancing attribute prefix
// (instanceMatrix, instanceColor) for free when the mesh is an InstancedMesh.
//
// Two-leaf flip: per instance `aFlap` = (from glyph, to glyph, phase 0..1). The
// quad never moves; the fragment shader composites a Solari card change. Behind
// the moving leaf, the top half already shows the NEW glyph's top and the bottom
// half still shows the OLD glyph's bottom. For phase < 0.5 the old card's upper
// leaf hinges down on the seam (its projected height shrinks with |cos(πp)|);
// for phase ≥ 0.5 that same leaf, now showing the new glyph's bottom on its
// back, falls the rest of the way over the lower half. At phase 0 or with
// from == to it is just the settled card.
//
// Lighting (display-referred): an overhead light falls off down the board and
// toward the side edges (uLightCenter / uLightHalf describe the lit window;
// half = 0 disables it). The card takes the full falloff; the ink only a
// fraction, so text stays legible top to bottom. The moving leaf tilts away
// from the light and darkens, its free edge catching a brief specular glint.
const VERT = /* glsl */ `
  attribute vec3 aFlap;
  varying vec2 vUv;
  varying vec3 vFlap;
  varying vec3 vTint;
  varying vec2 vWorld;
  void main() {
    vUv = uv;
    vFlap = aFlap;
    vTint = instanceColor;
    vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vWorld = w.xy;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const FRAG = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform float uCols;
  uniform float uSeam;
  uniform vec3 uInk;
  uniform vec2 uLightCenter;
  uniform vec2 uLightHalf;
  varying vec2 vUv;
  varying vec3 vFlap;
  varying vec3 vTint;
  varying vec2 vWorld;

  vec4 cellTex(float glyph, vec2 uv) {
    float col = mod(glyph, uCols);
    float row = floor(glyph / uCols);
    // atlas (flipY=false) has v=0 at the canvas top; flip the cell-local v so the
    // plane's top maps to the glyph's top (upright). col/row match glyphCell().
    return texture2D(uAtlas, (vec2(col, row) + vec2(uv.x, 1.0 - uv.y)) / uCols);
  }

  void main() {
    float gFrom = vFlap.x;
    float gTo = vFlap.y;
    float p = vFlap.z;
    float c = abs(cos(p * 3.14159265));
    float ci = max(c, 1e-3);

    float glyph = gFrom;
    vec2 uv = vUv;
    float leaf = 0.0; // 1 on the moving leaf
    float edge = 0.0; // 0 at the hinge .. 1 at the leaf's free edge
    if (vUv.y >= uSeam) {
      float d = vUv.y - uSeam;
      if (p < 0.5 && d <= (1.0 - uSeam) * c) {
        glyph = gFrom; // old upper leaf, falling toward the viewer
        uv.y = uSeam + d / ci;
        leaf = 1.0;
        edge = d / ((1.0 - uSeam) * ci);
      } else {
        glyph = gTo; // the new card's top, revealed behind it
      }
    } else {
      float d = uSeam - vUv.y;
      if (p >= 0.5 && d <= uSeam * c) {
        glyph = gTo; // the leaf's back: new glyph's bottom, settling down
        uv.y = uSeam - d / ci;
        leaf = 1.0;
        edge = d / (uSeam * ci);
      } else {
        glyph = gFrom; // the old card's bottom, not yet covered
      }
    }

    vec4 tex = cellTex(glyph, uv);
    // the atlas bakes the glyph in white on a gray card; recolor only the bright
    // glyph pixels to the ink color so the gray card never picks up the tint
    float luma = dot(tex.rgb, vec3(0.299, 0.587, 0.114));
    float mask = smoothstep(0.46, 0.74, luma);
    vec3 ink = uInk * vTint; // vTint stays white except a hovered row (brightens)

    float light = 1.0;
    if (uLightHalf.x > 0.0) {
      vec2 n = clamp((vWorld - uLightCenter) / uLightHalf, -1.0, 1.0);
      light = mix(0.72, 1.14, n.y * 0.5 + 0.5); // overhead: top brighter
      light *= 1.0 - 0.22 * pow(abs(n.x), 4.0); // falls off toward the sides
    }
    // the moving leaf turns away from the light (c 1 = flat, ~0 = edge-on)
    float fold = mix(1.0, smoothstep(0.0, 1.0, c), leaf);
    float tilt = mix(0.5, 1.0, fold);
    vec3 card = tex.rgb * light * tilt;
    vec3 lit = ink * mix(1.0, light, 0.3) * mix(0.8, 1.0, fold);
    vec3 shade = mix(card, lit, mask);
    // specular glint along the leaf's free edge while it's mid-flip
    shade += vec3(0.16, 0.15, 0.13) * leaf * (1.0 - c) * smoothstep(0.75, 1.0, edge) * light;
    gl_FragColor = vec4(shade, 1.0);
  }
`;

// Solari golden-amber, as raw sRGB components to match the sampled atlas texels.
const INK = new THREE.Vector3(242 / 255, 188 / 255, 28 / 255);

export class FlapGrid {
  readonly mesh: THREE.InstancedMesh;
  readonly rows: number;
  readonly cols: number;

  private readonly cell: number;
  private readonly originX: number;
  private readonly originY: number;

  private readonly cur: Int16Array; // settled glyph (the card being flipped away)
  private readonly nxt: Int16Array; // card the current flip lands on
  private readonly target: Int16Array; // glyph being riffled toward
  private readonly flip: Float32Array; // 0..1 within a flip, -1 = idle
  private readonly wait: Float32Array; // stagger countdown before riffle starts
  private readonly aFlap: THREE.InstancedBufferAttribute; // (from, to, phase)
  private hovered = -1;
  private animating = 0;

  constructor(
    scene: THREE.Scene,
    atlas: THREE.CanvasTexture,
    rows: number,
    cols: number,
    opts: {
      cell?: number;
      originX?: number;
      originY?: number;
      /** lit window (shared by reference so several grids light as one board) */
      light?: { center: THREE.Vector2; half: THREE.Vector2 };
    } = {}
  ) {
    this.rows = rows;
    this.cols = cols;
    this.cell = opts.cell ?? 0.6;
    const n = rows * cols;
    this.originX = opts.originX ?? -((cols - 1) * this.cell) / 2;
    this.originY = opts.originY ?? ((rows - 1) * this.cell) / 2;

    const geo = new THREE.PlaneGeometry(this.cell * 0.92, this.cell * 0.92);
    this.aFlap = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.aFlap.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aFlap", this.aFlap);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uAtlas: { value: atlas },
        uCols: { value: ATLAS_COLS },
        uSeam: { value: 1 - FLAP_FOLD }, // plane v runs bottom→top
        uInk: { value: INK },
        uLightCenter: { value: opts.light?.center ?? new THREE.Vector2() },
        uLightHalf: { value: opts.light?.half ?? new THREE.Vector2() },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
    });

    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.count = n;
    // instanceColor must exist so the shader's `instanceColor` attribute is bound
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(n * 3).fill(1),
      3
    );

    this.cur = new Int16Array(n);
    this.nxt = new Int16Array(n);
    this.target = new Int16Array(n);
    this.flip = new Float32Array(n).fill(-1);
    this.wait = new Float32Array(n);

    // the quads never move — the flip lives entirely in the fragment shader
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const c = i % cols;
      const r = (i - c) / cols;
      m.makeTranslation(this.originX + c * this.cell, this.originY - r * this.cell, 0);
      this.mesh.setMatrixAt(i, m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    // Pin the bounding sphere so raycast picking works before any animation.
    const radius = Math.max(rows, cols) * this.cell;
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), radius);
    scene.add(this.mesh);
  }

  rowOf(instanceId: number): number {
    return Math.floor(instanceId / this.cols);
  }

  idle(): boolean {
    return this.animating === 0;
  }

  setRow(row: number, text: string, instant = false): void {
    for (let c = 0; c < this.cols; c++) {
      const i = row * this.cols + c;
      const g = charToGlyph(text[c] ?? " ");
      this.target[i] = g;
      if (instant) {
        if (this.flip[i] >= 0) this.animating--;
        this.cur[i] = g;
        this.nxt[i] = g;
        this.flip[i] = -1;
        this.wait[i] = 0;
        this.writeFlap(i, g, g, 0);
      } else if (this.cur[i] !== g && this.flip[i] < 0) {
        this.flip[i] = 0;
        this.nxt[i] = this.cur[i]; // the first card is chosen once the stagger ends
        this.wait[i] = c * STAGGER;
        this.animating++;
      }
    }
    this.aFlap.needsUpdate = true;
  }

  clearRow(row: number): void {
    this.setRow(row, "", true);
  }

  highlightRow(row: number | null): void {
    if (this.hovered === (row ?? -1)) return;
    if (this.hovered >= 0) this.applyRowColor(this.hovered, ROW_COLOR);
    this.hovered = row ?? -1;
    if (this.hovered >= 0) this.applyRowColor(this.hovered, HOVER_COLOR);
  }

  private applyRowColor(row: number, color: THREE.Color): void {
    for (let c = 0; c < this.cols; c++) this.mesh.setColorAt(row * this.cols + c, color);
    this.mesh.instanceColor!.needsUpdate = true;
  }

  private writeFlap(i: number, from: number, to: number, phase: number): void {
    const a = this.aFlap.array as Float32Array;
    a[i * 3] = from;
    a[i * 3 + 1] = to;
    a[i * 3 + 2] = phase;
  }

  update(dt: number): void {
    if (this.animating === 0) return;
    // At most one card per frame: under ~16 fps the riffle slows down rather
    // than skipping cards. A flip completes when its phase reaches 1 — no
    // midpoint crossing to detect, so a big dt can never miss a step.
    const step = Math.min(dt, FLIP_TIME) / FLIP_TIME;
    const n = this.cur.length;
    for (let i = 0; i < n; i++) {
      if (this.flip[i] < 0) continue;
      if (this.wait[i] > 0) {
        this.wait[i] = Math.max(0, this.wait[i] - dt);
        continue;
      }
      if (this.nxt[i] === this.cur[i]) this.nxt[i] = nextGlyph(this.cur[i], this.target[i]);
      this.flip[i] += step;
      if (this.flip[i] >= 1) {
        this.cur[i] = this.nxt[i];
        if (this.cur[i] === this.target[i]) {
          this.flip[i] = -1;
          this.animating--;
          this.writeFlap(i, this.cur[i], this.cur[i], 0);
          continue;
        }
        this.flip[i] -= 1; // riffle on to the next card
        this.nxt[i] = nextGlyph(this.cur[i], this.target[i]);
      }
      this.writeFlap(i, this.cur[i], this.nxt[i], this.flip[i]);
    }
    this.aFlap.needsUpdate = true;
  }
}
