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
 * Drop-in via the Reflector constructor's `shader` option. `floorBase` is set by
 * the caller from the palette so the unreflected floor matches the scene.
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
    reflectivity: { value: 0.16 as number },
    // how sharply the Fresnel ramp favors grazing angles. higher = reflection
    // stays faint underfoot and only builds up toward the distance.
    fresnelPower: { value: 3.0 as number },
    // dark floor base the reflection blends over; set by the caller from palette.
    floorBase: { value: null as THREE.Color | null },
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
    varying vec4 vUv;
    varying vec3 vWorldPos;

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
      gl_FragColor = vec4( mix( floorBase, reflection, reflectivity * fresnel ), 1.0 );

      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};
