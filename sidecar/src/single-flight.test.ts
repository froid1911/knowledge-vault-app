import { describe, expect, it, vi } from "vitest";
import { singleFlight } from "./single-flight.js";

describe("singleFlight", () => {
  it("lets concurrent callers share one call, then allows a fresh one", async () => {
    let resolve!: (v: string) => void;
    const fn = vi.fn(() => new Promise<string>((r) => { resolve = r; }));
    const once = singleFlight(fn);
    const a = once();
    const b = once(); // React StrictMode: the same effect twice
    expect(fn).toHaveBeenCalledTimes(1);
    resolve("drive-1");
    expect(await Promise.all([a, b])).toEqual(["drive-1", "drive-1"]);
    void once();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
