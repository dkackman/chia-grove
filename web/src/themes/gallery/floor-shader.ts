import type * as THREE from "three";

/**
 * Reflector shader for the gallery floor. The stock `Reflector.ReflectorShader`
 * samples the reflection once (`texture2DProj`) and overlays a tint — a hard,
 * dim mirror. This variant samples a 13-tap poisson-ish disk so the reflection
 * reads as a soft wet-sheen rather than a crisp mirror image. Same uniform names
 * as the stock shader (`color`, `tDiffuse`, `textureMatrix`) so the Reflector
 * wires it up unchanged, plus `blurSize` (spread) and `reflectivity` (how much
 * the reflection shows over the dark floor base — kept low for a faint sheen).
 *
 * A Fresnel term makes the reflection angle-dependent like a real wet floor:
 * faint when looking straight down at the floor underfoot, stronger at grazing
 * angles toward the distance. `fresnelPower` controls how fast it ramps up.
 *
 * Under the reflection lies a polished plank floor: boards running toward the
 * viewer with staggered butt joints, per-board tone and a faint grain, lit by
 * the room `ambient` plus a warm `spill` that pools near the wall where the
 * picture-lights wash down it.
 *
 * Drop-in via the Reflector constructor's `shader` option. `floorBase` (plank
 * albedo) and `wallZ` are set by the caller; `ambient`/`spill` per frame.
 */
