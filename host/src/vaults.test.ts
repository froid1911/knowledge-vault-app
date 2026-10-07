import { describe, expect, it, vi } from "vitest";
import { createVault, exportVault, fetchBackups, fetchLogTail, fetchPipeline, fetchProtection, fetchVaults, requestBackup, requestDeleteAll, requestRestore, setProtection, setupPipeline, shutdownEngine, validateModels } from "./vaults.js";

const info = { origin: "http://127.0.0.1:4201", graphqlUrl: "http://127.0.0.1:4201/graphql", controlOrigin: "http://127.0.0.1:4202", controlToken: "secret" };

describe("vault list / create over the control API", () => {
  it("sends the token and unwraps the list", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ vaults: [{ id: "v1", slug: "s", name: "Research", noteCount: 3 }] }) })) as unknown as typeof fetch;
    const vaults = await fetchVaults(info, fetchImpl);
    expect(vaults).toEqual([{ id: "v1", slug: "s", name: "Research", noteCount: 3 }]);
    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:4202/vaults");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer secret");
  });
  it("reports the engine's error message when creation fails", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: "Forbidden" }) })) as unknown as typeof fetch;
    await expect(createVault(info, "X", fetchImpl)).rejects.toThrow("Forbidden");
  });
});

describe("local protection over the control API", () => {
  it("reads the switch and asks for a change with a boolean body", async () => {
    const fetchImpl = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => ({
      ok: true,
      status: init?.method === "PUT" ? 202 : 200,
      json: async () => (init?.method === "PUT" ? { restarting: true, protected: true, adminAddress: "0xabc" } : { protected: false, adminAddress: null }),
    })) as unknown as typeof fetch;
    expect(await fetchProtection(info, fetchImpl)).toEqual({ protected: false, adminAddress: null });
    expect(await setProtection(info, true, fetchImpl)).toEqual({ restarting: true, protected: true, adminAddress: "0xabc" });
    const calls = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    expect(calls[0]![0]).toBe("http://127.0.0.1:4202/local/protection");
    expect(calls[1]![1].method).toBe("PUT");
    expect(JSON.parse(String(calls[1]![1].body))).toEqual({ protected: true });
  });
});

describe("pipeline + model validation over the control API", () => {
  it("reads and sets up a vault's pipeline, and validates the model settings", async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/settings/models/validate")) return { ok: true, status: 200, json: async () => ({ ok: true, detail: "12 models available" }) };
      return { ok: true, status: init?.method === "POST" ? 200 : 200, json: async () => ({ pipeline: init?.method === "POST" ? { state: "ready", workflowId: "wf", connectionId: "c" } : { state: "missing" } }) };
    }) as unknown as typeof fetch;
    expect(await fetchPipeline(info, "v1", fetchImpl)).toEqual({ state: "missing" });
    expect(await setupPipeline(info, "v1", fetchImpl)).toEqual({ state: "ready", workflowId: "wf", connectionId: "c" });
    expect(await validateModels(info, fetchImpl)).toEqual({ ok: true, detail: "12 models available" });
    const calls = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    expect(calls[0]![0]).toBe("http://127.0.0.1:4202/vaults/v1/pipeline");
    expect(calls[1]![1].method).toBe("POST");
    expect(calls[2]![0]).toBe("http://127.0.0.1:4202/settings/models/validate");
  });
});

describe("maintenance over the control API (Plan 5)", () => {
  it("lists backups, schedules a backup, a restore and a delete-all, exports a vault, reads the log tail and asks for a shutdown", async () => {
    const seen: { url: string; method: string; body: unknown }[] = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      seen.push({ url: u, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (u.endsWith("/backups") && init?.method !== "POST") return { ok: true, status: 200, json: async () => ({ backups: [{ name: "b1", path: "/p/b1", bytes: 10, stackVersion: "6.2.3-dev.44", createdAt: "2026-10-07T12:00:00.000Z" }], lastAction: null }) };
      if (u.includes("/export")) return { ok: true, status: 200, json: async () => ({ export: { path: "/p/exports/a-x", documents: 3, bytes: 99 } }) };
      if (u.endsWith("/logs/tail")) return { ok: true, status: 200, json: async () => ({ lines: ["one", "two"] }) };
      if (u.endsWith("/shutdown")) return { ok: true, status: 202, json: async () => ({ stopping: true }) };
      return { ok: true, status: 202, json: async () => ({ restarting: true }) };
    }) as unknown as typeof fetch;
    expect(await fetchBackups(info, fetchImpl)).toEqual({ backups: [{ name: "b1", path: "/p/b1", bytes: 10, stackVersion: "6.2.3-dev.44", createdAt: "2026-10-07T12:00:00.000Z" }], lastAction: null });
    expect(await requestBackup(info, fetchImpl)).toEqual({ restarting: true });
    expect(await requestRestore(info, "b 1", fetchImpl)).toEqual({ restarting: true });
    expect(await requestDeleteAll(info, true, fetchImpl)).toEqual({ restarting: true });
    expect(await exportVault(info, "v1", fetchImpl)).toEqual({ path: "/p/exports/a-x", documents: 3, bytes: 99 });
    expect(await fetchLogTail(info, fetchImpl)).toEqual(["one", "two"]);
    expect(await shutdownEngine(info, fetchImpl)).toEqual({ stopping: true });
    expect(seen.map((s) => `${s.method} ${s.url.replace("http://127.0.0.1:4202", "")}`)).toEqual([
      "GET /backups", "POST /backups", "POST /backups/b%201/restore", "POST /data/delete-all", "GET /vaults/v1/export", "GET /logs/tail", "POST /shutdown",
    ]);
    expect(seen[3]!.body).toEqual({ confirm: "delete", includeBackups: true });
  });
});
