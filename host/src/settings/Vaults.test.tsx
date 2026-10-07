// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SettingsApi } from "../screens/Settings.js";
import type { IdentityController } from "../state/use-identity.js";
import { VaultsSection } from "./Vaults.js";

const info = { origin: "http://127.0.0.1:4301", graphqlUrl: "http://127.0.0.1:4301/graphql", controlOrigin: "http://127.0.0.1:4302", controlToken: "t" };
const noop = async () => {};
function identity(authenticated: boolean): IdentityController {
  return {
    status: { authenticated, address: authenticated ? "0xabcdef0123456789" : undefined, appDid: "did:key:z", renownUrl: "https://www.renown.id", pending: null },
    error: null,
    refresh: noop,
    signIn: noop,
    cancel: noop,
    signOut: noop,
  } as unknown as IdentityController;
}
function api(over: Partial<SettingsApi> = {}): SettingsApi {
  return {
    fetchVaults: vi.fn(async () => []),
    renameVault: vi.fn(async (_i, id: string, name: string) => ({ id, slug: "a", name })),
    deleteVault: vi.fn(async () => {}),
    fetchSettings: vi.fn(),
    saveSettings: vi.fn(),
    fetchStatus: vi.fn(async () => ({ ok: true as const, port: 4301, controlPort: 4302, appVersion: "0.1.0", protected: false, dataDir: "/d", stackVersion: "s", vaultPackageVersion: "v" })),
    fetchConverter: vi.fn(),
    restartConverter: vi.fn(),
    installConverter: vi.fn(),
    removeConverter: vi.fn(),
    fetchProtection: vi.fn(async () => ({ protected: false, adminAddress: null })),
    setProtection: vi.fn(async (_i, p: boolean) => ({ restarting: true, protected: p, adminAddress: "0xabcdef0123456789" })),
    ...over,
  } as SettingsApi;
}
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("VaultsSection — protection", () => {
  it("keeps the switch disabled with the reason while signed out", async () => {
    render(<VaultsSection info={info} api={api()} identity={identity(false)} />);
    const button = await screen.findByRole("button", { name: "Protect local vaults" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Sign in first/)).toBeTruthy();
  });
  it("protects, shows the engine restarting, and settles on the protected state once the engine answers", async () => {
    let answers = 0;
    const a = api({
      fetchStatus: vi.fn(async () => ({ ok: true as const, port: 4301, controlPort: 4302, appVersion: "0.1.0", protected: ++answers > 1, dataDir: "/d", stackVersion: "s", vaultPackageVersion: "v" })),
    });
    render(<VaultsSection info={info} api={a} identity={identity(true)} pollMs={5} onRestarted={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Protect local vaults" }));
    expect(a.setProtection).toHaveBeenCalledWith(info, true);
    expect((await screen.findByRole("status")).textContent).toContain("Restarting the engine");
    await waitFor(() => expect(screen.getByRole("button", { name: "Open local vaults" })).toBeTruthy());
    expect(screen.getByRole("region", { name: "Protection" }).textContent).toContain("0xabcd…6789 is their administrator");
  });
  it("names the engine's refusal", async () => {
    const a = api({ setProtection: vi.fn(async () => { throw new Error("Sign in first — protection makes your Renown identity the vaults' administrator."); }) });
    render(<VaultsSection info={info} api={a} identity={identity(true)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Protect local vaults" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Sign in first");
  });
});
