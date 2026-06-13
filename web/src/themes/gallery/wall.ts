import * as THREE from "three";
import { GALLERY } from "./palette.js";
import { WALL } from "./layout.js";

/**
 * The salon backdrop: a long dark wall behind the pieces, a glossy floor that
 * catches the picture-lights, and a far backdrop. Wide on x so the panning
 * camera never runs off the end within a session.
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

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(span, 60),
    new THREE.MeshStandardMaterial({ color: GALLERY.floor, roughness: 0.35, metalness: 0.5 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(span / 2 - 20, 0, WALL.z + 14);
  scene.add(floor);

  scene.fog = new THREE.FogExp2(GALLERY.backdrop, 0.012);
}
