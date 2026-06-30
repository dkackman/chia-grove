import { expect, test } from "vitest";
import pino from "pino";
import { buildServer } from "../src/web/server.js";
import { Hub } from "../src/web/hub.js";
import { RingBuffer } from "../src/web/ring-buffer.js";
import { MediaIndex } from "../src/web/media-index.js";
import type { GroveEvent } from "@grove/shared";

const silent = pino({ level: "silent" });

test("healthz responds ok", async () => {
  const app = await buildServer(
    new Hub(new RingBuffer<GroveEvent>(10), "test"),
    new MediaIndex(10),
    silent
  );
  const res = await app.inject({ method: "GET", url: "/healthz" });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({
    ok: true,
    appVersion: "dev",
    gitSha: "",
    protocolVersion: 5,
  });
  await app.close();
});
