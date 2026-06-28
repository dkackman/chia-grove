/**
 * DOM-free playback control for a gallery video piece, kept separate from the
 * play button so the muted/loop/reset semantics are unit-testable with a fake
 * video (mirrors material.ts being split from cats.ts). The video element these
 * helpers receive is the same one a THREE.VideoTexture wraps, so starting it
 * animates the wall and resetting it returns the wall to the still poster frame.
 */

/** The slice of HTMLVideoElement these helpers touch — lets tests pass a fake. */
export interface PlayableVideo {
  muted: boolean;
  loop: boolean;
  currentTime: number;
  play(): Promise<void> | void;
  pause(): void;
}

// The small offset the poster frame is seeked to in media.ts; shared so a reset
// returns to exactly that frame. A seek to 0 can be treated as a no-op, hence
// the nudge a hair into the clip.
export const POSTER_TIME = 0.1;

/**
 * Begin user-initiated playback: stay muted (sound is never enabled), loop, and
 * play. Returns play()'s result so the caller can revert its UI if the browser
 * rejects the gesture.
 */
export function startPlayback(video: PlayableVideo): Promise<void> | void {
  video.muted = true;
  video.loop = true;
  return video.play();
}

/**
 * Stop and reset to the poster frame: pause, clear loop, and seek back to the
 * poster offset so the wall shows the still again (three's VideoTexture
 * re-uploads the seeked frame via requestVideoFrameCallback).
 */
export function stopPlayback(video: PlayableVideo): void {
  video.pause();
  video.loop = false;
  video.currentTime = POSTER_TIME;
}
