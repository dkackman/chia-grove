import { expect, test } from "vitest";
import { querySafeSearch, adultIsSensitive } from "../src/content-filter/signals/safesearch.js";

test("adultIsSensitive only for LIKELY / VERY_LIKELY", () => {
  expect(adultIsSensitive("VERY_LIKELY")).toBe(true);
  expect(adultIsSensitive("LIKELY")).toBe(true);
  expect(adultIsSensitive("POSSIBLE")).toBe(false);
  expect(adultIsSensitive("UNLIKELY")).toBe(false);
  expect(adultIsSensitive("UNKNOWN")).toBe(false);
});

test("querySafeSearch passes the imageUri by reference and maps adult likelihood", async () => {
  let sentBody: unknown;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    expect(String(url)).toContain("images:annotate");
    expect((init.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe("test-key");
    sentBody = JSON.parse(init.body as string);
    return new Response(
      JSON.stringify({ responses: [{ safeSearchAnnotation: { adult: "VERY_LIKELY", violence: "UNLIKELY" } }] }),
      { status: 200 }
    );
  }) as typeof fetch;

  const result = await querySafeSearch("https://example.com/art.png", { apiKey: "test-key", fetchImpl });
  expect(sentBody).toEqual({
    requests: [
      {
        image: { source: { imageUri: "https://example.com/art.png" } },
        features: [{ type: "SAFE_SEARCH_DETECTION" }],
      },
    ],
  });
  expect(result.sensitive).toBe(true);
  expect(result.adult).toBe("VERY_LIKELY");
});

test("querySafeSearch maps a clean image to ok", async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ responses: [{ safeSearchAnnotation: { adult: "UNLIKELY" } }] }), {
      status: 200,
    })) as typeof fetch;
  const result = await querySafeSearch("https://e/x.png", { apiKey: "k", fetchImpl });
  expect(result.sensitive).toBe(false);
});

test("querySafeSearch throws on a non-ok HTTP status", async () => {
  const fetchImpl = (async () => new Response("nope", { status: 503 })) as typeof fetch;
  await expect(querySafeSearch("https://e/x.png", { apiKey: "k", fetchImpl })).rejects.toThrow();
});
