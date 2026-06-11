import * as THREE from "three";
import type { SproutEvent } from "@grove/shared";
import type { FloraSystem } from "../scene/flora.js";
import { hideCard, showCard } from "./detail-card.js";

interface Hit {
  object: THREE.Object3D;
  instanceId: number | undefined;
  meta: SproutEvent;
}

export function attachPicker(
  canvas: HTMLCanvasElement,
  camera: THREE.PerspectiveCamera,
  flora: FloraSystem,
  onFrame: (fn: () => void) => void
): void {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  function intersect(eventX: number, eventY: number): Hit | null {
    pointer.set(
      (eventX / innerWidth) * 2 - 1,
      -(eventY / innerHeight) * 2 + 1
    );
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(flora.pickables(), false);
    for (const hit of hits) {
      const meta = flora.metaFor(hit.object, hit.instanceId);
      if (meta) return { object: hit.object, instanceId: hit.instanceId, meta };
    }
    return null;
  }

  // debounce the card only — highlight and cursor stay instant so the
  // scene feels responsive while sweeping across the meadow
  const SHOW_DELAY_MS = 160;
  const HIDE_DELAY_MS = 240;

  let pendingX = -1;
  let pendingY = -1;
  let hoveredCoinId: string | null = null;
  // a click pins the card open so the spacescan link is reachable;
  // click-away (or clicking another plant) releases it
  let pinned = false;
  let showTimer: number | undefined;
  let hideTimer: number | undefined;

  const clearCardTimers = () => {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
  };

  canvas.addEventListener("pointermove", (event) => {
    pendingX = event.clientX;
    pendingY = event.clientY;
  });

  onFrame(() => {
    if (pendingX < 0) return;
    const hit = intersect(pendingX, pendingY);
    pendingX = -1;

    const coinId = hit?.meta.coinId ?? null;
    if (coinId === hoveredCoinId) return;
    hoveredCoinId = coinId;

    flora.setHovered(hit?.object ?? null, hit?.instanceId);
    canvas.style.cursor = hit ? "pointer" : "default";
    if (!pinned) {
      clearCardTimers();
      if (hit) {
        const meta = hit.meta;
        showTimer = window.setTimeout(() => showCard(meta), SHOW_DELAY_MS);
      } else {
        hideTimer = window.setTimeout(hideCard, HIDE_DELAY_MS);
      }
    }
  });

  canvas.addEventListener("click", (event) => {
    const hit = intersect(event.clientX, event.clientY);
    clearCardTimers();
    if (hit) {
      pinned = true;
      showCard(hit.meta);
    } else {
      pinned = false;
      hideCard();
    }
  });
}
