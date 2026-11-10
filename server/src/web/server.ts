import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Logger } from "pino";
import fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import type { Hub, WireSocket } from "./hub.js";
import { registerImageProxy } from "./img-proxy.js";
import { registerBlockLookup, type BlockLookupDeps } from "./block-lookup.js";
import type { MediaIndex } from "./media-index.js";
import { readVersion } from "../version.js";
import { PROTOCOL_VERSION, type CollectionResponse } from "@grove/shared";
import type { Collection } from "./collection.js";

/** Pieces `GET /collection` returns when no (valid) `limit` is given, and its ceiling. */
const COLLECTION_DEFAULT = 18;
const COLLECTION_MAX = 48;

export async function buildServer(
  hub: Hub,
  media: MediaIndex,
  logger: Logger,
  blockLookup?: BlockLookupDeps,
  collection?: Pick<Collection, "list">
): Promise<FastifyInstance> {
  // trust the local Caddy reverse proxy (see deploy/Caddyfile) so request.ip
  // reflects the real client via X-Forwarded-For — the image proxy rate-limits
  // per IP, which would otherwise see only the proxy's loopback address.
  // pino.Logger satisfies FastifyBaseLogger structurally; cast to FastifyBaseLogger
  // avoids the type-parameter narrowing that loggerInstance would propagate into
  // FastifyInstance's generic, which would conflict with the default return type.
  const app = fastify({
    loggerInstance: logger as FastifyBaseLogger,
    trustProxy: "127.0.0.1, ::1",
  });
  await app.register(websocket, {
    options: {
      // Compress the (batched) JSON wire traffic. Negotiated at the handshake;
      // browsers support it natively, so no client change. no-context-takeover
      // bounds per-connection zlib memory; threshold skips tiny frames
      // (hello/ambient) where framing + a deflate context aren't worth it.
      perMessageDeflate: {
        threshold: 1024,
        serverNoContextTakeover: true,
        clientNoContextTakeover: true,
      },
    },
  });

  const version = readVersion();
  app.get("/healthz", async () => ({
    ok: true,
    appVersion: version.appVersion,
    gitSha: version.gitSha,
    protocolVersion: PROTOCOL_VERSION,
  }));
  // the gallery's permanent collection (see collection.ts): launcher ids only,
  // art is still fetched through /img. Without a collection the route answers
  // empty rather than 404, so the client needs no special case.
  app.get<{ Querystring: { limit?: string } }>("/collection", async (request, reply) => {
    const asked = Number(request.query.limit);
    const limit =
      Number.isInteger(asked) && asked > 0 ? Math.min(asked, COLLECTION_MAX) : COLLECTION_DEFAULT;
    reply.header("Cache-Control", "public, max-age=30");
    const body: CollectionResponse = { pieces: collection ? collection.list(limit) : [] };
    return body;
  });
  registerImageProxy(app, media);
  if (blockLookup) registerBlockLookup(app, blockLookup, media);

  app.register(async (instance) => {
    instance.get("/ws", { websocket: true }, (socket) => {
      // ws.WebSocket satisfies WireSocket structurally (send/close/terminate/
      // bufferedAmount/readyState); the double cast bridges the nominal types.
      const wire = socket as unknown as WireSocket;
      hub.add(wire);
      logger.info({ clients: hub.size }, "ws: client connected");
      socket.on("close", () => {
        hub.remove(wire);
        logger.info({ clients: hub.size }, "ws: client disconnected");
      });
      socket.on("error", () => {
        hub.remove(wire);
        logger.info({ clients: hub.size }, "ws: client error");
      });
    });
  });

  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../web/dist");
  if (existsSync(dist)) {
    await app.register(fastifyStatic, {
      root: dist,
      // Vite content-hashes JS/CSS (safe to cache), but the HTML entry must not
      // be cached or a reload could re-serve a stale document referencing old
      // bundles — which would defeat the protocol-version reload guard.
      setHeaders(res, filePath) {
        if (filePath.endsWith(".html")) {
          res.header("Cache-Control", "no-cache");
        }
      },
    });
  }

  return app;
}
