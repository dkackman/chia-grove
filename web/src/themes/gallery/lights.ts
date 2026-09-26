import * as THREE from "three";
import { GALLERY } from "./palette.js";
import { WALL } from "./layout.js";
import { PLASTER_GLSL, wallUniforms } from "./wall-shader.js";

// the wall plane sits this far behind a piece's hang point (see wall.ts)
const WALL_GAP = 0.3;
// how high above the frame's top edge the lamp hood hangs, and how far it
// reaches out from the wall
const LAMP_RISE = 0.3;
const LAMP_REACH = 0.62;

/**
 * Picture lights: for every hung piece, a brass lamp arching over the frame
 * and the pool of warm light it throws onto the wall — the classic scalloped
 * wash, brightest just above the frame and fanning downward — plus the soft
 * drop shadow the frame casts beneath it. Everything is instanced by the
 * pieces' slot index, so the whole wall of lights is four draw calls.
 *
 * The wash blends premultiplied: rgb adds the lamp light (lit plaster, same
 * noise as the wall), alpha darkens what's behind it (the drop shadow).
 */
export class PictureLights {
  private wash: THREE.InstancedMesh;
  private hood: THREE.InstancedMesh;
  private arm: THREE.InstancedMesh;
  private lip: THREE.InstancedMesh;
  // per slot: frame half-width, half-height, extra glow (heat/hover/focus), focus flag
  private shape: Float32Array;
  private shapeAttr: THREE.InstancedBufferAttribute;
  private uniforms = {
    ...wallUniforms,
    uLightColor: { value: new THREE.Color(GALLERY.spot) },
    uIntensity: { value: 0.9 },
    uRest: { value: 0.9 },
  };
  private lipMaterial: THREE.MeshBasicMaterial;
  private readonly m = new THREE.Matrix4();
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();

