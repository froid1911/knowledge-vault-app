import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createIdentity, type IdentityDeps, type LoginOptions } from "./identity.js";

/** A fake SDK: `complete()` ends the pending browser flow as a success; the signal aborts it. */
function fakeSdk(initial = { authenticated: false }) {
  const state = { authenticated: initial.authenticated, address: undefined as string | undefined, logins: 0 };
  let finish: ((v: unknown) => void) | undefined;
  const deps: IdentityDeps = {
    build: async () => ({ logout: async () => { state.authenticated = false; state.address = undefined; } }),
    getAuthStatus: () => ({ authenticated: state.authenticated, address: state.address, userDid: state.address ? `did:pkh:eip155:1:${state.address}` : undefined, cliDid: "did:key:z6Mk-app", authenticatedAt: state.authenticated ? new Date("2026-10-06T10:00:00Z") : undefined, baseUrl: "https://www.renown.id" }),
    browserLogin: vi.fn((_r, options: LoginOptions) => {
      state.logins++;
      options.onLoginUrl?.("https://www.renown.id/#/login?session=abc", "abc");
      return new Promise((resolve, reject) => {
        finish = resolve;
        options.signal?.addEventListener("abort", () => reject(new Error("Login cancelled")));
      });
    }),
    generateAccessToken: async (_r, options) => {
      if (!state.authenticated) throw new Error("Not authenticated");
      return { token: "jwt-123", did: "did:key:z6Mk-app", address: state.address!, expiresIn: options?.expiresIn ?? 3600 };
    },
  };
  return { deps, complete: () => { state.authenticated = true; state.address = "0xabc"; finish?.({ user: { address: "0xabc", did: "did:pkh:eip155:1:0xabc" }, cliDid: "did:key:z6Mk-app" }); }, state };
}
const secretsDir = () => mkdtempSync(join(tmpdir(), "kv-identity-"));

describe("identity", () => {
  it("signs in through the browser flow: pending with the URL, then authenticated; tokens only once signed in", async () => {
    const sdk = fakeSdk();
    const id = createIdentity(sdk.deps, { renownUrl: "https://www.renown.id", secretsDir: secretsDir() });
    expect((await id.status()).authenticated).toBe(false);
    await expect(id.token()).rejects.toThrow(/Not authenticated/);
    const started = await id.startLogin();
    expect(started).toEqual({ url: "https://www.renown.id/#/login?session=abc", alreadyAuthenticated: false });
    expect((await id.status()).pending?.url).toBe("https://www.renown.id/#/login?session=abc");
    // a second click while pending re-uses the flow instead of opening a second browser tab
    await id.startLogin();
    expect(sdk.state.logins).toBe(1);
    sdk.complete();
    await new Promise((r) => setTimeout(r, 0));
    const after = await id.status();
    expect(after).toMatchObject({ authenticated: true, address: "0xabc", did: "did:pkh:eip155:1:0xabc", pending: null });
    const token = await id.token(600);
    expect(token).toMatchObject({ token: "jwt-123", address: "0xabc" });
    expect(new Date(token.expiresAt).getTime() - Date.now()).toBeGreaterThan(590_000);
    expect(await id.startLogin()).toEqual({ alreadyAuthenticated: true });
    await id.logout();
    expect((await id.status()).authenticated).toBe(false);
  });
  it("records a cancelled or failed flow and lets the user try again", async () => {
    const sdk = fakeSdk();
    const id = createIdentity(sdk.deps, { renownUrl: "https://www.renown.id", secretsDir: secretsDir() });
    await id.startLogin();
    id.cancelLogin();
    await new Promise((r) => setTimeout(r, 0));
    const s = await id.status();
    expect(s.pending).toBeNull();
    expect(s.lastError).toBe("Login cancelled");
    await id.startLogin();
    expect(sdk.state.logins).toBe(2);
    expect((await id.status()).lastError).toBeUndefined();
  });
});
