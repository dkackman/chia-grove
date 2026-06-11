import * as THREE from "three";
import type { FloraSystem } from "../scene/flora.js";
import { hideCard, showCard } from "./detail-card.js";

export function attachPicker(
  canvas: HTMLCanvasElement,
  camera: THREE.PerspectiveCamera,
  flora: FloraSystem
): void {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hovering = false;

  function intersect(eventX: number, eventY: number) {
    pointer.set(
      (eventX / innerWidth) * 2 - 1,
      -(eventY / innerHeight) * 2 + 1
    );
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(flora.pickables(), false);
    for (const hit of hits) {
      const meta = flora.metaFor(hit.object, hit.instanceId);
      if (meta) return meta;
    }
    return null;
  }

  canvas.addEventListener("pointermove", (event) => {
    hovering = intersect(event.clientX, event.clientY) !== null;
    canvas.style.cursor = hovering ? "pointer" : "default";
  });

  canvas.addEventListener("click", (event) => {
    const meta = intersect(event.clientX, event.clientY);
    if (meta) showCard(meta);
    else hideCard();
  });
}
