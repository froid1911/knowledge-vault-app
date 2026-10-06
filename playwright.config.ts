import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  use: { baseURL: "http://127.0.0.1:4200", headless: true },
  webServer: { command: "node scripts/dev.mjs --no-shell --fresh", url: "http://127.0.0.1:4200", timeout: 180_000, reuseExistingServer: false, env: { KV_E2E: "1" } },
});
