import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/ws": { target: "ws://localhost:8080", ws: true },
      "/img": { target: "http://localhost:8080" },
      "/thumbnail": { target: "http://localhost:8080" },
      "/block": { target: "http://localhost:8080" },
    },
  },
});
