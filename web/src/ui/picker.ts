import * as THREE from "three";
import type { CardMeta, VisualizationHandle } from "../themes/types.js";
import { hideCard, showCard } from "./detail-card.js";

interface Hit {
  object: THREE.Object3D;
  instanceId: number | undefined;
  meta: CardMeta | null;
  height: number | null;
}

/** Identifies a hovered pick target for dedup, independent of whether it carries card data. Pure. */
export function hitKey(
  hit: { object: THREE.Object3D; instanceId: number | undefined } | null
): string {
  if (!hit) return "";
  return `${hit.object.id}:${hit.instanceId ?? -1}`;
}

export function attachPicker(canvas: HTMLCanvasElement, viz: VisualizationHandle): void {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  function intersect(eventX: number, eventY: number): Hit | null {
    pointer.set((eventX / innerWidth) * 2 - 1, -(eventY / innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointer, viz.camera);
    const hits = raycaster.intersectObjects(viz.pickables?.() ?? [], false);
    for (const hit of hits) {
      const meta = viz.metaFor?.(hit.object, hit.instanceId) ?? null;
      const height = viz.pickHeight?.(hit.object, hit.instanceId) ?? null;
      if (meta || height !== null) {
        return { object: hit.object, instanceId: hit.instanceId, meta, height };
      }
    }
    return null;
  }

  // debounce the card only — highlight and cursor stay instant so the
  // scene feels responsive while sweeping across the meadow
  const SHOW_DELAY_MS = 160;
  // generous: leaving a plant must give the pointer time to travel into the
  // card (entering the card then holds it open for the spacescan link)
  const HIDE_DELAY_MS = 600;
  const CARD_EXIT_HIDE_MS = 240;

  let pendingX = -1;
  let pendingY = -1;
  let hoveredKey = "";
  // a click pins the card open so the spacescan link is reachable;
  // click-away (or clicking another plant) releases it
  let pinned = false;
  let insideCard = false;
  let showTimer: number | undefined;
  let hideTimer: number | undefined;

  const clearCardTimers = () => {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
  };

  // the card is interactive while visible; hovering it parks the hide timer
  const card = document.getElementById("card") as HTMLDivElement;
  card.addEventListener("pointerenter", () => {
    insideCard = true;
    clearTimeout(hideTimer);
  });
  card.addEventListener("pointerleave", () => {
    insideCard = false;
    if (!pinned) {
      hideTimer = window.setTimeout(hideCard, CARD_EXIT_HIDE_MS);
    }
  });

  canvas.addEventListener("pointermove", (event) => {
    pendingX = event.clientX;
    pendingY = event.clientY;
  });

  viz.onFrame(() => {
    if (pendingX < 0) return;
    if (viz.isDragging?.()) {
      pendingX = -1;
      return;
    }
    const hit = intersect(pendingX, pendingY);
    pendingX = -1;

    const key = hitKey(hit);
    if (key === hoveredKey) return;
    hoveredKey = key;

    viz.setHovered?.(hit?.object ?? null, hit?.instanceId);
    canvas.style.cursor = hit ? "pointer" : "default";
    if (!pinned && !insideCard) {
      clearCardTimers();
      if (hit?.meta) {
        const meta = hit.meta;
        showTimer = window.setTimeout(() => showCard(meta), SHOW_DELAY_MS);
      } else {
        hideTimer = window.setTimeout(hideCard, HIDE_DELAY_MS);
      }
    }
  });

  canvas.addEventListener("click", (event) => {
    if (viz.isDragging?.()) return;
    const hit = intersect(event.clientX, event.clientY);
    clearCardTimers();
    if (hit && hit.height !== null) {
      pinned = false;
      hideCard();
      viz.selectHeight?.(hit.height);
      return;
    }
    if (hit?.meta) {
      pinned = true;
      showCard(hit.meta);
    } else {
      pinned = false;
      hideCard();
    }
  });
}
