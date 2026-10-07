import { describe, expect, it } from "vitest";
import { desktopRenown } from "./desktop-renown.js";

describe("desktopRenown (window.ph.renown for apps that read the ambient session)", () => {
  it("names the signed-in user and hands out the engine's bearer", async () => {
    const r = desktopRenown({ address: "0xAbC", did: "did:pkh:eip155:1:0xabc" }, async () => "jwt-1");
    expect(r.user?.address).toBe("0xAbC");
    expect(r.did).toBe("did:pkh:eip155:1:0xabc");
    expect(r.status).toBe("authorized");
    expect(await r.getBearerToken({ expiresIn: 600 })).toBe("jwt-1");
  });

  it("carries no signer, so how writes are signed does not change", () => {
    expect(desktopRenown({ address: "0xabc" }).signer).toBeUndefined();
  });

  it("answers with no token when the engine is open", async () => {
    expect(await desktopRenown({ address: "0xabc" }).getBearerToken({})).toBeUndefined();
  });

  it("subscriptions are inert, and signing in or out is the app's Settings, not an embedded app", async () => {
    const r = desktopRenown({ address: "0xabc" });
    const off = r.on("user", () => {});
    expect(typeof off).toBe("function");
    await expect(r.login()).rejects.toThrow(/Settings/);
  });
});
