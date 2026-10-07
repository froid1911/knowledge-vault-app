import { describe, expect, it, vi } from "vitest";
import { checkForUpdate, compareSemver } from "./update-check.js";

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}
const feed = "https://api.github.com/repos/o/r/releases/latest";
const release = (tag: string) => ({ ok: true, json: async () => ({ tag_name: tag, html_url: `https://github.com/o/r/releases/tag/${tag}` }) });

describe("compareSemver", () => {
  it("orders versions the semver way, a leading v ignored, prereleases below their release", () => {
    expect(compareSemver("0.2.0", "0.1.9")).toBe(1);
    expect(compareSemver("0.1.0-beta.2", "0.1.0")).toBe(-1);
    expect(compareSemver("1.0.0", "1.0.0")).toBe(0);
    expect(compareSemver("v0.3.0", "0.3.0")).toBe(0);
    expect(compareSemver("0.10.0", "0.9.0")).toBe(1);
  });
});
describe("checkForUpdate", () => {
  it("is off without a feed, reports a newer release, caches the answer for a day, and never throws", async () => {
    const storage = memory();
    const fetchImpl = vi.fn(async () => release("v0.2.0")) as unknown as typeof fetch;
    expect(await checkForUpdate("", "0.1.0", fetchImpl, storage, () => 0)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    const first = await checkForUpdate(feed, "0.1.0", fetchImpl, storage, () => 1_000);
    expect(first).toEqual({ latest: "0.2.0", url: "https://github.com/o/r/releases/tag/v0.2.0" });
    expect(await checkForUpdate(feed, "0.1.0", fetchImpl, storage, () => 1_000 + 23 * 3_600_000)).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await checkForUpdate(feed, "0.1.0", fetchImpl, storage, () => 1_000 + 25 * 3_600_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(await checkForUpdate(feed, "0.2.0", fetchImpl, storage, () => 1_000 + 25 * 3_600_000)).toBeNull();
    expect(JSON.parse(storage.getItem("kv.update-check")!)).toMatchObject({ latest: "0.2.0" });
    const broken = vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await checkForUpdate(feed, "0.1.0", broken, memory(), () => 0)).toBeNull();
  });
});
