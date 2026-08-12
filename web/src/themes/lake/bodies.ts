import * as THREE from "three";

/**
 * Procedural swept bodies for the swimmers. One indexed BufferGeometry per
 * body: elliptical cross-sections swept along the +X spine with a smooth
 * width/height profile, plus flat caudal and dorsal fins. Everything points
 * +X (the swimming direction), matching the old dart's convention so the
 * heading math in shoal.ts and vfx.ts carries over unchanged.
 */
export interface BodySpec {
  /** spine extents; nose > tail, body points +X */
  nose: number;
  tail: number;
  /** peak half-height / half-width of the body */
  height: number;
  width: number;
  /** where along the spine (0 = tail, 1 = nose) the body is fattest */
  peak: number;
  /** rings along the spine / vertices per ring */
  segments: number;
  radial: number;
  /** caudal fin: half-height of the fork and how far it trails the tail */
  finHeight: number;
  finLength: number;
  /** dorsal fin height above the back (0 = none) */
  dorsal: number;
}

/** Smooth 0→1→0 profile along the spine, eased so the taper has no corners. */
export function bodyProfile(u: number, peak: number): number {
  const x = u <= peak ? u / peak : (1 - u) / (1 - peak);
  return Math.sin((Math.PI / 2) * Math.max(0, Math.min(1, x))) ** 0.8;
}

export function sweptBody(spec: BodySpec): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];

  for (let s = 0; s <= spec.segments; s++) {
    const u = s / spec.segments; // 0 at tail, 1 at nose
    const x = spec.tail + u * (spec.nose - spec.tail);
    const p = bodyProfile(u, spec.peak);
    // the epsilon keeps the end rings from collapsing to coincident points,
    // which would give computeVertexNormals zero-area triangles
    const ry = spec.height * p + 0.004;
    const rz = spec.width * p + 0.004;
    for (let r = 0; r < spec.radial; r++) {
      const a = (r / spec.radial) * Math.PI * 2;
      positions.push(x, Math.sin(a) * ry, Math.cos(a) * rz);
    }
  }
  for (let s = 0; s < spec.segments; s++) {
    for (let r = 0; r < spec.radial; r++) {
      const a = s * spec.radial + r;
      const b = s * spec.radial + ((r + 1) % spec.radial);
      indices.push(a, a + spec.radial, b, b, a + spec.radial, b + spec.radial);
    }
  }

  // caudal fin: a forked flat blade trailing off the tail tip (DoubleSide
  // material required, which the fish material already is)
  const f = positions.length / 3;
  positions.push(
    spec.tail + 0.06, 0, 0, // root, tucked just inside the tail
    spec.tail - spec.finLength, spec.finHeight, 0, // upper tip
    spec.tail - spec.finLength * 0.55, 0, 0, // fork notch
    spec.tail - spec.finLength, -spec.finHeight, 0 // lower tip
  );
  indices.push(f, f + 1, f + 2, f, f + 2, f + 3);

  if (spec.dorsal > 0) {
    const d = positions.length / 3;
    const mid = spec.tail + (spec.nose - spec.tail) * spec.peak;
    const back = spec.height * 0.9;
    positions.push(mid + 0.12, back, 0, mid - 0.18, back + spec.dorsal, 0, mid - 0.22, back, 0);
    indices.push(d, d + 1, d + 2);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/** XCH/CAT fish. Same envelope as the retired 9-triangle dart. */
export function fishGeometry(): THREE.BufferGeometry {
  return sweptBody({
    nose: 0.6,
    tail: -0.35,
    height: 0.17,
    width: 0.11,
    peak: 0.62,
    segments: 14,
    radial: 8,
    finHeight: 0.26,
    finLength: 0.26,
    dorsal: 0.1,
  });
}

/** The reorg predator: a stretched pike silhouette. */
export function pikeGeometry(): THREE.BufferGeometry {
  return sweptBody({
    nose: 2.8,
    tail: -2.4,
    height: 0.55,
    width: 0.42,
    peak: 0.55,
    segments: 18,
    radial: 10,
    finHeight: 0.9,
    finLength: 0.8,
    dorsal: 0.3,
  });
}

export interface SwimOpts {
  /** instanced meshes phase by instance position and slow the beat by scale */
  instanced: boolean;
  /** lateral displacement at the tail, in object units */
  amp: number;
  /** tail beats per second-ish (radians/s before the scale divide) */
  freq: number;
  /** spatial wavelength factor along the spine */
  waveLen: number;
  /** nose x and nose-to-tail span, for the amplitude ramp */
  nose: number;
  span: number;
}

/**
 * Spine undulation in the vertex shader — the weed-sway onBeforeCompile
 * pattern. Displacement is lateral (z), ramping from zero at the nose to full
 * at the tail. Instanced bodies read a per-instance constant phase from an
 * `aSwimPhase` InstancedBufferAttribute (seeded per fish by the caller, e.g.
 * `shoal.ts`'s `plant()`) and divide the beat frequency by the instance
 * scale (still read from the instance matrix — scale IS constant per fish),
 * so big fish beat slowly and minnows flutter. A phase drawn from the
 * instance's translation instead would frequency-modulate the beat as the
 * fish moves, which is wrong. Returns a live uniforms holder; write
 * holder.uniforms.uTime.value once per frame.
 */
export function applySwimShader(
  material: THREE.Material,
  opts: SwimOpts
): { uniforms: { uTime: { value: number } } } {
  const holder = { uniforms: { uTime: { value: 0 } } };
  const f = (n: number) => n.toFixed(4);
  // attributes must be declared at top level, alongside the uTime uniform —
  // only the instanced branch has an aSwimPhase attribute to declare
  const attributeDecl = opts.instanced ? "attribute float aSwimPhase;\n" : "";
  const perInstance = opts.instanced
    ? `float swimPhase = aSwimPhase;
        float bodyScale = length(vec3(instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2]));`
    : `float swimPhase = 0.0;
        float bodyScale = 1.0;`;
  material.onBeforeCompile = (s) => {
    s.uniforms.uTime = holder.uniforms.uTime;
    s.vertexShader =
      "uniform float uTime;\n" +
      attributeDecl +
      s.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        ${perInstance}
        float ramp = clamp((${f(opts.nose)} - position.x) / ${f(opts.span)}, 0.0, 1.15);
        transformed.z += sin(uTime * ${f(opts.freq)} / max(bodyScale, 0.4)
                             + swimPhase - position.x * ${f(opts.waveLen)})
                         * ${f(opts.amp)} * ramp * ramp;`
      );
  };
  material.customProgramCacheKey = () => JSON.stringify(opts);
  return holder;
}
