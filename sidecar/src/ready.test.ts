import { describe, expect, it, vi } from "vitest";
import { readyLine, restartLine, waitForHealth } from "./ready.js";

describe("readyLine", () => {
  it("is one JSON line the shell can parse", () => {
    expect(JSON.parse(readyLine(4201, 4202))).toEqual({ event: "ready", port: 4201, controlPort: 4202 });
    expect(readyLine(4201, 4202).includes("\n")).toBe(false);
  });
});

describe("waitForHealth", () => {
  it("resolves once /health answers 200", async () => {
    const codes = [503, 500, 200];
    const fetchImpl = vi.fn(async () => ({ ok: codes.shift() === 200 })) as unknown as typeof fetch;
    await waitForHealth("http://127.0.0.1:1/health", { timeoutMs: 1_000, intervalMs: 1, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
  it("rejects with the url when the deadline passes", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    await expect(
      waitForHealth("http://127.0.0.1:1/health", { timeoutMs: 20, intervalMs: 5, fetchImpl }),
    ).rejects.toThrow(/http:\/\/127\.0\.0\.1:1\/health/);
  });
});

describe("restartLine", () => {
  it("is one JSON line naming the reason, for whoever spawned the engine to respawn it", () => {
    expect(JSON.parse(restartLine("protection"))).toEqual({ event: "restart", reason: "protection" });
    expect(restartLine("protection").includes("\n")).toBe(false);
  });
});
