import { classifyLocalNsfw, type LocalNsfwResult, type LocalNsfwThresholds } from "./local-nsfw.js";
import { createOpenNsfwInfer, type OpenNsfwInfer } from "./nsfw-infer.js";
import { preprocessOpenNsfw } from "./nsfw-preprocess.js";

export interface LocalNsfwRuntimeOpts extends LocalNsfwThresholds {
  modelPath: string;
  /** Injectable for testing; defaults to the real sharp-based preprocessor. */
  preprocess?: (imageBytes: Uint8Array) => Promise<Float32Array>;
  /** Injectable for testing; defaults to loading the real ONNX model. */
  createInfer?: (modelPath: string) => Promise<OpenNsfwInfer>;
}

/**
 * Builds a `(bytes) => Promise<LocalNsfwResult>` classifier matching the shape
 * SafeSearchWorker's `localClassify` option expects. The ONNX session is
 * expensive to create (model load) but stateless once created, so it's built
 * lazily on first use and the in-flight creation promise (not just the
 * resolved session) is cached — this keeps concurrent first calls from each
 * loading their own copy of the model.
 */
export function createLocalNsfwClassifier(
  opts: LocalNsfwRuntimeOpts
): (imageBytes: Uint8Array) => Promise<LocalNsfwResult> {
  const preprocess = opts.preprocess ?? preprocessOpenNsfw;
  const createInfer = opts.createInfer ?? createOpenNsfwInfer;
  let inferPromise: Promise<OpenNsfwInfer> | undefined;

  const infer = async (imageBytes: Uint8Array): Promise<number> => {
    if (!inferPromise) inferPromise = createInfer(opts.modelPath);
    const [runInfer, tensor] = await Promise.all([inferPromise, preprocess(imageBytes)]);
    return runInfer(tensor);
  };

  return (imageBytes: Uint8Array) =>
    classifyLocalNsfw(imageBytes, {
      infer,
      cleanBelow: opts.cleanBelow,
      nsfwAbove: opts.nsfwAbove,
    });
}
