import * as THREE from "three";
import { FIELD, rowZ } from "./layout.js";
import { FARM } from "./palette.js";

export interface Field {
  /** Reveal the soil strip for a row the first time the tractor plows it. */
  plow(row: number): void;
}

export function createField(scene: THREE.Scene): Field {
  const turf = new THREE.Mesh(
    new THREE.CircleGeometry(90, 48),
    new THREE.MeshStandardMaterial({ color: FARM.turf, roughness: 1 })
  );
  turf.rotation.x = -Math.PI / 2;
  scene.add(turf);

  const stripGeometry = new THREE.PlaneGeometry(FIELD.rowLength + 1.4, FIELD.rowSpacing * 0.78);
  const stripMaterial = new THREE.MeshStandardMaterial({ color: FARM.soil, roughness: 1 });
  const strips = Array.from({ length: FIELD.rows }, (_, row) => {
    const strip = new THREE.Mesh(stripGeometry, stripMaterial);
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(0, 0.02, rowZ(row));
    strip.visible = false;
    scene.add(strip);
    return strip;
  });

  // barn beyond the far edge of the field
  const barnZ = rowZ(FIELD.rows - 1) - 6;
  const barn = new THREE.Mesh(
    new THREE.BoxGeometry(7, 3.4, 4.6),
    new THREE.MeshStandardMaterial({ color: FARM.barn, roughness: 0.8 })
  );
  barn.position.set(-10, 1.7, barnZ);
  scene.add(barn);
  const roof = new THREE.Mesh(
    new THREE.CylinderGeometry(0, 3.9, 2.4, 4), // pyramid; close enough at distance
    new THREE.MeshStandardMaterial({ color: FARM.barnRoof, roughness: 0.8 })
  );
  roof.rotation.y = Math.PI / 4;
  roof.position.set(-10, 4.6, barnZ);
  scene.add(roof);

  return {
    plow(row) {
      strips[row].visible = true;
    },
  };
}
