import * as THREE from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { GALLERY } from "./palette.js";
import { WALL } from "./layout.js";
import { floorReflectionShader } from "./floor-shader.js";

/**
 * The salon backdrop: a long dark wall behind the pieces, a reflective floor that
 * mirrors the cards and picture-lights in a subtle wet-sheen, and a far backdrop.
 * Wide on x so the panning camera never runs off the end within a session.
 */
export function createWall(scene: THREE.Scene): void {
  const span = 600;

  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(span, 40),
    new THREE.MeshStandardMaterial({ color: GALLERY.wallBottom, roughness: 0.95 })
  );
  wall.position.set(span / 2 - 20, 8, WALL.z - 0.3);
  scene.add(wall);

  // subtle vertical gradient: a second, lighter plane fading in at the top
  const topGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(span, 24),
    new THREE.MeshBasicMaterial({ color: GALLERY.wallTop, transparent: true, opacity: 0.5 })
  );
  topGlow.position.set(span / 2 - 20, 16, WALL.z - 0.25);
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
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(span / 2 - 20, 0, WALL.z + 14);
  scene.add(floor);

  scene.fog = new THREE.FogExp2(GALLERY.backdrop, 0.012);
}
