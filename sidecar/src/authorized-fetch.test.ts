import { describe, expect, it, vi } from "vitest";
import { authorizedFetch, createEngineTokenProvider } from "./authorized-fetch.js";

describe("authorizedFetch", () => {
  it("adds the bearer the provider hands out, and nothing when it has none", async () => {
    const f = vi.fn(async (_u: RequestInfo | URL, _i?: RequestInit) => ({ ok: true })) as unknown as typeof fetch;
    await authorizedFetch(async () => "jwt", f)("http://127.0.0.1:4201/graphql", { method: "POST", headers: { "content-type": "application/json" } });
    const [, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer jwt");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    await authorizedFetch(async () => undefined, f)("http://127.0.0.1:4201/graphql", { method: "POST" });
    const [, init2] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[1]!;
    expect(new Headers(init2.headers).has("authorization")).toBe(false);
  });
});

describe("createEngineTokenProvider", () => {
  it("mints once and reuses the token until a minute before it expires", async () => {
    let now = Date.parse("2026-10-07T10:00:00Z");
    const token = vi.fn(async () => ({ token: `jwt-${token.mock.calls.length}`, expiresAt: new Date(now + 3_600_000).toISOString(), address: "0xabc", did: "did:key:z" }));
    const provider = createEngineTokenProvider({ token }, () => now);
    expect(await provider()).toBe("jwt-1");
    expect(await provider()).toBe("jwt-1");
    now += 3_600_000 - 30_000; // inside the renewal window
    expect(await provider()).toBe("jwt-2");
    expect(token).toHaveBeenCalledTimes(2);
  });
  it("hands out nothing when the engine is not signed in", async () => {
    const provider = createEngineTokenProvider({ token: async () => { throw new Error("Not authenticated"); } });
    expect(await provider()).toBeUndefined();
  });
});
