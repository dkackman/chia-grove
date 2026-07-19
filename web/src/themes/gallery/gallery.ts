import * as THREE from "three";
import type { GroveFeed } from "../../net/feed.js";
import type { VisualizationHandle } from "../types.js";
import { createPostFx } from "../shared/postfx.js";
import { createFrameLimiter } from "../shared/frame-limiter.js";
import { glowTexture } from "../shared/textures.js";
import { GALLERY } from "./palette.js";
import { WALL } from "./layout.js";
import { createWall } from "./wall.js";
import { Pieces } from "./pieces.js";
import { Placard$ } from "./label.js";
import { PlayButton$ } from "./play-button.js";
import { SpendDust } from "./dust.js";
import { netspaceLight } from "./ambience.js";
import { shouldHang } from "./select.js";
import { loadArtTexture } from "./media.js";
import { resolveMedia, thumbnailSrc } from "../../ui/media.js";
import { sensitivePlaceholderTexture } from "../shared/textures.js";
import { framePiece } from "./camera.js";
import { FlingTracker } from "./swipe.js";
import { LoadPool } from "../shared/load-pool.js";

const FOV = 45;

// Cap concurrent /img fetches. A snapshot replay pours hundreds of NFT mints
// through the wall in ~3 s; loading every one bursts past the proxy's per-IP
// rate limit (429s). A small cap paces the fetches, and the generation guard
// below drops loads for NFTs that newer arrivals would wrap straight off the
// wall — collapsing the flood to the pieces that actually stay hung.
const ART_LOAD_CONCURRENCY = 10;
// Safety net for a load that never settles (a stalled fetch, a video whose
// loadedmetadata/seeked/error never fires) — without it, the job would hold
// its LoadPool slot forever, silently shrinking effective concurrency.
const ART_LOAD_TIMEOUT_MS = 20_000;
const REST_Y = 4.2; // vertical center of the 3-row grid
const REST_Z = 12; // pulled back so ~10–15 pieces are in frame at once
const VIEW_AHEAD = 5; // keep the newest column right-of-center while auto-following
const IDLE_RESUME_S = 4; // resume auto-follow this long after the last manual pan
const PAN_LEFT_LIMIT = -2; // how far left of the first column the view may pan

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

  // threshold sits at 1.0 so flat (LDR) art — most NFTs are near-white — never
  // blooms and washes out the wall; only the hot frame glow (emissive >1.0 on an
  // active piece) and additive dust cross it
  const postfx = createPostFx(renderer, scene, camera, {
    bloomStrength: 0.18,
    bloomRadius: 0.5,
    bloomThreshold: 1.0,
  });

  const wall = createWall(scene);
  const pieces = new Pieces(scene, reducedMotion ? 24 : 60);
  const dust = new SpendDust(scene, glowTexture(), reducedMotion ? 80 : 220);
  const placard = new Placard$();
  const playButton = new PlayButton$();

  // camera state machine
  let focused: { eye: THREE.Vector3; target: THREE.Vector3 } | null = null;
  // the picked mesh of the focused piece, so we can drop focus if that piece is
  // later removed (reorg) or overwritten when the slot pool wraps
  let focusedObject: THREE.Object3D | null = null;
  let lightTarget = 0.9;
  let breath = 0;
  const panTarget = new THREE.Vector3(0, REST_Y, REST_Z);
  const lookTarget = new THREE.Vector3(0, REST_Y, WALL.z);
  const tmpLook = new THREE.Vector3();

  // horizontal browsing: the camera auto-follows the newest column, but a drag or
  // ←/→ takes manual control (manualX) until IDLE_RESUME_S of quiet, after which it
  // eases back to "live". The camera's own lerp is the single smoother.
  let manualX = 0;
  let manualUntil = 0;
  let nowT = 0; // latest frame time, so input handlers share the render clock

  const clampPan = (x: number): number => Math.max(PAN_LEFT_LIMIT, Math.min(pieces.newestX(), x));
  const worldPerPixel = (): number =>
    (2 * (REST_Z - WALL.z) * Math.tan((FOV * Math.PI) / 180 / 2) * camera.aspect) / innerWidth;

  // launchers whose art is queued or mid-load — guards the async window so a
  // burst of events for the same brand-new NFT doesn't hang duplicate frames
  const pending = new Set<string>();
  // paces and coalesces art fetches so a snapshot flood can't 429 the proxy
  const artLoads = new LoadPool(ART_LOAD_CONCURRENCY, ART_LOAD_TIMEOUT_MS);
  let nftSeq = 0; // monotonic order of NFTs queued for hanging

  function refreshPlacardIf(launcher: string): void {
    if (focusedObject && pieces.metaFor(focusedObject)?.launcherId === launcher) {
      placard.show(pieces.metaFor(focusedObject)!, pieces.eventCountFor(focusedObject));
    }
  }

  // A flag can land while its piece is focused with the play button armed
  // (paused, or already playing). Either way the button's bound <video> and
  // onFirstPlay closure are now stale — hide() unbinds them so a click can't
  // resurrect playback or corrupt the placeholder markSensitive just hung.
  function hidePlayButtonIf(launcher: string): void {
    if (focusedObject && pieces.metaFor(focusedObject)?.launcherId === launcher) {
      playButton.hide();
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
          break;
        }
        if (!shouldHang(event) || pending.has(launcher)) break;
        const media = resolveMedia(event);
        if (media.render === "none") break;
        if (media.render !== "art") {
          // blocked/sensitive → hang a neutral placeholder; never fetch the art.
          // Clone the singleton because pieces disposes mat.map on slot eviction;
          // a clone keeps the shared source intact so future filtered frames render.
          pieces.add(event, sensitivePlaceholderTexture().clone());
          break;
        }
        const src = media.src;
        const kind = media.kind;
        const poster = thumbnailSrc(event) ?? undefined;
        pending.add(launcher);
        const mySeq = nftSeq++;
        artLoads.submit({
          // if this many newer NFTs have queued behind it, this one would be
          // wrapped straight off the wall — skip the fetch (and free its guard)
          stillWanted: () => nftSeq - mySeq < pieces.capacity,
          onDrop: () => pending.delete(launcher),
          onTimeout: () => pending.delete(launcher),
          start: (done) => {
            loadArtTexture(
              src,
              kind,
              (texture, video) => {
                done(); // release the pool slot regardless of dedup outcome
                pending.delete(launcher);
                pieces.add(event, texture, video);
              },
              () => {
                done();
                pending.delete(launcher);
              },
              poster
            );
          },
        });
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
      case "content-flag": {
        if (pieces.markSensitive(event.launcherId, sensitivePlaceholderTexture().clone())) {
          refreshPlacardIf(event.launcherId);
          hidePlayButtonIf(event.launcherId);
        }
        break;
      }
    }
  });

  function focus(object: THREE.Object3D): void {
    const f = pieces.focusOf(object);
    if (!f) return;
    focused = framePiece(f.center, f.height, FOV);
    focusedObject = object;
    const meta = pieces.metaFor(object);
    if (meta) placard.show(meta, pieces.eventCountFor(object));
    // a video piece gets a manual ▶ overlay (never autoplayed); images do not
    const video = pieces.videoFor(object);
    if (video) {
      playButton.show(video, () => pieces.swapToVideo(object, video));
    } else {
      playButton.hide();
    }
  }

  function unfocus(): void {
    focused = null;
    focusedObject = null;
    placard.hide();
    playButton.hide(); // pauses + resets the video to its poster still
  }

  // own pointer input (the shared picker is skipped via selfManagedInput)
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  function pick(x: number, y: number): THREE.Object3D | null {
    pointer.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(pieces.pickables(), false)[0]?.object ?? null;
  }
  // a pointer drag pans the wall; a tap (no real movement) focuses/unfocuses
  const DRAG_THRESHOLD = 6; // px before a press counts as a pan, not a tap
  let downX = 0;
  let downY = 0;
  let lastX = 0;
  let dragging = false;
  // release velocity → a decaying momentum glide; the camera lerp is the decelerator
  const fling = new FlingTracker();

  canvas.addEventListener("pointerdown", (e) => {
    downX = lastX = e.clientX;
    downY = e.clientY;
    dragging = false;
    fling.reset(e.timeStamp);
    // Panning has no effect while zoomed into a piece (frame()'s focused
    // branch ignores manual/manualX entirely) — don't seed it from the
    // close-up camera position, which uses a different framing distance than
    // worldPerPixel() assumes and would corrupt the pan resumed on unfocus.
    if (!focused) manualX = camera.position.x;
    canvas.setPointerCapture?.(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (e.buttons & 1) {
      const dx = e.clientX - lastX;
      lastX = e.clientX;
      if (!dragging && Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > DRAG_THRESHOLD) {
        dragging = true;
      }
      if (dragging) {
        const step = -dx * worldPerPixel();
        if (!focused) {
          manualX = clampPan(manualX + step);
          manualUntil = nowT + IDLE_RESUME_S;
        }
        fling.sample(step, e.timeStamp);
        canvas.style.cursor = "grabbing";
      }
      return;
    }
    const hit = pick(e.clientX, e.clientY);
    pieces.setHovered(hit);
    canvas.style.cursor = hit ? "pointer" : "default";
  });
  canvas.addEventListener("pointerup", (e) => {
    canvas.releasePointerCapture?.(e.pointerId);
    if (dragging) {
      dragging = false;
      // carry the release velocity into a momentum glide; the camera's lerp
      // decelerates into the projected landing (reduced-motion users skip it)
      const glide = reducedMotion ? 0 : fling.release(e.timeStamp);
      if (glide !== 0 && !focused) {
        manualX = clampPan(manualX + glide);
        manualUntil = nowT + IDLE_RESUME_S;
      }
      return; // a drag, not a tap
    }
    const hit = pick(e.clientX, e.clientY);
    if (hit && hit !== focusedObject) focus(hit);
    else unfocus();
  });
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      unfocus();
    } else if (!focused && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      // Same reasoning as the pointer handlers above: panning has no effect
      // while zoomed into a piece, so don't touch manualX/manualUntil then —
      // camera.position.x is a close-up framing position, not a wall-pan one.
      const from = nowT < manualUntil ? manualX : camera.position.x;
      manualX = clampPan(from + (e.key === "ArrowLeft" ? -1 : 1) * WALL.colStep * 2);
      manualUntil = nowT + IDLE_RESUME_S;
      e.preventDefault();
    }
  });

  const frameCallbacks: Array<() => void> = [];
  const timer = new THREE.Timer();
  const limiter = createFrameLimiter();
  function frame(): void {
    requestAnimationFrame(frame);
    if (!limiter.shouldRender(performance.now())) return;
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.1);
    const t = timer.getElapsed();
    nowT = t;

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

    let ease: number;
    if (focused) {
      panTarget.copy(focused.eye);
      lookTarget.copy(focused.target);
      ease = reducedMotion ? 1 : Math.min(dt * 1.6, 1);
    } else {
      const manual = nowT < manualUntil;
      // auto target keeps the newest column right-of-center; a slow ease means a
      // mint burst fills the visible area instead of whipping past, while manual
      // panning eases quickly so a drag feels responsive
      const targetX = manual ? manualX : pieces.newestX() - VIEW_AHEAD;
      panTarget.set(targetX, REST_Y, REST_Z);
      lookTarget.set(targetX, REST_Y, WALL.z);
      ease = reducedMotion ? 1 : Math.min(dt * (manual ? 6 : 0.9), 1);
    }
    camera.position.lerp(panTarget, ease);
    tmpLook.lerp(lookTarget, ease);
    camera.lookAt(tmpLook);
    wall.follow(camera.position.x);

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
