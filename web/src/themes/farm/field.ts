import * as THREE from "three";
import { FIELD, rowDirection, rowZ } from "./layout.js";
import { furrowTexture } from "../shared/textures.js";
import { createFarmstead } from "./structures.js";
import { STRIP_LENGTH, STRIP_WIDTH, soilMaterial, soilUniforms } from "./soil.js";
import { PASS_SECONDS } from "./tractor.js";

export interface Field {
  /** The tractor starts across `row` at `passStart` (after its headland turn;
   *  in the past for a replayed block): the soil is turned behind it. `now` is
   *  the current time, at which the row it was on counts as finished. */
  plow(row: number, passStart: number, now?: number): void;
  /** Advance ambient detail (soil reveal and drying, the farmstead's smoke and vane). */
  update(t: number): void;
}

export function createField(scene: THREE.Scene, reducedMotion = false, anisotropy = 1): Field {
  // faint furrow lines give the field direction even before it's plowed; sits
  // just above the turf and below the soil strips, which cover it once plowed
  const furrows = new THREE.Mesh(
    new THREE.PlaneGeometry(FIELD.rowLength + 2, FIELD.rows * FIELD.rowSpacing),
    new THREE.MeshBasicMaterial({
      map: furrowTexture(FIELD.rows),
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    })
  );
  furrows.rotation.x = -Math.PI / 2;
  furrows.position.set(0, 0.012, 0);
  scene.add(furrows);

  const stripGeometry = new THREE.PlaneGeometry(STRIP_LENGTH, STRIP_WIDTH);
  // per row: (plow start time, direction, already plowed before this pass)
  const plowState = new Float32Array(FIELD.rows * 3);
  const plowAttr = new THREE.InstancedBufferAttribute(plowState, 3);
  stripGeometry.setAttribute("aPlow", plowAttr);
  const stripMesh = new THREE.InstancedMesh(stripGeometry, soilMaterial(anisotropy), FIELD.rows);
  const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  const plowedMatrices = Array.from({ length: FIELD.rows }, (_, row) => {
    const m = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
    m.setPosition(0, 0.02, rowZ(row));
    return m;
  });
  for (let i = 0; i < FIELD.rows; i++) stripMesh.setMatrixAt(i, hiddenMatrix);
  // InstancedMesh caches a bounding sphere of the instances visible on its
  // first frame; pin one around the whole field so rows plowed later are
  // never culled when the camera is close to them
  stripMesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), STRIP_LENGTH);
  scene.add(stripMesh);
  const plowed = new Array<boolean>(FIELD.rows).fill(false);
  let activeRow = -1;

  const farmstead = createFarmstead(scene, reducedMotion);

  return {
    plow(row, passStart, now = passStart) {
      // the tractor heads for the new row, so the row it was on is finished
      // (matches Tractor.hasPassed, which releases that row's crops at once)
      if (activeRow >= 0 && activeRow !== row) {
        plowState[activeRow * 3] = Math.min(plowState[activeRow * 3], now - PASS_SECONDS);
      }
      activeRow = row;
      plowState[row * 3] = passStart;
      plowState[row * 3 + 1] = rowDirection(row);
      plowState[row * 3 + 2] = plowed[row] ? 1 : 0;
      plowAttr.needsUpdate = true;
      if (!plowed[row]) {
        plowed[row] = true;
        stripMesh.setMatrixAt(row, plowedMatrices[row]);
        stripMesh.instanceMatrix.needsUpdate = true;
      }
    },
    update(t) {
      soilUniforms.uSoilTime.value = t;
      farmstead.update(t);
    },
  };
}