export const floorReflectionShader = {
  name: "GalleryFloorReflectorShader",

  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    // UV-space radius of the blur (the visible reflection is mapped 0..1), so
    // ~0.008 ≈ a soft 1%-of-screen spread. Larger = blurrier sheen.
    blurSize: { value: 0.008 as number },
    // how strongly the reflection shows over the dark floor base. low = quite
    // subtle (the floor is mostly its own color with a faint mirrored hint).
    reflectivity: { value: 0.45 as number },
    // how sharply the Fresnel ramp favors grazing angles. higher = reflection
    // stays faint underfoot and only builds up toward the distance.
    fresnelPower: { value: 3.0 as number },
    // dark floor base the reflection blends over; set by the caller from palette.
    floorBase: { value: null as THREE.Color | null },
    // z of the wall the floor meets, for the warm spill of the picture-lights
    wallZ: { value: -3.3 as number },
    ambient: { value: 0.06 as number },
    spill: { value: 0.9 as number },
  },

  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vWorldPos;

    #include <common>
    #include <logdepthbuf_pars_vertex>

    void main() {
      vUv = textureMatrix * vec4( position, 1.0 );
      vWorldPos = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      #include <logdepthbuf_vertex>
    }`,

  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform float blurSize;
    uniform float reflectivity;
    uniform float fresnelPower;
    uniform vec3 floorBase;
    uniform float wallZ;
    uniform float ambient;
    uniform float spill;
    varying vec4 vUv;
    varying vec3 vWorldPos;

    float fHash( vec2 p ) {
      p = fract( p * vec2( 233.34, 851.73 ) );
      p += dot( p, p + 23.45 );
      return fract( p.x * p.y );
    }
    float fNoise( vec2 p ) {
      vec2 i = floor( p );
      vec2 f = fract( p );
      vec2 u = f * f * ( 3.0 - 2.0 * f );
      return mix(
        mix( fHash( i ), fHash( i + vec2( 1.0, 0.0 ) ), u.x ),
        mix( fHash( i + vec2( 0.0, 1.0 ) ), fHash( i + vec2( 1.0, 1.0 ) ), u.x ),
        u.y
      );
    }

    // boards run toward the viewer (along z) so their seams read as perspective
    // lines; returns (tone, seam) — seams anti-aliased and faded with distance
    vec2 planks( vec2 w ) {
      const float BOARD = 0.62;
      const float RUN = 4.2;
      float col = floor( w.x / BOARD );
      float zOff = fHash( vec2( col, 7.0 ) ) * RUN;
      float row = floor( ( w.y + zOff ) / RUN );
      float tone = 0.8 + 0.3 * fHash( vec2( col, row ) );
      float grain = fNoise( vec2( w.x * 38.0, w.y * 1.3 + col * 11.0 ) );
      tone *= 0.9 + 0.2 * grain;
      vec2 f = vec2( fract( w.x / BOARD ), fract( ( w.y + zOff ) / RUN ) );
      vec2 fw = fwidth( vec2( w.x / BOARD, ( w.y + zOff ) / RUN ) );
      vec2 lineW = vec2( 0.012, 0.004 );
      vec2 edge = min( f, 1.0 - f );
      vec2 s = 1.0 - smoothstep( lineW, lineW + fw * 1.5, edge );
      // fade seams once they get finer than a pixel so the distance doesn't shimmer
      s *= 1.0 - smoothstep( 0.15, 0.5, fw );
      return vec2( tone, max( s.x, s.y ) );
    }

    #include <logdepthbuf_pars_fragment>

    float blendOverlay( float base, float blend ) {
      return ( base < 0.5 ? ( 2.0 * base * blend ) : ( 1.0 - 2.0 * ( 1.0 - base ) * ( 1.0 - blend ) ) );
    }

    vec3 blendOverlay( vec3 base, vec3 blend ) {
      return vec3( blendOverlay( base.r, blend.r ), blendOverlay( base.g, blend.g ), blendOverlay( base.b, blend.b ) );
    }

    // offset is in 0..1 reflection-UV space; scale by vUv.w so the shift survives
    // the projective divide in texture2DProj
    vec4 sampleProj( vec2 off ) {
      return texture2DProj( tDiffuse, vec4( vUv.xy + off * vUv.w, vUv.zw ) );
    }

    void main() {
      #include <logdepthbuf_fragment>

      vec2 d = vec2( blurSize );
      vec3 sum = vec3( 0.0 );
      sum += sampleProj( vec2( 0.0 ) ).rgb * 0.18;
      sum += sampleProj( d * vec2(  1.0,  0.0 ) ).rgb * 0.10;
      sum += sampleProj( d * vec2( -1.0,  0.0 ) ).rgb * 0.10;
      sum += sampleProj( d * vec2(  0.0,  1.0 ) ).rgb * 0.10;
      sum += sampleProj( d * vec2(  0.0, -1.0 ) ).rgb * 0.10;
      sum += sampleProj( d * vec2(  0.7,  0.7 ) ).rgb * 0.08;
      sum += sampleProj( d * vec2( -0.7,  0.7 ) ).rgb * 0.08;
      sum += sampleProj( d * vec2(  0.7, -0.7 ) ).rgb * 0.08;
      sum += sampleProj( d * vec2( -0.7, -0.7 ) ).rgb * 0.08;
      sum += sampleProj( d * vec2(  2.0,  0.0 ) ).rgb * 0.025;
      sum += sampleProj( d * vec2( -2.0,  0.0 ) ).rgb * 0.025;
      sum += sampleProj( d * vec2(  0.0,  2.0 ) ).rgb * 0.025;
      sum += sampleProj( d * vec2(  0.0, -2.0 ) ).rgb * 0.025;

      // Fresnel: the floor is horizontal so its world normal is up. looking
      // straight down (view ∥ normal) gives a faint reflection; grazing angles
      // toward the distance ramp it up, like a real wet floor. a small floor
      // keeps a hint underfoot so it never vanishes completely.
      vec3 viewDir = normalize( cameraPosition - vWorldPos );
      float ndv = clamp( dot( vec3( 0.0, 1.0, 0.0 ), viewDir ), 0.0, 1.0 );
      float fresnel = mix( 0.12, 1.0, pow( 1.0 - ndv, fresnelPower ) );

      // tint the blurred reflection, then keep it subtle by blending it over the
      // dark floor base — the floor stays mostly its own color with a faint hint
      vec3 reflection = blendOverlay( sum, color );

      vec2 pk = planks( vec2( mod( vWorldPos.x, 512.0 ), vWorldPos.z ) );
      float nearWall = exp( -max( vWorldPos.z - wallZ, 0.0 ) * 0.3 );
      vec3 warm = vec3( 1.0, 0.82, 0.6 );
      vec3 lit = vec3( 0.25 + ambient * 3.0 ) + warm * spill * 1.6 * nearWall;
      vec3 base = floorBase * pk.x * lit * ( 1.0 - pk.y * 0.45 );
      // the seams are matte; the polished boards carry the sheen
      float sheen = reflectivity * fresnel * ( 1.0 - pk.y );
      gl_FragColor = vec4( mix( base, reflection, sheen ), 1.0 );

      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};
