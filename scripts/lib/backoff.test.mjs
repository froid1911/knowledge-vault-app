import { describe, expect, it } from "vitest";
import { crashWindow, restartDelayMs } from "./backoff.mjs";
describe("backoff (mirrors src-tauri/src/backoff.rs)", () => {
  it("delays 1 s, 4 s, 16 s, then gives up", () => {
    expect([1, 2, 3, 4].map(restartDelayMs)).toEqual([1000, 4000, 16000, null]);
  });
  it("counts crashes within two minutes and starts over after a quiet spell", () => {
    const w = crashWindow();
    expect([0, 10_000, 50_000, 100_000].map((t) => w.record(t))).toEqual([1, 2, 3, 4]);
    expect(w.record(300_000)).toBe(1);
    w.reset();
    expect(w.record(300_001)).toBe(1);
  });
});
