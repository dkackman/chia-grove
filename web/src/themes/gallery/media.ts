import * as THREE from "three";
import { mediaKind } from "../../ui/media.js";

/**
 * Load an NFT's media as a Three.js texture, mirroring the media-type handling
 * of the detail-card popup: still images become a TextureLoader texture, videos
 * become a looping muted VideoTexture. Audio has no still frame to hang, so it
 * is treated as a failure (the piece is skipped — no blank frame). Cross-origin
 * failures (no CORS headers, 404, decode error) call onFail so the slot is freed.
 */
export function loadArtTexture(
  url: string,
  onReady: (texture: THREE.Texture) => void,
  onFail: () => void = () => {}
): void {
  const kind = mediaKind(url);

  if (kind === "audio") {
    onFail();
    return;
  }

  if (kind === "video") {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true; // muted is required for autoplay without a user gesture
    video.loop = true;
    video.playsInline = true;
    video.preload = "auto";

    const onData = (): void => {
      detach();
      void video.play().catch(() => {});
      onReady(new THREE.VideoTexture(video));
    };
    const onErr = (): void => {
      detach();
      video.removeAttribute("src");
      video.load(); // release the partially-loaded resource
      onFail();
    };
    const detach = (): void => {
      video.removeEventListener("loadeddata", onData);
      video.removeEventListener("error", onErr);
    };

    video.addEventListener("loadeddata", onData);
    video.addEventListener("error", onErr);
    video.src = url;
    return;
  }

  const loader = new THREE.TextureLoader();
  loader.crossOrigin = "anonymous";
  loader.load(url, (texture) => onReady(texture), undefined, () => onFail());
}
