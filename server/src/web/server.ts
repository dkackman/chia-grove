import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import type { Hub, WireSocket } from "./hub.js";

export async function buildServer(hub: Hub): Promise<FastifyInstance> {
  const app = fastify({ logger: false });
  await app.register(websocket);

  app.get("/healthz", async () => ({ ok: true }));

  app.register(async (instance) => {
    instance.get("/ws", { websocket: true }, (socket) => {
      const wire = socket as unknown as WireSocket;
      hub.add(wire);
      socket.on("close", () => hub.remove(wire));
      socket.on("error", () => hub.remove(wire));
    });
  });

  const dist = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../web/dist"
  );
  if (existsSync(dist)) {
    await app.register(fastifyStatic, { root: dist });
  }

  return app;
}
