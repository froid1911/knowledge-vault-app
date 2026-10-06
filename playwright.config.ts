import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  use: { baseURL: "http://127.0.0.1:4200", headless: true },
  // Its own store: --fresh wipes .e2e-data, never the developer's .dev-data.
  webServer: { command: "node scripts/dev.mjs --no-shell --fresh --data-dir .e2e-data", url: "http://127.0.0.1:4200", timeout: 180_000, reuseExistingServer: false },
});
