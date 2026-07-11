import { expect, test } from "vitest";
import { classifyLocalNsfw, localNsfwBand } from "../src/content-filter/signals/local-nsfw.js";

test("localNsfwBand: below cleanBelow is clean", () => {
  expect(localNsfwBand(0.05, { cleanBelow: 0.1, nsfwAbove: 0.9 })).toBe("clean");
});

test("localNsfwBand: at cleanBelow boundary is uncertain (exclusive)", () => {
  expect(localNsfwBand(0.1, { cleanBelow: 0.1, nsfwAbove: 0.9 })).toBe("uncertain");
});

test("localNsfwBand: above nsfwAbove is nsfw", () => {
  expect(localNsfwBand(0.95, { cleanBelow: 0.1, nsfwAbove: 0.9 })).toBe("nsfw");
});

test("localNsfwBand: at nsfwAbove boundary is uncertain (exclusive)", () => {
  expect(localNsfwBand(0.9, { cleanBelow: 0.1, nsfwAbove: 0.9 })).toBe("uncertain");
});

test("localNsfwBand: between thresholds is uncertain", () => {
  expect(localNsfwBand(0.5, { cleanBelow: 0.1, nsfwAbove: 0.9 })).toBe("uncertain");
});

test("classifyLocalNsfw runs the injected infer function on the given bytes and bands the result", async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  let receivedBytes: Uint8Array | undefined;
  const infer = async (b: Uint8Array) => {
    receivedBytes = b;
    return 0.02;
  };

  const result = await classifyLocalNsfw(bytes, { infer, cleanBelow: 0.1, nsfwAbove: 0.9 });

  expect(receivedBytes).toBe(bytes);
  expect(result).toEqual({ score: 0.02, band: "clean" });
});

test("classifyLocalNsfw propagates a rejection from infer so the caller can fall through to Vision", async () => {
  const infer = async () => {
    throw new Error("onnx runtime crashed");
  };

  await expect(
    classifyLocalNsfw(new Uint8Array([1]), { infer, cleanBelow: 0.1, nsfwAbove: 0.9 })
  ).rejects.toThrow("onnx runtime crashed");
});
