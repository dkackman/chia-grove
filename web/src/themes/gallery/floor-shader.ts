/**
 * Reflector shader for the gallery floor. The stock `Reflector.ReflectorShader`
 * samples the reflection once (`texture2DProj`) and overlays a tint — a hard,
 * dim mirror. This variant samples a 13-tap poisson-ish disk so the reflection
 * reads as a soft wet-sheen rather than a crisp mirror image. Same uniform names
 * as the stock shader (`color`, `tDiffuse`, `textureMatrix`) so the Reflector
 * wires it up unchanged, plus `blurSize` controlling the spread.
 *
 * Drop-in via the Reflector constructor's `shader` option.
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
  },

  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;

    #include <common>
    #include <logdepthbuf_pars_vertex>

    void main() {
      vUv = textureMatrix * vec4( position, 1.0 );
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      #include <logdepthbuf_vertex>
    }`,

  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform float blurSize;
    varying vec4 vUv;

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

      gl_FragColor = vec4( blendOverlay( sum, color ), 1.0 );

      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};
