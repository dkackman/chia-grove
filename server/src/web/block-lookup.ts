import type { FastifyInstance } from "fastify";
import type { BlockEvent, GroveEvent } from "@grove/shared";
import type { RpcView } from "../ingest/types.js";
import type { CatRegistry } from "../classify/cats.js";
import type { MediaIndex } from "./media-index.js";
import { classifyBlock } from "../classify/classify.js";

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
  media: MediaIndex
): void {
  app.get<{ Params: { height: string } }>("/block/:height", async (request, reply) => {
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

    let info;
    try {
      info = await deps.rpc.getBlockInfo(height);
    } catch (err) {
      request.log.warn({ err, height }, "block lookup: getBlockInfo failed");
      return { events: [emptyBlockEvent(height)] };
    }
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
  });
}
