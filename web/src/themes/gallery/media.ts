import * as THREE from "three";
import { escalateMediaKind, type MediaKind } from "../../ui/media.js";
import { POSTER_TIME } from "./playback.js";

/**
 * Load an NFT's media as a Three.js texture, mirroring the media-type handling
 * of the detail-card popup: still images become a TextureLoader texture, videos
 * become either a static thumbnail texture (preferred, from the archive CDN) or
 * a VideoTexture frozen on a poster frame — never autoplayed, and only the
 * metadata plus that single frame are fetched (preload="metadata" + a seek), so a
 * potentially-explicit clip is never streamed in full to an ambient surface.
 * Ambient media surfaces (gallery walls, mine paintings) must not animate video
 * without a user gesture; this blunts explicit clips that slip past content
 * filtering, and playback is only offered after interaction in the detail popup.
 * Audio has no still frame to hang, so it is treated as a failure (the piece is
 * skipped — no blank frame). Cross-origin failures (no CORS headers, 404, decode
 * error) call onFail so the slot is freed.
 *
 * When posterSrc is supplied for a video, the thumbnail is loaded as a static
 * image and the video element is passed to onReady (second argument) so the
 * gallery can wire up the play button for on-demand playback. If the thumbnail
 * fetch fails the function falls back to the video-seek approach.
 *
 * The caller is responsible for resolving src (via mediaSrc) and kind (via
 * event.mediaKind) before calling — this function no longer proxies URLs itself.
 */
export function loadArtTexture(
  src: string,
  kind: MediaKind,
  onReady: (texture: THREE.Texture, video?: HTMLVideoElement) => void,
  onFail: () => void = () => {},
  posterSrc?: string
): void {
  if (kind === "audio") {
    onFail();
    return;
  }

  if (kind === "video") {
    if (posterSrc) {
      // Create the video element now but hold off loading until the user plays.
      // preload="none" means no bytes are fetched until video.play() is called.
      const video = document.createElement("video");
      video.crossOrigin = "anonymous";
      video.muted = true;
      video.playsInline = true;
      video.preload = "none";
      video.src = src;

      const loader = new THREE.TextureLoader();
      loader.crossOrigin = "anonymous";
      loader.load(
        posterSrc,
        (texture) => onReady(texture, video),
        undefined,
        () => {
          // Thumbnail not available (archive hasn't indexed this NFT yet);
          // clean up and fall back to the video-seek approach.
          video.removeAttribute("src");
          video.load();
          loadVideoSeekTexture(src, onReady, onFail);
        }
      );
      return;
    }
    loadVideoSeekTexture(src, onReady, onFail);
    return;
  }

  const loader = new THREE.TextureLoader();
  loader.crossOrigin = "anonymous";
  loader.load(
    src,
    (texture) => onReady(texture),
    undefined,
    () => {
      // the "image" hint may be wrong (e.g. an extensionless video) — retry as
      // the next element type against the same cached /img URL before giving up
      const next = escalateMediaKind(kind);
      if (next) loadArtTexture(src, next, onReady, onFail, posterSrc);
      else onFail();
    }
  );
}

/**
 * Fetch dimensions/duration via preload="metadata", seek to a small offset to
 * force the browser to decode one frame, then freeze the VideoTexture there.
 * Video is never played — the VideoTexture stays on the poster frame.
 */
function loadVideoSeekTexture(
  src: string,
  onReady: (texture: THREE.Texture, video?: HTMLVideoElement) => void,
  onFail: () => void
): void {
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.playsInline = true;
  // metadata-only: fetch dimensions/duration, then seek to decode one poster
  // frame — never stream the whole clip to an ambient surface.
  video.preload = "metadata";

  const onMeta = (): void => {
    // Seek a hair into the clip to force the first frame to decode without
    // playing it. A seek to 0 may be treated as a no-op (no "seeked" event)
    // when currentTime is already 0, so nudge to a small offset, clamped for
    // very short clips and guarded against a NaN/Infinity duration.
    const d = video.duration;
    const target = Number.isFinite(d) && d > 0 ? Math.min(POSTER_TIME, d / 2) : POSTER_TIME;
    try {
      video.currentTime = target;
    } catch {
      onErr();
    }
  };
  const onSeeked = (): void => {
    detach();
    // Deliberately do NOT call video.play(): the VideoTexture stays frozen on
    // the seeked poster frame, so ambient surfaces show a still instead of
    // autoplaying. The video element is paused and never loops.
    onReady(new THREE.VideoTexture(video));
  };
  const onErr = (): void => {
    detach();
    video.removeAttribute("src");
    video.load(); // release the partially-loaded resource
    onFail();
  };
  const detach = (): void => {
    video.removeEventListener("loadedmetadata", onMeta);
    video.removeEventListener("seeked", onSeeked);
    video.removeEventListener("error", onErr);
  };

  video.addEventListener("loadedmetadata", onMeta);
  video.addEventListener("seeked", onSeeked);
  video.addEventListener("error", onErr);
  video.src = src;
}
