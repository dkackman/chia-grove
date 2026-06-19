import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import type { Hub, WireSocket } from "./hub.js";
import { registerImageProxy } from "./img-proxy.js";
import type { MediaIndex } from "./media-index.js";
import { readVersion } from "../version.js";
import { PROTOCOL_VERSION } from "@grove/shared";

export async function buildServer(hub: Hub, media: MediaIndex): Promise<FastifyInstance> {
  // trust the local Caddy reverse proxy (see deploy/Caddyfile) so request.ip
  // reflects the real client via X-Forwarded-For — the image proxy rate-limits
  // per IP, which would otherwise see only the proxy's loopback address.
  const app = fastify({ logger: false, trustProxy: "127.0.0.1, ::1" });
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
  registerImageProxy(app, media);

  app.register(async (instance) => {
    instance.get("/ws", { websocket: true }, (socket) => {
      // ws.WebSocket satisfies WireSocket structurally (send/close/terminate/
      // bufferedAmount/readyState); the double cast bridges the nominal types.
      const wire = socket as unknown as WireSocket;
      hub.add(wire);
      socket.on("close", () => hub.remove(wire));
      socket.on("error", () => hub.remove(wire));
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
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    });
  }

  return app;
}
