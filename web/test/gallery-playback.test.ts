import { expect, test, vi } from "vitest";
import {
  startPlayback,
  stopPlayback,
  POSTER_TIME,
  type PlayableVideo,
} from "../src/themes/gallery/playback.js";

function fakeVideo(): PlayableVideo & {
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
} {
  return {
    muted: false,
    loop: false,
    currentTime: 0,
    play: vi.fn(() => Promise.resolve()) as unknown as (() => Promise<void>) &
      ReturnType<typeof vi.fn>,
    pause: vi.fn() as unknown as (() => void) & ReturnType<typeof vi.fn>,
  };
}

test("startPlayback keeps the video muted, loops it, and plays", () => {
  const v = fakeVideo();
  startPlayback(v);
  expect(v.muted).toBe(true);
  expect(v.loop).toBe(true);
  expect(v.play).toHaveBeenCalledTimes(1);
});

test("startPlayback returns play()'s promise so a rejected gesture can be caught", async () => {
  const v = fakeVideo();
  v.play = vi.fn(() => Promise.reject(new Error("blocked")));
  await expect(Promise.resolve(startPlayback(v))).rejects.toThrow("blocked");
});

test("stopPlayback pauses, clears loop, and resets to the poster frame", () => {
  const v = fakeVideo();
  v.loop = true;
  v.currentTime = 5;
  stopPlayback(v);
  expect(v.pause).toHaveBeenCalledTimes(1);
  expect(v.loop).toBe(false);
  expect(v.currentTime).toBe(POSTER_TIME);
});
