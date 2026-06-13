import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/ws": { target: "ws://localhost:8080", ws: true },
      "/img": { target: "http://localhost:8080" },
    },
  },
});
