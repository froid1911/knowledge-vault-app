import { describe, expect, it, vi } from "vitest";
import { createTokenProvider } from "./identity.js";

const info = { origin: "http://127.0.0.1:4201", graphqlUrl: "http://127.0.0.1:4201/graphql", controlOrigin: "http://127.0.0.1:4202", controlToken: "t" };

describe("createTokenProvider", () => {
  it("mints once and reuses the token until a minute before it expires", async () => {
    let clock = Date.parse("2026-10-06T12:00:00Z");
    const f = vi.fn(async () => new Response(JSON.stringify({ token: "jwt-1", expiresAt: "2026-10-06T13:00:00.000Z", address: "0xabc", did: "did:key:z" })));
    const provider = createTokenProvider(info, f as unknown as typeof fetch, () => clock);
    expect(await provider()).toBe("jwt-1");
    expect(await provider()).toBe("jwt-1");
    expect(f).toHaveBeenCalledTimes(1);
    clock = Date.parse("2026-10-06T12:59:30Z"); // inside the renewal window
    await provider();
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("yields no token (and keeps asking) while nobody is signed in", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: "Not signed in." }), { status: 401 }));
    const provider = createTokenProvider(info, f as unknown as typeof fetch);
    expect(await provider()).toBeUndefined();
    expect(await provider()).toBeUndefined();
    expect(f).toHaveBeenCalledTimes(2);
  });
});
