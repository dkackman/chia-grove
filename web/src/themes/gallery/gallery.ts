import * as THREE from "three";
import type { GroveFeed } from "../../net/feed.js";
import type { VisualizationHandle } from "../types.js";
import { createPostFx } from "../shared/postfx.js";
import { glowTexture } from "../shared/textures.js";
import { GALLERY } from "./palette.js";
import { WALL } from "./layout.js";
import { createWall } from "./wall.js";
import { Pieces } from "./pieces.js";
import { Placard$ } from "./label.js";
import { SpendDust } from "./dust.js";
import { netspaceLight } from "./ambience.js";
import { shouldHang } from "./select.js";
import { loadArtTexture } from "./media.js";
import { framePiece, panEye } from "./camera.js";

const FOV = 45;
const REST_Y = 2.6;
const REST_Z = 9;
const VIEW_BACK = 6; // keep the camera a little behind the newest piece while panning

export function startGallery(canvas: HTMLCanvasElement, feed: GroveFeed): VisualizationHandle {
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.setSize(innerWidth, innerHeight);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(GALLERY.backdrop);

  const camera = new THREE.PerspectiveCamera(FOV, innerWidth / innerHeight, 0.1, 1000);
  camera.position.set(0, REST_Y, REST_Z);

  const fill = new THREE.HemisphereLight(GALLERY.fill, 0x05060a, 0.5);
  scene.add(fill);
  const spot = new THREE.DirectionalLight(GALLERY.spot, 0.9);
  spot.position.set(0, 30, 18);
  scene.add(spot);

  const postfx = createPostFx(renderer, scene, camera, {
    bloomStrength: 0.18,
    bloomRadius: 0.5,
    bloomThreshold: 0.7,
  });

  createWall(scene);
  const pieces = new Pieces(scene, reducedMotion ? 16 : 28);
  const dust = new SpendDust(scene, glowTexture(), reducedMotion ? 80 : 220);
  const placard = new Placard$();

  // camera state machine
  let focused: { eye: THREE.Vector3; target: THREE.Vector3 } | null = null;
  // the picked mesh of the focused piece, so we can drop focus if that piece is
  // later removed (reorg) or overwritten when the slot pool wraps
  let focusedObject: THREE.Object3D | null = null;
  let lightTarget = 0.9;
  let breath = 0;
  const panTarget = new THREE.Vector3(0, REST_Y, REST_Z);
  const lookTarget = new THREE.Vector3(0, REST_Y - 0.4, WALL.z);
  const tmpLook = new THREE.Vector3();

  // launchers whose art is mid-load — guards the async window so a burst of
  // events for the same brand-new NFT doesn't hang duplicate frames
  const pending = new Set<string>();

  function refreshPlacardIf(launcher: string): void {
    if (focusedObject && pieces.metaFor(focusedObject)?.launcherId === launcher) {
      placard.show(pieces.metaFor(focusedObject)!, pieces.eventCountFor(focusedObject));
    }
  }

  let dustThrottle = 0;

  feed.onEvent((event) => {
    switch (event.type) {
      case "sprout": {
        if (event.kind !== "nft") {
          // non-NFT spends are ambient filler; subsample so big blocks stay calm
          if (dustThrottle++ % 3 === 0) dust.emit(event, pieces.newestX());
          break;
        }
        if (!event.launcherId) break;
        const launcher = event.launcherId;
        if (pieces.hasLauncher(launcher)) {
          // already hung → register activity on the existing frame, no duplicate
          if (pieces.ping(event)) refreshPlacardIf(launcher);
        } else if (shouldHang(event) && event.imageUrl && !pending.has(launcher)) {
          // first sighting with art → load and hang. image → texture, video →
          // looping VideoTexture, audio → skipped; CORS/404/decode errors discard.
          pending.add(launcher);
          loadArtTexture(
            event.imageUrl,
            (texture) => {
              pending.delete(launcher);
              pieces.add(event, texture);
            },
            () => pending.delete(launcher)
          );
        }
        break;
      }
      case "ambient":
        lightTarget = netspaceLight(event.netspace);
        break;
      case "block":
        breath = 1; // soft light pulse, decays in update()
        break;
      case "reorg":
        pieces.removeRecent(event.forkHeight);
        break;
    }
  });

  function focus(object: THREE.Object3D): void {
    const f = pieces.focusOf(object);
    if (!f) return;
    focused = framePiece(f.center, f.height, FOV);
    focusedObject = object;
    const meta = pieces.metaFor(object);
    if (meta) placard.show(meta, pieces.eventCountFor(object));
  }

  function unfocus(): void {
    focused = null;
    focusedObject = null;
    placard.hide();
  }

  // own pointer input (the shared picker is skipped via selfManagedInput)
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  function pick(x: number, y: number): THREE.Object3D | null {
    pointer.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(pieces.pickables(), false)[0]?.object ?? null;
  }
  canvas.addEventListener("pointermove", (e) => {
    const hit = pick(e.clientX, e.clientY);
    pieces.setHovered(hit);
    canvas.style.cursor = hit ? "pointer" : "default";
  });
  canvas.addEventListener("click", (e) => {
    const hit = pick(e.clientX, e.clientY);
    if (hit) focus(hit);
    else unfocus();
  });
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") unfocus();
  });

  const frameCallbacks: Array<() => void> = [];
  const clock = new THREE.Clock();
  function frame(): void {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;

    pieces.update(t, dt);
    dust.setFocused(focused !== null);
    dust.update(dt);

    // drop focus if the focused piece is gone (reorg removal, or slot-pool wrap
    // overwriting it) — otherwise the camera stays locked on an empty wall and
    // the placard keeps showing a piece that no longer exists
    if (focused && focusedObject && !pieces.metaFor(focusedObject)) unfocus();

    // lighting eases toward the netspace target, with a decaying block "breath";
    // while a piece is focused the room dims so the rest of the wall recedes
    // (the art planes use an unlit basic material, so the focused piece stays lit)
    breath = Math.max(0, breath - dt * 1.5);
    const litTarget = focused ? lightTarget * 0.4 : lightTarget;
    spot.intensity += (litTarget - spot.intensity) * Math.min(dt * 2, 1) + breath * dt * 2;
    fill.intensity += (0.4 + litTarget * 0.2 - fill.intensity) * Math.min(dt * 2, 1);

    if (focused) {
      panTarget.copy(focused.eye);
      lookTarget.copy(focused.target);
    } else {
      const newestX = pieces.newestX();
      panTarget.copy(panEye(reducedMotion ? newestX : newestX - VIEW_BACK, REST_Y, REST_Z));
      lookTarget.set(newestX, REST_Y - 0.4, WALL.z);
    }
    const ease = reducedMotion ? 1 : Math.min(dt * 1.6, 1);
    camera.position.lerp(panTarget, ease);
    tmpLook.lerp(lookTarget, ease);
    camera.lookAt(tmpLook);

    for (const fn of frameCallbacks) fn();
    postfx.render();
  }
  tmpLook.copy(lookTarget);
  frame();

  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    postfx.setSize(innerWidth, innerHeight);
  });

  return {
    camera,
    selfManagedInput: true,
    onFrame: (fn) => frameCallbacks.push(fn),
  };
}
