import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["scripts/**/*.test.mjs", "sidecar/src/**/*.test.ts", "host/src/**/*.test.{ts,tsx}"],
    // Host tests that need a DOM start with `// @vitest-environment jsdom`; the Phase 0 ones are pure.
  },
});
