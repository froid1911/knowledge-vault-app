// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VaultGraphSample } from "../api/graph.js";
import { Landing, type LandingApi } from "../screens/Landing.js";

const info = { origin: "http://127.0.0.1:4301", graphqlUrl: "http://127.0.0.1:4301/graphql", controlOrigin: "http://127.0.0.1:4302", controlToken: "t" };
const sample: VaultGraphSample = {
  noteCount: 371, linkCount: 1208, mocCount: 9,
  nodes: [{ id: "a", kind: "moc", status: "MOC" }, { id: "b", kind: "note", status: "CANONICAL" }, { id: "c", kind: "note", status: "DRAFT" }],
  edges: [["a", "b"], ["b", "c"]],
};
function api(over: Partial<LandingApi> = {}): LandingApi {
  return {
    fetchVaults: vi.fn(async () => []),
    createVault: vi.fn(async (_i, name: string) => ({ id: "v-new", slug: "s", name, noteCount: 0 })),
    fetchGraph: vi.fn(async () => sample),
    fetchVersion: vi.fn(async () => "0.1.0"),
    loadLayout: vi.fn(async () => null),
    ...over,
  };
}
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 };
}
// Testing Library cleans up automatically only under vitest globals; do it explicitly, or renders pile up across tests.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Landing", () => {
  it("first run: the create form is the single target and Enter creates and opens the vault", async () => {
    const a = api();
    const onOpen = vi.fn();
    render(<Landing engine={{ state: "ready" }} info={info} api={a} onOpen={onOpen} storage={memoryStorage()} />);
    expect(await screen.findByText("Create your first vault")).toBeTruthy();
    const input = screen.getByLabelText("Name");
    fireEvent.change(input, { target: { value: "  Research   notes " } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ name: "Research notes" })));
    expect(a.createVault).toHaveBeenCalledWith(info, "Research notes");
  });

  it("lists vaults as tiles, the most recently opened one leading, with a sentence of real numbers", async () => {
    const storage = memoryStorage();
    storage.setItem("kv.recents", JSON.stringify({ v2: "2026-10-06T10:00:00Z" }));
    const a = api({ fetchVaults: vi.fn(async () => [{ id: "v1", slug: "a", name: "Alpha", noteCount: 3 }, { id: "v2", slug: "b", name: "Team wiki", noteCount: 300 }]) });
    render(<Landing engine={{ state: "ready" }} info={info} api={a} storage={storage} />);
    const lead = await screen.findByRole("button", { name: "Open Team wiki" });
    expect(lead.getAttribute("data-lead")).toBe("true");
    expect(screen.getByRole("button", { name: "Open Alpha" }).getAttribute("data-lead")).toBe("false");
    expect(await screen.findAllByText(/371 notes and 1,208 links, /)).toHaveLength(2);
    expect(screen.getByText(/1,208 links, opened /)).toBeTruthy(); // Team wiki was opened
    expect(screen.getByText(/1,208 links, not opened yet\./)).toBeTruthy(); // Alpha never was
    expect(a.fetchGraph).toHaveBeenCalledWith(info.origin, "v2", 48);
    expect(a.fetchGraph).toHaveBeenCalledWith(info.origin, "v1", 28);
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(await screen.findByText("0.1.0")).toBeTruthy();
  });

  it("'New vault' reveals the inline form; Escape puts it away", async () => {
    const a = api({ fetchVaults: vi.fn(async () => [{ id: "v1", slug: "a", name: "Alpha", noteCount: 0 }]) });
    render(<Landing engine={{ state: "ready" }} info={info} api={a} storage={memoryStorage()} />);
    fireEvent.click(await screen.findByRole("button", { name: "New vault" }));
    const input = screen.getByLabelText("Name");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(screen.getByRole("button", { name: "Connect remote vault" }).hasAttribute("disabled")).toBe(true);
  });

  it("shows the engine starting, and an exit with its code, in the same frame without touching the engine", () => {
    const a = api();
    const { rerender } = render(<Landing engine={{ state: "starting" }} api={a} storage={memoryStorage()} />);
    expect(screen.getByText("Starting the engine…")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Vaults" })).toBeTruthy();
    rerender(<Landing engine={{ state: "exited", code: 1 }} api={a} storage={memoryStorage()} />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("The engine stopped")).toBeTruthy();
    expect(screen.getByText(/Exit code 1/)).toBeTruthy();
    rerender(<Landing engine={{ state: "failed", detail: "no ipc" }} api={a} storage={memoryStorage()} />);
    expect(screen.getByText("The app could not reach the engine")).toBeTruthy();
    expect(screen.getByText(/no ipc/)).toBeTruthy();
    expect(a.fetchVaults).not.toHaveBeenCalled();
  });
});
