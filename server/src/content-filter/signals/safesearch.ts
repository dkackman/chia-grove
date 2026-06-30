export interface SafeSearchResult {
  sensitive: boolean;
  adult: string;
  raw: unknown;
}

const SENSITIVE_ADULT = new Set(["LIKELY", "VERY_LIKELY"]);

/** True when Vision's adult likelihood meets our sensitivity threshold. */
export function adultIsSensitive(likelihood: string): boolean {
  return SENSITIVE_ADULT.has(likelihood);
}

export interface QueryOpts {
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  baseUrl?: string;
}

/**
 * Ask Google Vision to SafeSearch-classify an image by URI. Google fetches the
 * URI itself — we never download the bytes. Maps adult LIKELY/VERY_LIKELY to
 * `sensitive`. Throws on transport / non-2xx / malformed responses so the caller
 * can leave the NFT permissive without poisoning the store.
 */
export async function querySafeSearch(
  imageUri: string,
  opts: QueryOpts
): Promise<SafeSearchResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const baseUrl = opts.baseUrl ?? "https://vision.googleapis.com/v1/images:annotate";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
  try {
    const res = await fetchImpl(baseUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Goog-Api-Key": opts.apiKey },
      body: JSON.stringify({
        requests: [
          { image: { source: { imageUri } }, features: [{ type: "SAFE_SEARCH_DETECTION" }] },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`vision ${res.status}`);
    const json = (await res.json()) as {
      responses?: Array<{
        safeSearchAnnotation?: { adult?: string };
        error?: { message?: string };
      }>;
    };
    const first = json.responses?.[0];
    if (first?.error) throw new Error(`vision: ${first.error.message ?? "annotation error"}`);
    const annotation = first?.safeSearchAnnotation ?? {};
    const adult = annotation.adult ?? "UNKNOWN";
    return { sensitive: adultIsSensitive(adult), adult, raw: annotation };
  } finally {
    clearTimeout(timer);
  }
}
