import { describe, expect, it, vi } from "vitest";
import { createVault, fetchVaults } from "./vaults.js";

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
