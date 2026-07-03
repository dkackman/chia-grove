import { defineConfig, devices } from "@playwright/test";

// End-to-end browser tests (the board's hover/thumbnail behaviour needs a real
// renderer + real image loads, which jsdom can't provide). Kept separate from
// the vitest unit suite (`web/test`, `server/test`); run with `npm run test:e2e`.
export default defineConfig({
  testDir: "./web/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "line",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev:web",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
