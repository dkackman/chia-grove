import type { FastifyInstance } from "fastify";
import type { BlockEvent, GroveEvent } from "@grove/shared";
import type { RpcView } from "../ingest/types.js";
import type { CatRegistry } from "../classify/cats.js";
import type { MediaIndex } from "./media-index.js";
import { classifyBlock } from "../classify/classify.js";
import { RateLimiter } from "./rate-limiter.js";

// Lower than /img's per-IP ceiling: a block lookup is heavier — one RPC round
// trip plus a possible paid Vision SafeSearch call per never-before-seen NFT,
// vs. a cached media fetch. Generous enough for a human clicking prev/next/
// find-block repeatedly; tight enough to meaningfully throttle a scripted walk.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_IP = 30;

export interface BlockLookupDeps {
  rpc: RpcView;
  cats: CatRegistry;
  /** Only `enrich` is used — a real `ContentFilter` satisfies this structurally. */
  contentFilter: { enrich(events: GroveEvent[]): Promise<void> };
}

function emptyBlockEvent(height: number): BlockEvent {
  return { type: "block", height, headerHash: "", timestamp: 0, spendCount: 0, fees: "0" };
}

/**
 * GET /block/:height — fetches and classifies an arbitrary historical block on
 * demand, for the board theme's block-detail view. Reuses the exact classify +
 * content-filter pipeline live ingest uses (server/src/index.ts), so a
 * historical NFT gets the same cheap-signal + SafeSearch treatment as a live
 * one — including a real (paid) Vision check and persisted verdict if it
 * hasn't been checked before.
 *
 * Non-transaction blocks and out-of-range/unknown heights both collapse to a
 * zero-spend response rather than an error — the client renders both the same
 * way it renders any block with no grove-relevant activity.
 */
export function registerBlockLookup(
  app: FastifyInstance,
  deps: BlockLookupDeps,
  media: MediaIndex,
  limiter: RateLimiter = new RateLimiter(RATE_WINDOW_MS, RATE_MAX_PER_IP)
): void {
  // periodically drop stale buckets so the map can't grow without bound
  const sweep = setInterval(() => limiter.sweep(), RATE_WINDOW_MS);
  sweep.unref();

  app.get<{ Params: { height: string } }>("/block/:height", async (request, reply) => {
    if (limiter.limited(request.ip)) {
      reply.code(429);
      return { error: "rate limited" };
    }

    const raw = request.params.height;
    if (!/^\d+$/.test(raw)) {
      reply.code(400);
      return { error: "invalid height" };
    }
    const height = Number(raw);
    if (!Number.isSafeInteger(height)) {
      reply.code(400);
      return { error: "invalid height" };
    }

    try {
      const info = await deps.rpc.getBlockInfo(height);
      if (info.timestamp === null) {
        return { events: [emptyBlockEvent(height)] };
      }

      const spends = await deps.rpc.getSpends(info.headerHash);
      const events = classifyBlock(
        {
          height,
          headerHash: info.headerHash,
          timestamp: Number(info.timestamp),
          fees: info.fees ?? 0n,
          spends,
        },
        deps.cats,
        media
      );
      await deps.contentFilter.enrich(events);
      return { events };
    } catch (err) {
      request.log.warn({ err, height }, "block lookup: failed to fetch/classify block");
      return { events: [emptyBlockEvent(height)] };
    }
  });
}
