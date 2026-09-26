import * as THREE from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { GALLERY } from "./palette.js";
import { WALL } from "./layout.js";
import { floorReflectionShader } from "./floor-shader.js";
import { createWallMaterial, wallUniforms } from "./wall-shader.js";

export interface WallHandle {
  /**
   * Recenter the backdrop around this x once the camera drifts near its
   * edge. The backdrop is a fixed-width plane; without this, a long-running
   * session (or a mint burst) eventually pans the camera past its original
   * span, leaving pieces hanging in front of nothing. Solid-colored with no
   * texture, so recentering it is visually seamless.
   */
  follow(cameraX: number): void;
  /**
   * Room light reaching the wall and floor this frame: `ambient` is the dim
   * fill on the plaster, `lamps` the picture-light level (warms the floor
   * where the pools spill down the wall).
   */
  setLight(ambient: number, lamps: number): void;
}

/**
 * The salon backdrop: a long plaster wall behind the pieces (picture rail and
 * skirting board painted in by its shader), a polished plank floor that
 * mirrors the frames and picture-light pools in a soft sheen, and a far backdrop.
 * Wide on x so the panning camera doesn't visibly cross it; follow() keeps it
 * centered for sessions (or mint bursts) that outrun that width.
 */
export function createWall(scene: THREE.Scene): WallHandle {
  const span = 600;
  // Recenter once the camera gets this close to the edge of the current span,
  // rather than the instant it drifts off-center — avoids constant repositioning.
  const edgeMargin = 100;

  const wall = new THREE.Mesh(new THREE.PlaneGeometry(span, 40), createWallMaterial());
  scene.add(wall);

  // a real planar mirror: renders the scene from a mirrored virtual camera each
  // frame (via onBeforeRender) so the cards, wall, and picture-lights reflect.
  // the dark color tint dims it and the custom blur shader softens it, so the
  // reflection reads as a subtle wet-sheen rather than a crisp mirror image.
  const floor = new Reflector(new THREE.PlaneGeometry(span, 60), {
    color: GALLERY.floorMirror,
    clipBias: 0.003,
    textureWidth: 1024,
    textureHeight: 1024,
    shader: floorReflectionShader,
  });
  // the dark floor base the faint reflection blends over (kept in the palette)
  const floorUniforms = (floor.material as THREE.ShaderMaterial).uniforms;
  floorUniforms.floorBase.value = new THREE.Color(GALLERY.floorPlank);
  floorUniforms.wallZ.value = WALL.z - 0.3;
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  scene.fog = new THREE.FogExp2(GALLERY.backdrop, 0.012);

  let centerX = span / 2 - 20; // matches the original fixed placement
  const place = (x: number): void => {
    wall.position.set(x, 8, WALL.z - 0.3);
    floor.position.set(x, 0, WALL.z + 14);
  };
  place(centerX);

  return {
    follow(cameraX: number): void {
      if (Math.abs(cameraX - centerX) < span / 2 - edgeMargin) return;
      centerX = cameraX;
      place(centerX);
    },
    setLight(ambient: number, lamps: number): void {
      wallUniforms.uAmbient.value = ambient;
      floorUniforms.ambient.value = ambient;
      floorUniforms.spill.value = lamps;
    },
  };
}
