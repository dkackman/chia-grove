import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { HELIX_RADIUS, PITCH, STEP_ANGLE, helixAngle } from "./layout.js";
import { FADE_GLSL, type SceneUniforms } from "./shading.js";

/** Seconds for a new segment to grow from the previous crystal to the new one. */
export const INFUSE_SECONDS = 0.9;

const BRAID_RADIUS = 0.3;
/** Full twists per segment — must be a whole number so strands join seamlessly. */
const TWIST = 1;

/**
 * One strand of the braid over a single block segment. Local coordinates run
 * from the previous block (angle −STEP, y −PITCH) to this block (0, 0); the
 * instance transform rotates it into place, so all segments share one geometry.
 */
class StrandCurve extends THREE.Curve<THREE.Vector3> {
  constructor(
    private readonly strand: number,
    private readonly offset: number
  ) {
    super();
  }

  override getPoint(u: number, target = new THREE.Vector3()): THREE.Vector3 {
    const a = (u - 1) * STEP_ANGLE;
    const y = (u - 1) * PITCH;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const tangent = new THREE.Vector3(
      -HELIX_RADIUS * s,
      PITCH / STEP_ANGLE,
      HELIX_RADIUS * c
    ).normalize();
    const inward = new THREE.Vector3(-c, 0, -s);
    const binormal = new THREE.Vector3().crossVectors(tangent, inward).normalize();
    const phi = Math.PI * 2 * (u * TWIST + this.strand / 3);
    return target
      .set(c * HELIX_RADIUS, y, s * HELIX_RADIUS)
      .addScaledVector(inward, Math.cos(phi) * this.offset)
      .addScaledVector(binormal, Math.sin(phi) * this.offset);
  }
}

function strandGeometry(strand: number, offset: number, thickness: number): THREE.BufferGeometry {
  const geo = new THREE.TubeGeometry(new StrandCurve(strand, offset), 40, thickness, 6, false);
  const count = geo.getAttribute("position").count;
  geo.setAttribute("aStrand", new THREE.BufferAttribute(new Float32Array(count).fill(strand), 1));
  geo.deleteAttribute("normal");
  return geo;
}

const VERTEX = /* glsl */ `
attribute float aStrand;
attribute vec4 aSeg; // angle, y, born, dieAt
varying float vU;
varying float vStrand;
varying vec3 vWorld;
varying vec2 vLife;
vec3 rotY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c); }
void main() {
  vec3 world = rotY(position, aSeg.x) + vec3(0.0, aSeg.y, 0.0);
  vU = uv.x;
  vStrand = aStrand;
  vWorld = world;
  vLife = aSeg.zw;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform float uTime;
varying float vU;
varying float vStrand;
varying vec3 vWorld;
varying vec2 vLife;
${FADE_GLSL}
void main() {
  // the segment grows from the previous crystal to the new one as the block is infused
  float reveal = clamp((uTime - vLife.x) / ${INFUSE_SECONDS.toFixed(2)}, 0.0, 1.0);
  if (vU > reveal) discard;

  vec3 col;
  if (vStrand < 0.5) col = vec3(0.22, 1.0, 0.52);       // challenge chain
  else if (vStrand < 1.5) col = vec3(0.25, 0.8, 1.0);   // reward chain
  else if (vStrand < 2.5) col = vec3(0.72, 0.42, 1.0);  // infused challenge chain
  else col = vec3(0.2, 0.75, 0.55) * 0.22;              // glow sheath

  // packets of sequential work flowing up the chain toward the head
  float flow = pow(0.5 + 0.5 * sin(vU * 18.85 - uTime * 3.2 + vStrand * 2.1), 8.0);
  float body = vStrand > 2.5 ? 1.0 : 0.42 + flow * 1.1;
  // the bright infusion front while the segment is still growing
  float front = (1.0 - step(1.0, reveal)) * smoothstep(reveal - 0.14, reveal, vU);
  col = col * body + vec3(1.0, 1.0, 0.9) * front * 3.5;

  // a reorged segment flashes ember-red and burns out
  if (vLife.y > 0.0) {
    float k = clamp((uTime - vLife.y) / 1.2, 0.0, 1.0);
    col = mix(col, vec3(1.6, 0.35, 0.15), 1.0 - k) * (1.0 - k);
  }
  float near = smoothstep(2.0, 9.0, length(cameraPosition - vWorld));
  gl_FragColor = vec4(col * visibility(vWorld) * near, 1.0);
}
`;

/**
 * The braided thread of verifiable time: Chia runs three VDF chains —
 * challenge, reward and infused-challenge — so the thread is three strands
 * twisting about one helix, wrapped in a faint glow sheath. Every block adds
 * one identical segment (instanced, rotated into place), which grows from the
 * previous crystal to the new one as the block is infused.
 */
export class Thread {
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly aSeg: THREE.InstancedBufferAttribute;
  private readonly material: THREE.ShaderMaterial;
  /** block seq held by each instance slot (−1 = empty) */
  private readonly seqs: Int32Array;

  constructor(
    scene: THREE.Scene,
    shared: SceneUniforms,
    private readonly cap: number
  ) {
    const base = mergeGeometries([
      strandGeometry(0, BRAID_RADIUS, 0.05),
      strandGeometry(1, BRAID_RADIUS, 0.05),
      strandGeometry(2, BRAID_RADIUS, 0.05),
      strandGeometry(3, 0, 0.42),
    ]);
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.index = base.index;
    this.geometry.setAttribute("position", base.getAttribute("position"));
    this.geometry.setAttribute("uv", base.getAttribute("uv"));
    this.geometry.setAttribute("aStrand", base.getAttribute("aStrand"));
    this.aSeg = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.aSeg.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("aSeg", this.aSeg);
    this.geometry.instanceCount = 0;
    this.seqs = new Int32Array(cap).fill(-1);

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { ...shared, uTime: { value: 0 } },
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.frustumCulled = false;
    scene.add(mesh);
  }

  /** Grow the segment leading into block `seq`. */
  add(seq: number, t: number): void {
    const i = ((seq % this.cap) + this.cap) % this.cap;
    this.seqs[i] = seq;
    this.aSeg.setXYZW(i, helixAngle(seq), seq * PITCH, t, 0);
    this.upload(i);
    this.geometry.instanceCount = Math.max(this.geometry.instanceCount, i + 1);
  }

  /** Burn out every segment at or after `fromSeq` (reorg). */
  burn(fromSeq: number, t: number): void {
    for (let i = 0; i < this.cap; i++) {
      if (this.seqs[i] >= fromSeq) {
        this.seqs[i] = -1;
        this.aSeg.setW(i, t);
        this.upload(i);
      }
    }
  }

  update(t: number): void {
    this.material.uniforms.uTime.value = t;
  }

  private upload(i: number): void {
    this.aSeg.addUpdateRange(i * 4, 4);
    this.aSeg.needsUpdate = true;
  }
}