  constructor(scene: THREE.Scene, cap: number) {
    this.shape = new Float32Array(cap * 4);
    this.shapeAttr = new THREE.InstancedBufferAttribute(this.shape, 4);
    this.shapeAttr.setUsage(THREE.DynamicDrawUsage);

    const washGeo = new THREE.PlaneGeometry(1, 1);
    washGeo.setAttribute("aShape", this.shapeAttr);
    const washMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      vertexShader: /* glsl */ `
        attribute vec4 aShape;
        varying vec2 vLocal;
        varying vec2 vWall;
        varying vec2 vQuad;
        varying vec4 vShape;
        void main() {
          // the quad covers the frame, the lamp's spill above it and the
          // fan of light below; sized from the frame's half extents
          vec2 half_ = vec2( aShape.x + 1.6, aShape.y + 1.6 );
          vec2 local = position.xy * 2.0 * half_ + vec2( 0.0, -0.6 );
          vQuad = uv;
          vec4 wp = modelMatrix * instanceMatrix * vec4( local, 0.0, 1.0 );
          vLocal = local;
          vWall = wp.xy;
          vShape = aShape;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uAlbedo;
        uniform vec3 uLightColor;
        uniform float uIntensity;
        uniform float uRest;
        varying vec2 vLocal;
        varying vec2 vWall;
        varying vec2 vQuad;
        varying vec4 vShape;
        ${PLASTER_GLSL}
        void main() {
          float hx = vShape.x;
          float hy = vShape.y;
          if ( hx <= 0.0 ) discard;
          vec2 p = vLocal;

          // scalloped wash from a lamp just above the frame: a cone that widens
          // as it falls, brightest in a crescent above the top edge
          float along = hy + ${LAMP_RISE.toFixed(2)} - p.y; // distance below the lamp
          float spread = 0.5 * hx + 0.35 + max( along, 0.0 ) * 0.6;
          float cone = 1.0 - smoothstep( 0.35, 1.0, abs( p.x ) / spread );
          float reach = hy * 1.8 + 1.1;
          float d = max( along, 0.0 ) / reach;
          float fall = exp( -d * d * 2.4 );
          float crest = smoothstep( -0.3, 0.12, along );
          float crescent = exp( -pow( ( along - 0.28 ) / 0.3, 2.0 ) ) * 0.7;
          // feather toward the quad's edges so the wash never shows its bounds
          float feather = smoothstep( 0.0, 0.14, vQuad.x ) * smoothstep( 1.0, 0.86, vQuad.x )
                        * smoothstep( 0.0, 0.3, vQuad.y );
          float pool = cone * crest * ( fall + crescent ) * feather;

          // soft drop shadow: the frame, nudged down away from the lamp
          vec2 q = abs( p - vec2( 0.0, -0.14 ) ) - vec2( hx, hy ) + 0.05;
          float sd = length( max( q, 0.0 ) ) + min( max( q.x, q.y ), 0.0 ) - 0.05;
          float shadow = 1.0 - smoothstep( -0.04, 0.34, sd );

          float level = mix( uIntensity, uRest, vShape.w ) * ( 1.0 + vShape.z );
          vec3 light = uAlbedo * plaster( vWall ) * uLightColor * vec3( 1.0, 0.84, 0.64 ) * pool * level * 3.6;
          light *= 1.0 - shadow;
          gl_FragColor = vec4( light, shadow * 0.7 );
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.wash = this.instanced(washGeo, washMat, cap);
    this.wash.renderOrder = -1; // over the wall, under everything transparent

    const brass = new THREE.MeshStandardMaterial({
      color: GALLERY.brass,
      metalness: 0.6,
      roughness: 0.35,
      emissive: GALLERY.brass,
      emissiveIntensity: 0.12,
    });
    // hood: a slim cylinder along x (scaled per piece to the frame width)
    const hoodGeo = new THREE.CylinderGeometry(0.05, 0.065, 1, 14, 1);
    hoodGeo.rotateZ(Math.PI / 2);
    this.hood = this.instanced(hoodGeo, brass, cap);

    // arm: from the wall, rising and reaching out to the hood's middle
    const armLen = Math.hypot(LAMP_REACH + WALL_GAP, 0.28);
    const armGeo = new THREE.CylinderGeometry(0.014, 0.014, armLen, 6, 1);
    armGeo.rotateX(Math.atan2(LAMP_REACH + WALL_GAP, 0.28));
    armGeo.translate(0, -0.14, -(LAMP_REACH + WALL_GAP) / 2);
    this.arm = this.instanced(armGeo, brass, cap);

    // the lamp's lit lip: a hot strip under the hood that the bloom picks up
    this.lipMaterial = new THREE.MeshBasicMaterial({ color: GALLERY.spot, toneMapped: false });
    const lipGeo = new THREE.BoxGeometry(0.96, 0.012, 0.05);
    lipGeo.translate(0, -0.055, 0);
    this.lip = this.instanced(lipGeo, this.lipMaterial, cap);

    scene.add(this.wash, this.hood, this.arm, this.lip);
  }

  private instanced(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    cap: number
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false; // instances span the whole (moving) wall
    this.m.makeScale(0, 0, 0);
    for (let i = 0; i < cap; i++) mesh.setMatrixAt(i, this.m);
    return mesh;
  }

  /** Light the piece hung in `slot` at (x, y) with frame half-extents hx, hy. */
  place(slot: number, x: number, y: number, hx: number, hy: number): void {
    const o = slot * 4;
    this.shape[o] = hx;
    this.shape[o + 1] = hy;
    this.shape[o + 2] = 0;
    this.shape[o + 3] = 0;
    this.shapeAttr.needsUpdate = true;

    this.q.identity();
    this.m.compose(this.p.set(x, y, WALL.z - WALL_GAP + 0.02), this.q, this.s.set(1, 1, 1));
    this.wash.setMatrixAt(slot, this.m);

    const lampY = y + hy + LAMP_RISE;
    const lampZ = WALL.z + LAMP_REACH;
    const hoodLen = Math.min(1.1, Math.max(0.5, hx * 0.8));
    this.m.compose(this.p.set(x, lampY, lampZ), this.q, this.s.set(hoodLen, 1, 1));
    this.hood.setMatrixAt(slot, this.m);
    this.lip.setMatrixAt(slot, this.m);
    this.m.compose(this.p.set(x, lampY, lampZ), this.q, this.s.set(1, 1, 1));
    this.arm.setMatrixAt(slot, this.m);
    this.touch();
  }

  /** Switch off the light for an emptied slot. */
  clear(slot: number): void {
    this.shape[slot * 4] = 0;
    this.shapeAttr.needsUpdate = true;
    this.m.makeScale(0, 0, 0);
    this.wash.setMatrixAt(slot, this.m);
    this.hood.setMatrixAt(slot, this.m);
    this.lip.setMatrixAt(slot, this.m);
    this.arm.setMatrixAt(slot, this.m);
    this.touch();
  }

  /** Extra brightness for one lamp (activity heat, hover) and whether it is the focused piece. */
  setGlow(slot: number, glow: number, focused: boolean): void {
    const o = slot * 4;
    const f = focused ? 1 : 0;
    if (this.shape[o + 2] === glow && this.shape[o + 3] === f) return;
    this.shape[o + 2] = glow;
    this.shape[o + 3] = f;
    this.shapeAttr.needsUpdate = true;
  }

  /**
   * Room-level lamp brightness: `intensity` is the live level (dims while a
   * piece is focused, swells on a block), `rest` the undimmed netspace level
   * the focused piece keeps.
   */
  setLevel(intensity: number, rest: number): void {
    this.uniforms.uIntensity.value = intensity;
    this.uniforms.uRest.value = rest;
    this.lipMaterial.color.set(GALLERY.spot).multiplyScalar(0.9 + intensity * 1.1);
  }

  private touch(): void {
    this.wash.instanceMatrix.needsUpdate = true;
    this.hood.instanceMatrix.needsUpdate = true;
    this.lip.instanceMatrix.needsUpdate = true;
    this.arm.instanceMatrix.needsUpdate = true;
  }
}
