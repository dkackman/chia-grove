import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import type { Hub, WireSocket } from "./hub.js";
import { registerImageProxy } from "./img-proxy.js";

export async function buildServer(hub: Hub): Promise<FastifyInstance> {
  // trust the local Caddy reverse proxy (see deploy/Caddyfile) so request.ip
  // reflects the real client via X-Forwarded-For — the image proxy rate-limits
  // per IP, which would otherwise see only the proxy's loopback address.
  const app = fastify({ logger: false, trustProxy: "127.0.0.1, ::1" });
  await app.register(websocket);

  app.get("/healthz", async () => ({ ok: true }));
  registerImageProxy(app);

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
    await app.register(fastifyStatic, { root: dist });
  }

  return app;
}
