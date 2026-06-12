import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

function wheatBlade(height: number): THREE.BufferGeometry {
  const stalk = new THREE.CylinderGeometry(0.018, 0.03, height, 4);
  stalk.translate(0, height / 2, 0);
  const head = new THREE.ConeGeometry(0.06, 0.28, 5);
  head.translate(0, height + 0.1, 0);
  return mergeGeometries([stalk, head]);
}

export function wheatGeometries(): THREE.BufferGeometry[] {
  const single = wheatBlade(1);

  const left = wheatBlade(0.8);
  left.rotateZ(0.3);
  const right = wheatBlade(0.9);
  right.rotateZ(-0.26);
  const cluster = mergeGeometries([wheatBlade(1), left, right]);

  const bent = wheatBlade(0.95);
  bent.rotateZ(0.14);

  return [single, cluster, bent];
}

export function gourdGeometries(): THREE.BufferGeometry[] {
  // pumpkin: squashed sphere with a stub stem
  const pumpkinBody = new THREE.SphereGeometry(0.26, 10, 8);
  pumpkinBody.scale(1, 0.72, 1);
  pumpkinBody.translate(0, 0.19, 0);
  const stem = new THREE.CylinderGeometry(0.03, 0.045, 0.14, 5);
  stem.translate(0, 0.42, 0);
  const pumpkin = mergeGeometries([pumpkinBody, stem]);

  // cabbage: low round head
  const cabbage = new THREE.SphereGeometry(0.22, 10, 8);
  cabbage.scale(1, 0.85, 1);
  cabbage.translate(0, 0.19, 0);

  // tall squash
  const squashBody = new THREE.CylinderGeometry(0.12, 0.17, 0.4, 8);
  squashBody.translate(0, 0.2, 0);
  const squashTop = new THREE.SphereGeometry(0.12, 8, 6);
  squashTop.translate(0, 0.4, 0);
  const squash = mergeGeometries([squashBody, squashTop]);

  return [pumpkin, cabbage, squash];
}

function sunflower(height: number, headRadius: number): THREE.BufferGeometry {
  const stalk = new THREE.CylinderGeometry(0.03, 0.05, height, 5);
  stalk.translate(0, height / 2, 0);
  const core = new THREE.CylinderGeometry(headRadius * 0.55, headRadius * 0.55, 0.06, 10);
  core.rotateX(0.45); // tip the face toward the camera side of the field
  core.translate(0, height + 0.02, 0.04);
  const petals = new THREE.TorusGeometry(headRadius * 0.78, headRadius * 0.3, 6, 12);
  petals.rotateX(Math.PI / 2 + 0.45); // same facing as the core disc
  petals.translate(0, height + 0.02, 0.04);
  return mergeGeometries([stalk, core, petals]);
}

export function sunflowerGeometries(): THREE.BufferGeometry[] {
  return [sunflower(0.9, 0.16), sunflower(1.1, 0.13), sunflower(0.7, 0.19)];
}

function scarecrow(armTilt: number, hat: boolean): THREE.BufferGeometry {
  const post = new THREE.CylinderGeometry(0.035, 0.05, 1.05, 5);
  post.translate(0, 0.525, 0);
  const arms = new THREE.BoxGeometry(0.78, 0.055, 0.055);
  arms.rotateZ(armTilt);
  arms.translate(0, 0.78, 0);
  const head = new THREE.SphereGeometry(0.11, 8, 6);
  head.translate(0, 1.0, 0);
  const parts = [post, arms, head];
  if (hat) {
    const cone = new THREE.ConeGeometry(0.14, 0.18, 6);
    cone.translate(0, 1.14, 0);
    parts.push(cone);
  }
  return mergeGeometries(parts);
}

export function scarecrowGeometries(): THREE.BufferGeometry[] {
  return [scarecrow(0, true), scarecrow(0.12, false), scarecrow(-0.08, true)];
}
