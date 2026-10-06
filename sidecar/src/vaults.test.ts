import { describe, expect, it, vi } from "vitest";
import { createVaultDrive, listVaultDrives, slugify } from "./vaults.js";

const ORIGIN = "http://127.0.0.1:4201";
type Call = { url: string; body?: unknown };

function fakeFetch(handler: (call: Call) => unknown): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    return { ok: true, status: 200, json: async () => handler(call) };
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("slugify", () => {
  it("lowercases, hyphenates spaces and drops everything else", () => {
    expect(slugify("Research Notes (2026)!")).toBe("research-notes-2026");
  });
});

describe("listVaultDrives", () => {
  it("returns only drives whose preferredEditor is knowledge-vault, with a note count", async () => {
    const { fetchImpl } = fakeFetch(({ url }) => {
      if (url.endsWith("/graphql")) {
        return { data: { findDocuments: { items: [
          { id: "v1", name: "Research", slug: "research", state: { global: { nodes: [
            { kind: "file", documentType: "bai/knowledge-note" }, { kind: "file", documentType: "bai/knowledge-note" }, { kind: "folder" } ] } } },
          { id: "w1", name: "Workflows", slug: "workflows", state: { global: { nodes: [] } } },
        ] } } };
      }
      if (url.endsWith("/d/v1")) return { id: "v1", slug: "research", name: "Research", meta: { preferredEditor: "knowledge-vault" } };
      if (url.endsWith("/d/w1")) return { id: "w1", slug: "workflows", name: "Workflows", meta: { preferredEditor: "workflow-studio" } };
      throw new Error(`unexpected ${url}`);
    });
    const vaults = await listVaultDrives(ORIGIN, fetchImpl);
    expect(vaults).toEqual([{ id: "v1", slug: "research", name: "Research", noteCount: 2 }]);
  });
});

describe("createVaultDrive", () => {
  it("creates the drive with the vault app as preferred editor and sets the state name", async () => {
    const { fetchImpl, calls } = fakeFetch(({ body }) => {
      const q = String((body as { query: string }).query);
      if (q.includes("createDocument")) return { data: { DocumentDrive: { createDocument: { id: "v9", slug: "my-vault", name: "My vault" } } } };
      if (q.includes("setDriveName")) return { data: { DocumentDrive: { setDriveName: { id: "v9" } } } };
      throw new Error(`unexpected query ${q}`);
    });
    const vault = await createVaultDrive(ORIGIN, "My vault", fetchImpl);
    expect(vault).toEqual({ id: "v9", slug: "my-vault", name: "My vault", noteCount: 0 });
    expect((calls[0]!.body as { variables: unknown }).variables).toEqual({
      name: "My vault", slug: "my-vault", preferredEditor: "knowledge-vault",
    });
    expect((calls[1]!.body as { variables: unknown }).variables).toEqual({ docId: "v9", input: { name: "My vault" } });
  });
  it("surfaces GraphQL errors instead of returning a half-made vault", async () => {
    const { fetchImpl } = fakeFetch(() => ({ errors: [{ message: "Forbidden" }] }));
    await expect(createVaultDrive(ORIGIN, "X", fetchImpl)).rejects.toThrow(/Forbidden/);
  });
});
