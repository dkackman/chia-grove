// web/src/themes/board/flapgrid.ts
import * as THREE from "three";
import { ATLAS_COLS, charToGlyph, nextGlyph } from "./glyphs.js";

const FLIP_TIME = 0.06; // seconds per single flap
const STAGGER = 0.012; // per-column riffle start delay
const MIN_SQUASH = 0.06; // flap thinness at fold midpoint
const HIGHLIGHT = 1.8; // hovered-row brightness boost
const ROW_COLOR = new THREE.Color(1, 1, 1);
const HOVER_COLOR = ROW_COLOR.clone().multiplyScalar(HIGHLIGHT);

// Custom unlit shader: each instance samples its own atlas cell (aGlyph) and is
// tinted by instanceColor. The squash lives in instanceMatrix.scale.y, so the
// shader stays trivial. ShaderMaterial gets three's instancing attribute prefix
// (instanceMatrix, instanceColor) for free when the mesh is an InstancedMesh.
//
// Lighting (display-referred, applied in the fragment shader): an overhead
// light falls off down the board and toward the side edges (uLightCenter /
// uLightHalf describe the lit window; half = 0 disables it). The flap card takes
// the full falloff; the ink only a fraction of it, so text stays legible top to
// bottom. A leaf mid-flip (instance scale.y < 1) tilts away from the light and
// darkens, with its lower edge catching a brief specular glint.
const VERT = /* glsl */ `
  attribute float aGlyph;
  varying vec2 vUv;
  varying float vGlyph;
  varying vec3 vTint;
  varying vec2 vWorld;
  varying float vSquash;
  void main() {
    vUv = uv;
    vGlyph = aGlyph;
    vTint = instanceColor;
    vSquash = length(instanceMatrix[1].xyz);
    vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vWorld = w.xy;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const FRAG = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform float uCols;
  uniform vec3 uInk;
  uniform vec2 uLightCenter;
  uniform vec2 uLightHalf;
  varying vec2 vUv;
  varying float vGlyph;
  varying vec3 vTint;
  varying vec2 vWorld;
  varying float vSquash;
  void main() {
    float col = mod(vGlyph, uCols);
    float row = floor(vGlyph / uCols);
    // atlas (flipY=false) has v=0 at the canvas top; flip the cell-local v so the
    // plane's top maps to the glyph's top (upright). col/row match glyphCell().
    vec2 cell = (vec2(col, row) + vec2(vUv.x, 1.0 - vUv.y)) / uCols;
    vec4 tex = texture2D(uAtlas, cell);
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
    // a folding leaf turns away from the light (squash 1 = flat, ~0 = edge-on)
    float fold = smoothstep(0.0, 1.0, vSquash);
    float tilt = mix(0.5, 1.0, fold);
    vec3 card = tex.rgb * light * tilt;
    vec3 lit = ink * mix(1.0, light, 0.3) * mix(0.8, 1.0, fold);
    vec3 shade = mix(card, lit, mask);
    // specular glint along the leaf's bottom edge while it's mid-flip
    shade += vec3(0.16, 0.15, 0.13) * (1.0 - fold) * smoothstep(0.75, 1.0, 1.0 - vUv.y) * light;
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

  private readonly cur: Int16Array; // displayed glyph
  private readonly target: Int16Array; // glyph being riffled toward
  private readonly flip: Float32Array; // 0..1 within a flip, -1 = idle
  private readonly wait: Float32Array; // stagger countdown before riffle starts
  private readonly swapped: Uint8Array; // glyph already swapped this flip?
  private readonly aGlyph: THREE.InstancedBufferAttribute;
  private hovered = -1;
  private animating = 0;

  private readonly m = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly scl = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();

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
    this.aGlyph = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    this.aGlyph.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aGlyph", this.aGlyph);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uAtlas: { value: atlas },
        uCols: { value: ATLAS_COLS },
        uInk: { value: INK },
        uLightCenter: { value: opts.light?.center ?? new THREE.Vector2() },
        uLightHalf: { value: opts.light?.half ?? new THREE.Vector2() },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
    });

    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = n;
    // instanceColor must exist so the shader's `instanceColor` attribute is bound
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(n * 3).fill(1),
      3
    );

    this.cur = new Int16Array(n);
    this.target = new Int16Array(n);
    this.flip = new Float32Array(n).fill(-1);
    this.wait = new Float32Array(n);
    this.swapped = new Uint8Array(n);

    for (let i = 0; i < n; i++) this.writeMatrix(i, 1);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.aGlyph.needsUpdate = true;

    // Pin the bounding sphere so raycast picking works before any animation.
    const r = Math.max(rows, cols) * this.cell;
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), r);
    scene.add(this.mesh);
  }

  rowOf(instanceId: number): number {
    return Math.floor(instanceId / this.cols);
  }

  idle(): boolean {
    return this.animating === 0;
  }

  setRow(row: number, text: string, instant = false): void {
    let matrixDirty = false;
    for (let c = 0; c < this.cols; c++) {
      const i = row * this.cols + c;
      const g = charToGlyph(text[c] ?? " ");
      this.target[i] = g;
      if (instant) {
        // Cancelling a cell that was mid-flip leaves its matrix folded
        // (scale.y < 1); restore full height now, because once `animating`
        // hits 0 update() bails early and never re-uploads the matrix.
        if (this.flip[i] >= 0) {
          this.animating--;
          this.writeMatrix(i, 1);
          matrixDirty = true;
        }
        this.cur[i] = g;
        this.flip[i] = -1;
        this.wait[i] = 0;
        this.swapped[i] = 0;
        this.aGlyph.array[i] = g;
      } else if (this.cur[i] !== g && this.flip[i] < 0) {
        this.flip[i] = 0;
        this.wait[i] = c * STAGGER;
        this.swapped[i] = 0;
        this.animating++;
      }
    }
    this.aGlyph.needsUpdate = true;
    if (matrixDirty) this.mesh.instanceMatrix.needsUpdate = true;
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

  private writeMatrix(i: number, squashY: number): void {
    const c = i % this.cols;
    const r = (i - c) / this.cols;
    this.pos.set(this.originX + c * this.cell, this.originY - r * this.cell, 0);
    this.scl.set(1, squashY, 1);
    this.m.compose(this.pos, this.q, this.scl);
    this.mesh.setMatrixAt(i, this.m);
  }

  update(dt: number): void {
    if (this.animating === 0) return;
    dt = Math.min(dt, FLIP_TIME);
    const n = this.cur.length;
    for (let i = 0; i < n; i++) {
      if (this.flip[i] < 0) continue;
      if (this.wait[i] > 0) {
        this.wait[i] = Math.max(0, this.wait[i] - dt);
        continue;
      }
      const prev = this.flip[i];
      this.flip[i] += dt / FLIP_TIME;
      // swap the glyph at the fold midpoint
      if (prev < 0.5 && this.flip[i] >= 0.5 && !this.swapped[i]) {
        this.cur[i] = nextGlyph(this.cur[i], this.target[i]);
        this.aGlyph.array[i] = this.cur[i];
        this.swapped[i] = 1;
      }
      if (this.flip[i] >= 1) {
        this.swapped[i] = 0;
        if (this.cur[i] === this.target[i]) {
          this.flip[i] = -1;
          this.animating--;
          this.writeMatrix(i, 1);
          continue;
        }
        this.flip[i] -= 1; // riffle on to the next glyph
      }
      // squash: 1 at flip 0/1, MIN_SQUASH at flip 0.5
      const sy = MIN_SQUASH + (1 - MIN_SQUASH) * Math.abs(Math.cos(this.flip[i] * Math.PI));
      this.writeMatrix(i, sy);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.aGlyph.needsUpdate = true;
  }
}
