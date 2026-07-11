import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { preprocessOpenNsfw } from "../src/content-filter/signals/nsfw-preprocess.js";

const fixturesDir = fileURLToPath(new URL("./fixtures", import.meta.url));

test("preprocessOpenNsfw matches the opennsfw2 reference tensor for a fixed source image", async () => {
  const sourceBytes = readFileSync(`${fixturesDir}/nsfw-parity-source.png`);
  const expected = JSON.parse(
    readFileSync(`${fixturesDir}/nsfw-parity-tensor-no-jpeg.json`, "utf8")
  ) as number[][][];

  const actual = await preprocessOpenNsfw(sourceBytes);

  expect(actual.length).toBe(224 * 224 * 3);

  let sumAbsDiff = 0;
  let maxAbsDiff = 0;
  let i = 0;
  for (let h = 0; h < 224; h++) {
    for (let w = 0; w < 224; w++) {
      for (let c = 0; c < 3; c++) {
        const diff = Math.abs(actual[i] - expected[h][w][c]);
        sumAbsDiff += diff;
        maxAbsDiff = Math.max(maxAbsDiff, diff);
        i++;
      }
    }
  }
  const meanAbsDiff = sumAbsDiff / (224 * 224 * 3);

  // Node (sharp) and Python (PIL) use different bilinear-resize implementations,
  // so pixel-exact parity isn't achievable — observed drift on this fixture is
  // mean ~1.4, max ~4 (out of a 0-255 range), well below anything that could
  // flip a classification band (see local-nsfw.ts thresholds).
  expect(meanAbsDiff).toBeLessThan(3);
  expect(maxAbsDiff).toBeLessThan(15);
});
