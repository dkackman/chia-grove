import { expect, test } from "vitest";
import { createLocalNsfwClassifier } from "../src/content-filter/signals/local-nsfw-runtime.js";

test("createLocalNsfwClassifier lazily creates the infer session once and reuses it across calls", async () => {
  let createInferCalls = 0;
  const classify = createLocalNsfwClassifier({
    modelPath: "unused-in-test.onnx",
    cleanBelow: 0.1,
    nsfwAbove: 0.9,
    preprocess: async () => new Float32Array([1, 2, 3]),
    createInfer: async () => {
      createInferCalls++;
      return async () => 0.5;
    },
  });

  expect(createInferCalls).toBe(0); // not created until first classify() call

  const r1 = await classify(new Uint8Array([9]));
  const r2 = await classify(new Uint8Array([9]));

  expect(createInferCalls).toBe(1);
  expect(r1).toEqual({ score: 0.5, band: "uncertain" });
  expect(r2).toEqual({ score: 0.5, band: "uncertain" });
});

test("concurrent first calls still only create the infer session once (no init race)", async () => {
  let createInferCalls = 0;
  const classify = createLocalNsfwClassifier({
    modelPath: "unused-in-test.onnx",
    cleanBelow: 0.1,
    nsfwAbove: 0.9,
    preprocess: async () => new Float32Array([1]),
    createInfer: async () => {
      createInferCalls++;
      await new Promise((r) => setTimeout(r, 5));
      return async () => 0.02;
    },
  });

  const [r1, r2] = await Promise.all([
    classify(new Uint8Array([1])),
    classify(new Uint8Array([2])),
  ]);

  expect(createInferCalls).toBe(1);
  expect(r1.band).toBe("clean");
  expect(r2.band).toBe("clean");
});

test("passes the preprocessed tensor (not the raw bytes) to infer", async () => {
  const tensor = new Float32Array([7, 8, 9]);
  let receivedTensor: Float32Array | undefined;
  const classify = createLocalNsfwClassifier({
    modelPath: "unused-in-test.onnx",
    cleanBelow: 0.1,
    nsfwAbove: 0.9,
    preprocess: async () => tensor,
    createInfer: async () => async (t: Float32Array) => {
      receivedTensor = t;
      return 0.95;
    },
  });

  const result = await classify(new Uint8Array([1, 2]));

  expect(receivedTensor).toBe(tensor);
  expect(result.band).toBe("nsfw");
});
