import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { createOpenNsfwInfer } from "../src/content-filter/signals/nsfw-infer.js";
import { preprocessOpenNsfw } from "../src/content-filter/signals/nsfw-preprocess.js";
import { readFileSync } from "node:fs";

const fixturesDir = fileURLToPath(new URL("./fixtures", import.meta.url));
const modelPath = fileURLToPath(new URL("../models/opennsfw2.onnx", import.meta.url));

test("createOpenNsfwInfer runs the bundled model and returns a probability in [0, 1]", async () => {
  const infer = await createOpenNsfwInfer(modelPath);
  const sourceBytes = readFileSync(`${fixturesDir}/nsfw-parity-source.png`);
  const tensor = await preprocessOpenNsfw(sourceBytes);

  const score = await infer(tensor);

  expect(score).toBeGreaterThanOrEqual(0);
  expect(score).toBeLessThanOrEqual(1);
});

test("createOpenNsfwInfer's score is close to the reference model's score for the fixture image", async () => {
  const infer = await createOpenNsfwInfer(modelPath);
  const sourceBytes = readFileSync(`${fixturesDir}/nsfw-parity-source.png`);
  const tensor = await preprocessOpenNsfw(sourceBytes);
  const expected = JSON.parse(readFileSync(`${fixturesDir}/nsfw-parity-score.json`, "utf8")) as {
    score: number;
  };

  const score = await infer(tensor);

  // Preprocessing drift (sharp vs PIL resize, no-JPEG-roundtrip — see
  // nsfw-preprocess.test.ts) plus TF-vs-ONNX numerical differences accumulate
  // here; this fixture image scores near zero, so an absolute tolerance is
  // meaningful (a relative one would be dominated by noise near zero).
  expect(Math.abs(score - expected.score)).toBeLessThan(0.05);
});
