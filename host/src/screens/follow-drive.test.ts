import { describe, expect, it, vi } from "vitest";
import { followDrive, type DriveCache } from "./follow-drive.js";

type Doc = { header: { id: string; meta?: Record<string, unknown> }; state: { global: { nodes: { id: string }[] } } };
const drive = (nodes: string[], meta?: Record<string, unknown>): Doc => ({ header: { id: "d1", ...(meta ? { meta } : {}) }, state: { global: { nodes: nodes.map((id) => ({ id })) } } });

function fakeCache(initial: Doc) {
  let current = initial;
  const subs = new Set<() => void>();
  const cache: DriveCache = {
    get: vi.fn(async () => current as never),
    subscribe: (_id, cb) => {
      subs.add(cb);
      return () => void subs.delete(cb);
    },
  };
  return { cache, change: (next: Doc) => ((current = next), subs.forEach((s) => s())), subs };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("followDrive (keeps the drives slot in step with the drive, as Connect's reactor does)", () => {
  it("publishes the drive now and again after every change", async () => {
    const { cache, change } = fakeCache(drive(["a", "b"]));
    const published: string[][] = [];
    const stop = followDrive(cache, "d1", "workflow-studio", (d) => published.push((d as unknown as Doc).state.global.nodes.map((n) => n.id)));
    await flush();
    change(drive(["a"]));
    await flush();
    expect(published).toEqual([["a", "b"], ["a"]]);
    stop();
  });

  it("does not republish a drive that has not changed (a new object every time would make the apps re-read it, endlessly)", async () => {
    const { cache, change } = fakeCache(drive(["a", "b"]));
    const publish = vi.fn();
    followDrive(cache, "d1", "workflow-studio", publish);
    await flush();
    for (let i = 0; i < 5; i++) {
      change(drive(["a", "b"])); // the cache refetched; nothing changed
      await flush();
    }
    expect(publish).toHaveBeenCalledTimes(1);
    change(drive(["a"]));
    await flush();
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("does not republish an unchanged drive when the cache is swapped (an app installing its own cache)", async () => {
    const memo = {};
    const publish = vi.fn();
    const stopFirst = followDrive(fakeCache(drive(["a"])).cache, "d1", "knowledge-vault", publish, undefined, memo);
    await flush();
    stopFirst();
    followDrive(fakeCache(drive(["a"])).cache, "d1", "knowledge-vault", publish, undefined, memo);
    await flush();
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("names the screen's app when the drive does not, and keeps the drive's own choice", async () => {
    const seen: unknown[] = [];
    followDrive(fakeCache(drive([])).cache, "d1", "workflow-studio", (d) => seen.push(d.header.meta?.preferredEditor));
    followDrive(fakeCache(drive([], { preferredEditor: "knowledge-vault" })).cache, "d1", "workflow-studio", (d) => seen.push(d.header.meta?.preferredEditor));
    await flush();
    expect(seen).toEqual(["workflow-studio", "knowledge-vault"]);
  });

  it("stops publishing once stopped, and reports a failed first read", async () => {
    const { cache, change, subs } = fakeCache(drive(["a"]));
    const publish = vi.fn();
    const stop = followDrive(cache, "d1", "workflow-studio", publish);
    await flush();
    stop();
    change(drive([]));
    await flush();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(subs.size).toBe(0);
    const onError = vi.fn();
    followDrive({ get: async () => Promise.reject(new Error("gone")), subscribe: () => () => {} }, "d1", "workflow-studio", publish, onError);
    await flush();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "gone" }));
  });
});
