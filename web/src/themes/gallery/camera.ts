import * as THREE from "three";

export interface Framing {
  eye: THREE.Vector3;
  target: THREE.Vector3;
}

/**
 * Camera pose that frames a single piece: directly in front of it (toward +z,
 * the viewer side of the wall) at the distance that fits its height in the
 * vertical FOV, with a little margin.
 */
export function framePiece(
  center: THREE.Vector3,
  height: number,
  fovDeg: number,
  margin = 1.3
): Framing {
  const fov = (fovDeg * Math.PI) / 180;
  const dist = (height * margin) / (2 * Math.tan(fov / 2));
  return { eye: new THREE.Vector3(center.x, center.y, center.z + dist), target: center.clone() };
}
