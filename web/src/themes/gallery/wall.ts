import * as THREE from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { GALLERY } from "./palette.js";
import { WALL } from "./layout.js";
import { floorReflectionShader } from "./floor-shader.js";

export interface WallHandle {
  /**
   * Recenter the backdrop around this x once the camera drifts near its
   * edge. The backdrop is a fixed-width plane; without this, a long-running
   * session (or a mint burst) eventually pans the camera past its original
   * span, leaving pieces hanging in front of nothing. Solid-colored with no
   * texture, so recentering it is visually seamless.
   */
  follow(cameraX: number): void;
}

/**
 * The salon backdrop: a long dark wall behind the pieces, a reflective floor that
 * mirrors the cards and picture-lights in a subtle wet-sheen, and a far backdrop.
 * Wide on x so the panning camera doesn't visibly cross it; follow() keeps it
 * centered for sessions (or mint bursts) that outrun that width.
 */
export function createWall(scene: THREE.Scene): WallHandle {
  const span = 600;
  // Recenter once the camera gets this close to the edge of the current span,
  // rather than the instant it drifts off-center — avoids constant repositioning.
  const edgeMargin = 100;

  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(span, 40),
    new THREE.MeshStandardMaterial({ color: GALLERY.wallBottom, roughness: 0.95 })
  );
  scene.add(wall);

  // subtle vertical gradient: a second, lighter plane fading in at the top
  const topGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(span, 24),
    new THREE.MeshBasicMaterial({ color: GALLERY.wallTop, transparent: true, opacity: 0.5 })
  );
  scene.add(topGlow);

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
  (floor.material as THREE.ShaderMaterial).uniforms.floorBase.value = new THREE.Color(
    GALLERY.floor
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  scene.fog = new THREE.FogExp2(GALLERY.backdrop, 0.012);

  let centerX = span / 2 - 20; // matches the original fixed placement
  const place = (x: number): void => {
    wall.position.set(x, 8, WALL.z - 0.3);
    topGlow.position.set(x, 16, WALL.z - 0.25);
    floor.position.set(x, 0, WALL.z + 14);
  };
  place(centerX);

  return {
    follow(cameraX: number): void {
      if (Math.abs(cameraX - centerX) < span / 2 - edgeMargin) return;
      centerX = cameraX;
      place(centerX);
    },
  };
}
