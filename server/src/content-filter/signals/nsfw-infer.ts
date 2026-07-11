import { InferenceSession, Tensor } from "onnxruntime-node";

const INPUT_SIZE = 224;

export type OpenNsfwInfer = (preprocessed: Float32Array) => Promise<number>;

/**
 * Loads the bundled opennsfw2 ONNX model once and returns an infer function
 * matching classifyLocalNsfw's injected `infer` shape. The model is a 2-class
 * softmax (index 0 = sfw, index 1 = nsfw) — see
 * server/models/convert_opennsfw2_to_onnx.py.
 */
export async function createOpenNsfwInfer(modelPath: string): Promise<OpenNsfwInfer> {
  const session = await InferenceSession.create(modelPath);
  return async (preprocessed: Float32Array): Promise<number> => {
    if (preprocessed.length !== INPUT_SIZE * INPUT_SIZE * 3) {
      throw new Error(
        `expected a ${INPUT_SIZE}x${INPUT_SIZE}x3 tensor, got length ${preprocessed.length}`
      );
    }
    const tensor = new Tensor("float32", preprocessed, [1, INPUT_SIZE, INPUT_SIZE, 3]);
    const results = await session.run({ input: tensor });
    const output = results.predictions.data as Float32Array;
    return output[1];
  };
}
