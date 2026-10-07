// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEngineHealth } from "./use-engine-health.js";

const info = { origin: "http://127.0.0.1:4201", graphqlUrl: "http://127.0.0.1:4201/graphql", controlOrigin: "http://127.0.0.1:4202", controlToken: "t" };
afterEach(() => vi.useRealTimers());

describe("useEngineHealth", () => {
  it("degrades after two consecutive failed status reads and recovers on one success", async () => {
    vi.useFakeTimers();
    let fail = true;
    const fetchStatus = vi.fn(async () => {
      if (fail) throw new Error("ECONNREFUSED");
      return { ok: true } as never;
    });
    const { result } = renderHook(() => useEngineHealth(info, 1000, { fetchStatus }));
    expect(result.current).toBe("ok");
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(result.current).toBe("ok");
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(result.current).toBe("degraded");
    fail = false;
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(result.current).toBe("ok");
    expect(fetchStatus).toHaveBeenCalledTimes(3);
  });
  it("does nothing without an engine", async () => {
    vi.useFakeTimers();
    const fetchStatus = vi.fn(async () => ({ ok: true }) as never);
    const { result } = renderHook(() => useEngineHealth(undefined, 1000, { fetchStatus }));
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(result.current).toBe("ok");
    expect(fetchStatus).not.toHaveBeenCalled();
  });
  it("counts a status read that never answers as a failure", async () => {
    vi.useFakeTimers();
    const fetchStatus = vi.fn(() => new Promise<never>(() => {}));
    const { result } = renderHook(() => useEngineHealth(info, 1000, { fetchStatus }));
    await act(async () => { await vi.advanceTimersByTimeAsync(3500); });
    expect(result.current).toBe("degraded");
  });
});
