import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["scripts/**/*.test.mjs", "sidecar/src/**/*.test.ts", "host/src/**/*.test.{ts,tsx}"],
    // One temporary folder per run, removed at the end: tests' scratch folders never pile up in /tmp.
    globalSetup: ["scripts/test-tmpdir.mjs"],
    // Host tests that need a DOM start with `// @vitest-environment jsdom`; the Phase 0 ones are pure.
  },
});
