export type LocalNsfwBand = "clean" | "nsfw" | "uncertain";

export interface LocalNsfwThresholds {
  /** Scores strictly below this are confidently clean. */
  cleanBelow: number;
  /** Scores strictly above this are confidently nsfw. */
  nsfwAbove: number;
}

export interface LocalNsfwResult {
  score: number;
  band: LocalNsfwBand;
}

export interface LocalNsfwOpts extends LocalNsfwThresholds {
  /** Decode + preprocess + run the model, returning an nsfw probability in [0, 1].
   *  Injected so this module stays free of the onnxruntime-node / sharp
   *  dependency until the bundled model is in place. */
  infer: (imageBytes: Uint8Array) => Promise<number>;
}

/** Bands a raw nsfw score against the two confidence thresholds. Boundary values
 *  are deliberately "uncertain" (exclusive), not "clean"/"nsfw" — a score sitting
 *  exactly on a threshold hasn't cleared it. */
export function localNsfwBand(score: number, thresholds: LocalNsfwThresholds): LocalNsfwBand {
  if (score < thresholds.cleanBelow) return "clean";
  if (score > thresholds.nsfwAbove) return "nsfw";
  return "uncertain";
}

/** Runs the injected inference function and bands the resulting score. Throws
 *  (does not fail open) so callers decide the fallback — e.g. SafeSearchWorker
 *  falling through to Vision on a local-classifier failure. */
export async function classifyLocalNsfw(
  imageBytes: Uint8Array,
  opts: LocalNsfwOpts
): Promise<LocalNsfwResult> {
  const score = await opts.infer(imageBytes);
  return { score, band: localNsfwBand(score, opts) };
}
