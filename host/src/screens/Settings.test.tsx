// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SettingsApi } from "./Settings.js";
import { Settings } from "./Settings.js";
import type { SettingsSection } from "../shell/router.js";
import type { ConverterStatus, SettingsPatch } from "../vaults.js";

const converterReady: ConverterStatus = {
  mode: "local",
  state: "ready",
  url: "http://127.0.0.1:5999",
  localUrl: "http://127.0.0.1:5999",
  pid: 4242,
  exitCode: null,
  restarts: 0,
  logPath: "/home/u/.local/share/kv/vault/logs/converter.log",
  health: { ok: true, backend: "pdfjs", binding: false, ready: false, formats: ["pdf", "md", "markdown", "txt"] },
  error: null,
  installed: { binding: { installed: false, version: null, supported: true, platform: "linux-x64-gnu", reason: null }, models: { installed: false, supported: true, reason: null } },
  job: null,
};
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
    fetchSettings: vi.fn(async () => ({ version: 1 as const, models: { endpoint: "https://openrouter.ai/api/v1", model: "", hasKey: false }, conversion: { mode: "local" as const, remoteUrl: "" } })),
    saveSettings: vi.fn(async (_i, patch: SettingsPatch) => ({ version: 1 as const, models: { endpoint: patch.models?.endpoint ?? "https://openrouter.ai/api/v1", model: patch.models?.model ?? "", hasKey: !!patch.models?.apiKey }, conversion: { mode: patch.conversion?.mode ?? ("local" as const), remoteUrl: patch.conversion?.remoteUrl ?? "" } })),
    fetchStatus: vi.fn(async () => ({ ok: true as const, port: 4301, controlPort: 4302, appVersion: "0.1.0", protected: false, dataDir: "/home/u/.local/share/kv/vault", stackVersion: "6.2.3-dev.44", vaultPackageVersion: "1.0.54-dev.22" })),
    fetchConverter: vi.fn(async () => converterReady),
    restartConverter: vi.fn(async () => converterReady),
    installConverter: vi.fn(async (_i, component) => ({
      ...converterReady,
      job: { component, phase: "downloading" as const, percent: 42, bytes: 42, total: 100, message: "Downloading docling.rs-linux-x64-gnu — 42 %", error: null, startedAt: "2026-10-06T00:00:00.000Z", finishedAt: null },
    })),
    removeConverter: vi.fn(async () => converterReady),
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

  it("shows the converter's state and what it reads, restarts it, and switches where documents convert", async () => {
    const a = api();
    render(<Harness api={a} start="conversion" />);
    const nav = Array.from(screen.getByRole("navigation", { name: "Settings sections" }).querySelectorAll("button")).map((b) => b.textContent);
    expect(nav.indexOf("Conversion")).toBe(nav.indexOf("Models") + 1);
    expect(await screen.findByText("Ready")).toBeTruthy();
    expect(screen.getByText(/^Reads PDF, Markdown and plain text files\./)).toBeTruthy();
    expect(screen.getByText(/binding, which is not installed/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    await waitFor(() => expect(a.restartConverter).toHaveBeenCalledWith(info));

    fireEvent.click(screen.getByLabelText(/^Another server/));
    fireEvent.change(screen.getByLabelText("Server URL"), { target: { value: "http://10.0.0.5:5011" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(a.saveSettings).toHaveBeenCalledWith(info, { conversion: { mode: "remote", remoteUrl: "http://10.0.0.5:5011" } }));
    fireEvent.click(screen.getByLabelText(/^Off/));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(a.saveSettings).toHaveBeenLastCalledWith(info, { conversion: { mode: "off", remoteUrl: "http://10.0.0.5:5011" } }));
    expect(a.fetchConverter).toHaveBeenCalledTimes(3); // on open, after each save
  });

  it("names the exit code and the log when the converter is down", async () => {
    const down: ConverterStatus = { ...converterReady, state: "down", url: null, localUrl: null, pid: null, exitCode: 1, restarts: 1, health: null, error: "the converter exited with code 1 twice within 30 s" };
    const a = api({ fetchConverter: vi.fn(async () => down) });
    render(<Harness api={a} start="conversion" />);
    expect(await screen.findByText("Not responding")).toBeTruthy();
    expect(screen.getByText(/exited with code 1 twice/)).toBeTruthy();
    expect(screen.getByText(/converter\.log/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Restart" })).toBeTruthy();
  });

  it("offers the binding, gates the models on it, starts an install and shows its progress", async () => {
    const a = api();
    render(<Harness api={a} start="conversion" />);
    expect(await screen.findByRole("button", { name: "Install binding" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Install models" })).toBeNull();
    expect(screen.getByText("Needs the converter binding first.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Install binding" }));
    await waitFor(() => expect(a.installConverter).toHaveBeenCalledWith(info, "binding"));
    expect(await screen.findByText("Downloading docling.rs-linux-x64-gnu — 42 %")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Converter binding install progress" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Install binding" })).toBeNull();
  });

  it("shows an installed binding with its version and offers to remove it, and the models become installable", async () => {
    const withBinding: ConverterStatus = { ...converterReady, installed: { binding: { installed: true, version: "1.58.0", supported: true, platform: "linux-x64-gnu", reason: null }, models: { installed: false, supported: true, reason: null } }, health: { ...converterReady.health, binding: true, formats: ["pdf", "md", "docx", "pptx", "xlsx"] } };
    const a = api({ fetchConverter: vi.fn(async () => withBinding) });
    render(<Harness api={a} start="conversion" />);
    expect(await screen.findByText("Installed · version 1.58.0")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove binding" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Install models" })).toBeTruthy();
    expect(screen.getByText(/^Reads PDF, Markdown, Word, slides and spreadsheets files\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove binding" }));
    await waitFor(() => expect(a.removeConverter).toHaveBeenCalledWith(info, "binding"));
  });

  it("explains why the binding is not available on this platform and offers nothing to install", async () => {
    const mac: ConverterStatus = { ...converterReady, installed: { binding: { installed: false, version: null, supported: false, platform: null, reason: "The converter for macOS is coming — text PDFs, Markdown and plain text work now." }, models: { installed: false, supported: true, reason: null } } };
    const a = api({ fetchConverter: vi.fn(async () => mac) });
    render(<Harness api={a} start="conversion" />);
    expect(await screen.findByText(/converter for macOS is coming/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Install binding" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Install models" })).toBeNull();
  });

  it("headlines another server by its answer, and names why the models cannot be installed here", async () => {
    const remote: ConverterStatus = { ...converterReady, mode: "remote", state: "off", url: "http://10.0.0.5:5011", localUrl: null, pid: null, health: { ok: true, backend: "docling.rs", binding: true, ready: true, formats: ["pdf", "docx"] } };
    const a = api({
      fetchConverter: vi.fn(async () => remote),
      fetchSettings: vi.fn(async () => ({ version: 1 as const, models: { endpoint: "https://openrouter.ai/api/v1", model: "", hasKey: false }, conversion: { mode: "remote" as const, remoteUrl: "http://10.0.0.5:5011" } })),
    });
    render(<Harness api={a} start="conversion" />);
    expect(await screen.findByText("Another server · Ready")).toBeTruthy();
    expect(screen.queryByText("Stopped")).toBeNull();
    cleanup();
    const windows: ConverterStatus = { ...converterReady, installed: { binding: { installed: true, version: "1.58.0", supported: true, platform: "win32-x64-msvc", reason: null }, models: { installed: false, supported: false, reason: "The PDF models need a Unix shell to install; Windows support arrives with its converter binding." } } };
    const b = api({ fetchConverter: vi.fn(async () => windows) });
    render(<Harness api={b} start="conversion" />);
    expect(await screen.findByText(/need a Unix shell/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Install models" })).toBeNull();
  });
});
