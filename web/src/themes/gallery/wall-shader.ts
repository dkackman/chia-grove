import * as THREE from "three";
import { GALLERY } from "./palette.js";

/** Height of the painted baseboard along the bottom of the wall. */
export const SKIRTING_H = 0.3;
/** Height of the picture rail near the top of the visible wall. */
export const RAIL_Y = 9.6;

/**
 * Uniforms shared by reference between the wall and the picture-light pools
 * (lights.ts), so the lit plaster in a pool is the very same surface as the
 * dim plaster around it.
 */
export const wallUniforms = {
  uAlbedo: { value: new THREE.Color(GALLERY.wallAlbedo) },
  uAmbient: { value: 0.06 }, // room fill reaching the wall; set per frame
};

/**
 * Plaster: three octaves of value noise → an albedo multiplier around 1.0.
 * World x is wrapped so precision holds however far a long session pans
 * (a seam every 512 units is invisible at this contrast).
 */
export const PLASTER_GLSL = /* glsl */ `
  float gHash( vec2 p ) {
    p = fract( p * vec2( 123.34, 456.21 ) );
    p += dot( p, p + 45.32 );
    return fract( p.x * p.y );
  }
  float gNoise( vec2 p ) {
    vec2 i = floor( p );
    vec2 f = fract( p );
    vec2 u = f * f * ( 3.0 - 2.0 * f );
    return mix(
      mix( gHash( i ), gHash( i + vec2( 1.0, 0.0 ) ), u.x ),
      mix( gHash( i + vec2( 0.0, 1.0 ) ), gHash( i + vec2( 1.0, 1.0 ) ), u.x ),
      u.y
    );
  }
  float plaster( vec2 w ) {
    w.x = mod( w.x, 512.0 );
    float n = gNoise( w * vec2( 0.55, 0.8 ) ) * 0.5
            + gNoise( w * 2.3 ) * 0.3
            + gNoise( w * 11.0 ) * 0.2;
    return 0.8 + n * 0.4;
  }
`;

/**
 * The gallery wall: trowelled plaster under a dim ambient that fades toward
 * the ceiling, a picture rail near the top, and a painted skirting board with
 * a lit top edge and a contact shadow above the floor. Unlit — the room's
 * light arrives as uniforms (ambient here, lamp pools in lights.ts).
 */
export function createWallMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...wallUniforms,
      uSkirting: { value: new THREE.Color(GALLERY.skirting) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4( position, 1.0 );
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uAlbedo;
      uniform float uAmbient;
      uniform vec3 uSkirting;
      varying vec3 vWorld;
      ${PLASTER_GLSL}
      void main() {
        float y = vWorld.y;
        vec2 w = vec2( vWorld.x, y );
        // ambient gathers around the hang and falls off toward the ceiling
        float v = 0.3 + 0.7 * smoothstep( 11.0, 3.0, y );
        vec3 col = uAlbedo * plaster( w ) * uAmbient * v;

        // picture rail: a thin moulding with a lit top edge and a soft shadow below
        float rd = y - ${RAIL_Y.toFixed(2)};
        float rail = step( -0.05, rd ) * step( rd, 0.05 );
        float railTop = smoothstep( 0.0, 0.05, rd ) * rail;
        float railShadow = ( 1.0 - smoothstep( -0.35, -0.05, rd ) ) * step( rd, -0.05 ) * step( -0.6, rd );
        col *= 1.0 - railShadow * 0.35 * smoothstep( -0.6, -0.05, rd );
        col = mix( col, uAlbedo * uAmbient * ( 0.9 + railTop * 1.2 ), rail );

        // skirting board with a highlight on its top edge, and a darker contact
        // band where it meets the floor
        float sk = ${SKIRTING_H.toFixed(2)};
        if ( y < sk ) {
          float edge = smoothstep( sk - 0.04, sk, y );
          col = uSkirting * ( 0.55 + 0.45 * smoothstep( 0.0, sk, y ) ) + uAlbedo * uAmbient * edge * 1.6;
        } else {
          col *= 1.0 - 0.3 * ( 1.0 - smoothstep( sk, sk + 0.25, y ) );
        }

        gl_FragColor = vec4( col, 1.0 );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
