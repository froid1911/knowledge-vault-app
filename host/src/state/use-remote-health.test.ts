// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRemoteHealth } from "./use-remote-health.js";

afterEach(() => vi.useRealTimers());
describe("useRemoteHealth", () => {
  it("is offline after two failed probes and online again after one answer — any HTTP answer counts as reachable", async () => {
    vi.useFakeTimers();
    let down = true;
    const fetchImpl = vi.fn(async () => {
      if (down) throw new TypeError("Failed to fetch");
      return new Response("{}", { status: 401 }); // a protected server refusing an anonymous probe is still there
    }) as unknown as typeof fetch;
    const { result } = renderHook(() => useRemoteHealth("https://s.example.com", 15_000, fetchImpl));
    expect(result.current).toBe("online");
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(result.current).toBe("online");
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(result.current).toBe("offline");
    down = false;
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(result.current).toBe("online");
    expect(String((fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0])).toBe("https://s.example.com/graphql");
  });
});
