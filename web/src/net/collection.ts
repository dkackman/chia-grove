import type { CollectionResponse, SproutEvent } from "@grove/shared";

/**
 * The gallery's permanent collection from `GET /collection`: recent clean image
 * NFTs, newest first (see server/src/web/collection.ts). Never rejects — a
 * slow, failed or malformed response is just an empty collection, so the wall
 * falls back to live pieces only.
 *
 * The server already withholds anything marked sensitive or blocked; entries
 * carrying a `mediaFilter` are dropped here as well, so a filtered piece can
 * never be hung as part of the collection whatever the response says.
 */
export async function fetchCollection(limit: number, timeoutMs = 1500): Promise<SproutEvent[]> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetch(`/collection?limit=${limit}`, { signal: abort.signal });
    if (!res.ok) return [];
    return collectionPieces((await res.json()) as unknown, limit);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Validate a `/collection` body down to the hangable, unfiltered image pieces. */
export function collectionPieces(body: unknown, limit: number): SproutEvent[] {
  const pieces = (body as Partial<CollectionResponse> | null)?.pieces;
  if (!Array.isArray(pieces)) return [];
  const seen = new Set<string>();
  const out: SproutEvent[] = [];
  for (const piece of pieces as Array<Partial<SproutEvent> | null>) {
    if (out.length >= limit) break;
    if (!piece || piece.type !== "sprout" || piece.kind !== "nft") continue;
    if (typeof piece.launcherId !== "string" || !/^[0-9a-f]{64}$/.test(piece.launcherId)) continue;
    if (piece.mediaKind !== "image" || piece.mediaFilter) continue;
    if (typeof piece.height !== "number" || typeof piece.coinId !== "string") continue;
    if (seen.has(piece.launcherId)) continue;
    seen.add(piece.launcherId);
    out.push(piece as SproutEvent);
  }
  return out;
}
