import { expect, test } from "vitest";
import { buildServer } from "../src/web/server.js";
import { Hub } from "../src/web/hub.js";
import { RingBuffer } from "../src/web/ring-buffer.js";
import { MediaIndex } from "../src/web/media-index.js";
import type { GroveEvent } from "@grove/shared";

test("healthz responds ok", async () => {
  const app = await buildServer(
    new Hub(new RingBuffer<GroveEvent>(10), "test"),
    new MediaIndex(10)
  );
  const res = await app.inject({ method: "GET", url: "/healthz" });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({
    ok: true,
    appVersion: "dev",
    gitSha: "",
    protocolVersion: 3,
  });
  await app.close();
});
