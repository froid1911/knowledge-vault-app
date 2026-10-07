import { describe, expect, it, vi } from "vitest";
import { validateModelEndpoint } from "./models-validate.js";

const f = (status: number, body: unknown) => vi.fn(async () => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) })) as unknown as typeof fetch;

describe("validateModelEndpoint", () => {
  it("lists the provider's models with the key — the cheapest request that proves both", async () => {
    const fetchImpl = f(200, { data: [{ id: "a" }, { id: "b" }, { id: "c" }] });
    expect(await validateModelEndpoint("https://openrouter.ai/api/v1", "sk-or-x", fetchImpl)).toEqual({ ok: true, detail: "3 models available" });
    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe("https://openrouter.ai/api/v1/models");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer sk-or-x");
  });
  it("relays the provider's refusal, and names an unreachable server", async () => {
    expect(await validateModelEndpoint("https://openrouter.ai/api/v1", "bad", f(401, { error: { message: "Invalid API key" } }))).toEqual({ ok: false, detail: "The provider refused the key: Invalid API key" });
    const down = vi.fn(async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    expect(await validateModelEndpoint("http://127.0.0.1:11434/v1", "x", down)).toEqual({ ok: false, detail: "Could not reach http://127.0.0.1:11434/v1: ECONNREFUSED" });
  });
});

describe("validateModelEndpoint — a server on the local network", () => {
  it("warns that the engine must be allowed to reach it, loopback and public hosts not", async () => {
    const lan = await validateModelEndpoint("http://192.168.1.20:11434/v1", "x", f(200, { data: [{ id: "a" }] }));
    expect(lan.ok).toBe(true);
    expect(lan.warning).toMatch(/local network/);
    expect((await validateModelEndpoint("http://127.0.0.1:11434/v1", "x", f(200, { data: [] }))).warning).toBeUndefined();
    expect((await validateModelEndpoint("https://openrouter.ai/api/v1", "x", f(200, { data: [] }))).warning).toBeUndefined();
  });
});
