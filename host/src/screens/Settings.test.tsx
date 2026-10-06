// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SettingsApi } from "./Settings.js";
import { Settings } from "./Settings.js";
import type { SettingsSection } from "../shell/router.js";
import { useIdentity, type IdentityApi } from "../state/use-identity.js";
import { useState } from "react";

const theme = vi.hoisted(() => ({ setTheme: vi.fn(), current: "dark" as string, isSystem: false }));
vi.mock("@powerhousedao/reactor-browser", () => ({
  useTheme: () => ({ theme: theme.current, isSystem: theme.isSystem, setTheme: theme.setTheme }),
}));

const info = { origin: "http://127.0.0.1:4301", graphqlUrl: "http://127.0.0.1:4301/graphql", controlOrigin: "http://127.0.0.1:4302", controlToken: "t" };
function api(over: Partial<SettingsApi> = {}): SettingsApi {
  return {
    fetchVaults: vi.fn(async () => [{ id: "v1", slug: "a", name: "Alpha", noteCount: 24 }]),
    renameVault: vi.fn(async (_i, id: string, name: string) => ({ id, slug: "a", name })),
    deleteVault: vi.fn(async () => {}),
    fetchSettings: vi.fn(async () => ({ version: 1 as const, models: { endpoint: "https://openrouter.ai/api/v1", model: "", hasKey: false } })),
    saveSettings: vi.fn(async (_i, patch) => ({ version: 1 as const, models: { endpoint: patch.models?.endpoint ?? "https://openrouter.ai/api/v1", model: patch.models?.model ?? "", hasKey: !!patch.models?.apiKey } })),
    fetchStatus: vi.fn(async () => ({ ok: true as const, port: 4301, controlPort: 4302, appVersion: "0.1.0", protected: false, dataDir: "/home/u/.local/share/kv/vault", stackVersion: "6.2.3-dev.44", vaultPackageVersion: "1.0.54-dev.22" })),
    ...over,
  };
}
const identityApi: IdentityApi = {
  fetchAuthStatus: vi.fn(async () => ({ authenticated: false, appDid: "did:key:z", renownUrl: "https://www.renown.id", pending: null })),
  startLogin: vi.fn(async () => ({ alreadyAuthenticated: false })),
  cancelLogin: vi.fn(async () => ({})),
  logout: vi.fn(async () => ({})),
};
function Harness({ api: a, start = "vaults" }: { api: SettingsApi; start?: SettingsSection }) {
  const [section, setSection] = useState<SettingsSection>(start);
  const identity = useIdentity(info, identityApi);
  return <Settings info={info} section={section} onSection={setSection} onBack={() => {}} onOpenWorkflows={() => {}} api={a} identity={identity} />;
}
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Settings", () => {
  it("lists the sections, shows the vaults, and deletes one through the typed confirmation", async () => {
    const a = api();
    render(<Harness api={a} />);
    expect(screen.getByRole("navigation", { name: "Settings sections" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Vaults" }).getAttribute("aria-current")).toBe("page");
    expect(await screen.findByText("Alpha")).toBeTruthy();
    expect(screen.getByText("24 notes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.change(screen.getByLabelText("Type the vault’s name to confirm"), { target: { value: "Alpha" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete vault" }));
    await waitFor(() => expect(a.deleteVault).toHaveBeenCalledWith(info, "v1"));
    await waitFor(() => expect(screen.getByText("No vaults yet.")).toBeTruthy());
  });

  it("saves model settings with the key only when one was entered, and switches the theme", async () => {
    const a = api();
    render(<Harness api={a} start="models" />);
    const endpoint = await screen.findByLabelText("Endpoint");
    fireEvent.change(endpoint, { target: { value: "http://127.0.0.1:11434/v1" } });
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "llama3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(a.saveSettings).toHaveBeenCalledWith(info, { models: { endpoint: "http://127.0.0.1:11434/v1", model: "llama3" } }));
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "sk-new" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(a.saveSettings).toHaveBeenLastCalledWith(info, { models: { endpoint: "http://127.0.0.1:11434/v1", model: "llama3", apiKey: "sk-new" } }));
    expect(await screen.findByRole("button", { name: "Remove key" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    fireEvent.click(screen.getByLabelText(/^Light/));
    expect(theme.setTheme).toHaveBeenCalledWith("light");
  });

  it("shows diagnostics with the copy blocks for the CLI and MCP, and the versions in About", async () => {
    const a = api();
    render(<Harness api={a} start="diagnostics" />);
    expect(await screen.findByText(/Ready on port 4301/)).toBeTruthy();
    expect(screen.getByText("switchboard init --url http://127.0.0.1:4301/graphql --name local-vault --use-profile")).toBeTruthy();
    expect(screen.getByText("http://127.0.0.1:4301/mcp")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "About" }));
    expect(await screen.findByText("6.2.3-dev.44")).toBeTruthy();
    expect(screen.getByText("1.0.54-dev.22")).toBeTruthy();
  });
});
