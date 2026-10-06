import { afterEach, describe, expect, it } from "vitest";
import { declareDesktopHost, HOST_SLOT } from "./bootstrap.js";

afterEach(() => { delete (globalThis as Record<string, unknown>)[HOST_SLOT]; });

describe("declareDesktopHost", () => {
  it("writes the slot the vault package reads, before the package is loaded", () => {
    declareDesktopHost("http://127.0.0.1:4201");
    expect((globalThis as Record<string, unknown>)[HOST_SLOT]).toEqual({
      kind: "desktop",
      switchboardOrigin: "http://127.0.0.1:4201",
    });
  });
  it("re-declares when the vault changes (remote vaults later)", () => {
    declareDesktopHost("http://127.0.0.1:4201");
    declareDesktopHost("https://switchboard.knowledge-vault.vetra.io");
    expect((globalThis as unknown as Record<string, { switchboardOrigin: string }>)[HOST_SLOT]!.switchboardOrigin)
      .toBe("https://switchboard.knowledge-vault.vetra.io");
  });
});
