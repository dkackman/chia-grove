import { startPlayback, stopPlayback } from "./playback.js";

/**
 * A theme-owned DOM play/pause button for a focused video piece, parallel to
 * Placard$. Created once and shown/hidden as video pieces gain or lose focus.
 * The bound <video> is the element a THREE.VideoTexture wraps, so toggling it
 * animates the art on the wall. Playback is always muted and only ever starts
 * from a click — never autoplayed; leaving focus (hide) resets the wall to the
 * poster still. The glyph tracks the video's own play/pause/ended events so it
 * stays correct even if a loop ends or the element is paused elsewhere.
 */
export class PlayButton$ {
  private el: HTMLButtonElement;
  private video: HTMLVideoElement | null = null;
  private onState = (): void => this.syncGlyph();

  constructor() {
    this.el = document.createElement("button");
    this.el.type = "button";
    this.el.className = "gallery-play";
    this.el.hidden = true;
    this.el.addEventListener("click", () => this.toggle());
    document.body.appendChild(this.el);
  }

  /** Bind a focused piece's <video> and reveal the button in its paused state. */
  show(video: HTMLVideoElement): void {
    if (this.video === video) return;
    this.unbind();
    this.video = video;
    video.addEventListener("play", this.onState);
    video.addEventListener("pause", this.onState);
    video.addEventListener("ended", this.onState);
    this.syncGlyph();
    this.el.hidden = false;
    this.el.classList.add("visible");
  }

  /** Hide the button and reset the bound video to the poster still. */
  hide(): void {
    this.unbind();
    this.el.classList.remove("visible");
    this.el.hidden = true;
  }

  private unbind(): void {
    const v = this.video;
    if (!v) return;
    v.removeEventListener("play", this.onState);
    v.removeEventListener("pause", this.onState);
    v.removeEventListener("ended", this.onState);
    stopPlayback(v);
    this.video = null;
  }

  private toggle(): void {
    const v = this.video;
    if (!v) return;
    if (v.paused) {
      const p = startPlayback(v);
      // a rejected gesture (autoplay policy) leaves the video paused — keep ▶
      if (p && typeof p.then === "function") p.then(undefined, () => this.syncGlyph());
    } else {
      // plain pause (no reset) — only hide() snaps back to the poster frame
      v.pause();
    }
    this.syncGlyph();
  }

  private syncGlyph(): void {
    const playing = this.video ? !this.video.paused : false;
    this.el.textContent = playing ? "⏸" : "▶";
    this.el.setAttribute("aria-label", playing ? "pause video" : "play video");
  }

  dispose(): void {
    this.hide();
    this.el.remove();
  }
}
