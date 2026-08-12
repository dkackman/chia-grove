import type { SproutEvent } from "@grove/shared";
import type { MediaKind } from "@grove/shared";
export { mediaKind, type MediaKind } from "@grove/shared";

/**
 * The next element type to try when the current one fails to load or decode, or
 * null once the chain is exhausted. `mediaKind` is only a hint (it guesses from
 * the URL extension, defaulting to "image"), so an extensionless IPFS video is
 * first guessed wrong; walking image → video → audio lets the render paths
 * self-correct on the error event instead of showing a black frame.
 */
export function escalateMediaKind(current: MediaKind): MediaKind | null {
  if (current === "image") return "video";
  if (current === "video") return "audio";
  return null;
}

function createMediaEl(src: string, kind: MediaKind): HTMLElement {
  if (kind === "video") {
    const v = document.createElement("video");
    v.src = src;
    v.controls = true;
    v.muted = true;
    v.loop = true;
    return v;
  }
  if (kind === "audio") {
    const a = document.createElement("audio");
    a.src = src;
    a.controls = true;
    return a;
  }
  const img = document.createElement("img");
  img.src = src;
  img.alt = "NFT";
  img.loading = "lazy";
  return img;
}

/** The stable "nothing to show" fallback: a note, never a removed node or a
 * broken media widget. `.media-note` is styled by both the detail card and the
 * gallery label. */
function mediaPlaceholder(): HTMLElement {
  const note = document.createElement("div");
  note.className = "media-note";
  note.textContent = "media unavailable";
  return note;
}

// `mediaKind` is only a hint (guessed from the URL extension), so when an
// element can't play its source retry the next element type (image → video →
// audio) against the same cached /img URL. Fixes extensionless videos rendering
// as a black <img>; once the chain is exhausted we show a placeholder instead of
// a removed node or a stuck broken widget.
//
// `escalated` marks an element we swapped in because an earlier guess failed —
// its kind is now a shot in the dark, so any error on it moves on, whereas the
// server's original hint gets the benefit of the network-error tolerance below.
export function nftMediaEl(src: string, kind: MediaKind, escalated = false): HTMLElement {
  const node = createMediaEl(src, kind);
  node.addEventListener("error", () => {
    // A media element reports why it failed: on the server's original kind hint,
    // a transient network/abort error doesn't mean the type is wrong, so don't
    // downgrade it (a hiccuping <video> would otherwise be replaced by <audio>).
    // But once we've escalated, the URL itself is failing (e.g. the /img proxy
    // returned 504) — tolerating the network error here would strand a broken
    // <video>/<audio> widget in the card, so we fall through to the placeholder.
    if (!escalated && node instanceof HTMLMediaElement) {
      const code = node.error?.code;
      if (code === MediaError.MEDIA_ERR_NETWORK || code === MediaError.MEDIA_ERR_ABORTED) {
        return;
      }
    }
    const next = escalateMediaKind(kind);
    node.replaceWith(next ? nftMediaEl(src, next, true) : mediaPlaceholder());
  });
  return node;
}

/**
 * Element for a `render: "blur"` disposition. Images render the real (blurred)
 * art — a blurred `<img>` with `pointer-events: none` truly has nothing to
 * interact with. Videos never get a real `<video>` here: native controls stay
 * keyboard-reachable even under `pointer-events: none` (Tab + Space opens
 * them), and the full clip would start fetching regardless of the sensitive
 * flag. Show the static poster instead — same blurred/inert treatment as an
 * image, no playable element, no full-resolution bytes touched.
 */
export function sensitiveMediaEl(event: SproutEvent, media: { src: string; kind: MediaKind }): HTMLElement {
  if (media.kind !== "video") return createMediaEl(media.src, media.kind);
  const poster = thumbnailSrc(event);
  if (!poster) return mediaPlaceholder();
  const img = document.createElement("img");
  img.src = poster;
  img.alt = "NFT";
  img.loading = "lazy";
  img.addEventListener("error", () => img.replaceWith(mediaPlaceholder()), { once: true });
  return img;
}

/**
 * Resolve the loadable src for a sprout's art, or null if it has none. Returns
 * null for blocked NFTs so no surface can fetch the bytes. Demo/offline events
 * inline a data: URI; live events are addressed by launcher id through the
 * same-origin proxy (no open URL crosses the wire; launcherId keeps /img cacheable).
 */
export function mediaSrc(event: SproutEvent): string | null {
  if (event.mediaFilter === "blocked") return null;
  if (event.dataUri) return event.dataUri; // data: (demo)
  if (event.mediaKind && event.launcherId) return `/img?nft=${event.launcherId}`;
  return null;
}

/**
 * The single source of truth for how an NFT's media should be presented. Every
 * render surface (detail card, gallery walls, mine paintings) routes through
 * this, so content filtering is uniform by construction — a new surface that
 * calls resolveMedia inherits it automatically.
 *
 * - blocked   → placeholder, never any src (bytes unreachable).
 * - sensitive → blur (DOM blurs the element; WebGL shows a placeholder texture).
 * - otherwise → art if a src resolves, else none.
 */
export type MediaDisposition =
  | { render: "art"; src: string; kind: MediaKind }
  | { render: "blur"; src: string; kind: MediaKind }
  | { render: "placeholder" }
  | { render: "none" };

/**
 * The /thumbnail?nft= URL for a video NFT's static poster image, or null when
 * not applicable. The server only populates /thumbnail for video NFTs whose
 * content hash was resolved via MintGarden; a 404 from /thumbnail means the
 * archive doesn't have a thumbnail yet (caller should fall back gracefully).
 */
export function thumbnailSrc(event: SproutEvent): string | null {
  if (event.mediaFilter === "blocked") return null;
  if (event.mediaKind !== "video") return null;
  if (event.dataUri) return null; // demo data-URI events have no server-side thumbnail
  if (event.launcherId) return `/thumbnail?nft=${event.launcherId}`;
  return null;
}

export function resolveMedia(event: SproutEvent): MediaDisposition {
  if (event.mediaFilter === "blocked") return { render: "placeholder" };
  const src = mediaSrc(event);
  if (!src) return { render: "none" };
  const kind = event.mediaKind ?? "image";
  return { render: event.mediaFilter === "sensitive" ? "blur" : "art", src, kind };
}
