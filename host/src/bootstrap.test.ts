// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { declareDesktopHost, HOST_CHANGED_EVENT, HOST_SLOT } from "./bootstrap.js";

afterEach(() => { delete (globalThis as Record<string, unknown>)[HOST_SLOT]; });

describe("declareDesktopHost", () => {
  it("writes the slot the vault package reads, before the package is loaded", () => {
    declareDesktopHost("http://127.0.0.1:4201");
    expect((globalThis as Record<string, unknown>)[HOST_SLOT]).toEqual({ kind: "desktop", switchboardOrigin: "http://127.0.0.1:4201" });
  });
  it("re-declares with a bearer and identity for a remote vault, and tells the package", async () => {
    const heard = vi.fn();
    window.addEventListener(HOST_CHANGED_EVENT, heard);
    const bearer = () => Promise.resolve("jwt");
    declareDesktopHost("https://switchboard.knowledge-vault.vetra.io", { bearer, identity: { address: "0xabc" } });
    const slot = (globalThis as Record<string, unknown>)[HOST_SLOT] as { switchboardOrigin: string; bearer: () => Promise<string>; identity: { address: string } };
    expect(slot.switchboardOrigin).toBe("https://switchboard.knowledge-vault.vetra.io");
    expect(await slot.bearer()).toBe("jwt");
    expect(slot.identity).toEqual({ address: "0xabc" });
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener(HOST_CHANGED_EVENT, heard);
  });
});
