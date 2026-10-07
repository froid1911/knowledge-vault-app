import { existsSync, readdirSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { exportVault } from "./export.js";

const ORIGIN = "http://127.0.0.1:4201";
type Call = { url: string; query?: string; variables?: Record<string, unknown> };

/** A reactor with one drive (two documents and a folder), paged operations, graph edges and the vault's REST text. */
function fakeReactor() {
  const calls: Call[] = [];
  const nodes = [
    { id: "f1", kind: "folder", name: "knowledge", parentFolder: null },
    { id: "a", kind: "file", name: "a-claim", documentType: "bai/knowledge-note", parentFolder: "f1" },
    { id: "m", kind: "file", name: "a-map", documentType: "bai/moc", parentFolder: "f1" },
  ];
  const states: Record<string, unknown> = {
    a: { title: "A claim", links: [{ id: "stale", linkType: "RELATES_TO", targetDocumentId: "gone" }] },
    m: { title: "A map", coreIdeas: [], childRefs: [] },
  };
  const edges = [
    { sourceDocumentId: "a", targetDocumentId: "m", linkType: "RELATES_TO", reason: "a sits under m", confidence: "grounded" },
    { sourceDocumentId: "m", targetDocumentId: "a", linkType: "CORE_IDEA", reason: null, confidence: null },
    { sourceDocumentId: "m", targetDocumentId: "m2", linkType: "CHILD_MOC", reason: null, confidence: null },
  ];
  const op = (index: number, type: string) => ({ index, hash: `h${index}`, timestampUtcMs: "2026-10-07T10:00:00.000Z", action: { type, input: { index }, timestampUtcMs: "2026-10-07T10:00:00.000Z" } });
  const fetchImpl = vi.fn(async (url: unknown, init?: { body?: unknown }) => {
    const u = String(url);
    if (u.endsWith("/llms-full.txt?drive=drive1")) {
      calls.push({ url: u });
      return { ok: true, status: 200, text: async () => "# Vault\n\nA claim\n" };
    }
    const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
    calls.push({ url: u, query: body.query, variables: body.variables });
    if (body.query.includes("knowledgeGraphEdges")) {
      expect(u).toBe(`${ORIGIN}/graphql/knowledgeGraph`);
      return { ok: true, json: async () => ({ data: { knowledgeGraphEdges: edges } }) };
    }
    if (body.query.includes("document(idOrSlug")) {
      const id = body.variables.id as string;
      if (id === "drive1") return { ok: true, json: async () => ({ data: { document: { document: { id: "drive1", name: "Research notes", slug: "research-notes", state: { global: { nodes } } } } } }) };
      if (!(id in states)) return { ok: true, json: async () => ({ data: { document: null } }) };
      // "a" pages: two operations, then one more
      const page = id === "a" && !body.variables.cursor ? { items: [op(0, "SET_TITLE"), op(1, "SET_CONTENT")], hasNextPage: true, cursor: "c1" } : id === "a" ? { items: [op(2, "ADD_TOPIC")], hasNextPage: false, cursor: null } : { items: [op(0, "CREATE_MOC"), op(1, "UPDATE_DESCRIPTION")], hasNextPage: false, cursor: null };
      return { ok: true, json: async () => ({ data: { document: { document: { id, state: { global: states[id], auth: { version: 0 } }, operations: page } } } }) };
    }
    throw new Error(`unexpected query: ${body.query}`);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("exportVault", () => {
  it("writes the drive-sync layout upload.py restores: manifest, drive-info, tree, states with rebuilt links, ops, edges, auth and the vault's text", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "kv-export-"));
    const { fetchImpl, calls } = fakeReactor();
    const result = await exportVault({ origin: ORIGIN, driveId: "drive1", dataDir, fetchImpl, now: () => "2026-10-07T12:00:00.000Z" });
    expect(result).toMatchObject({ documents: 2, path: join(dataDir, "exports", "research-notes-2026-10-07T12-00-00Z") });
    expect(result.bytes).toBeGreaterThan(0);
    const read = (f: string) => JSON.parse(readFileSync(join(result.path, f), "utf8")) as Record<string, unknown>;
    expect(read("drive-info.json")).toEqual({ id: "drive1", slug: "research-notes", name: "Research notes" });
    expect((read("tree.json").nodes as unknown[]).length).toBe(3);
    const manifest = read("manifest.json") as { source: Record<string, unknown>; folders: unknown[]; documents: { id: string; type: string; parentFolder: string | null }[] };
    expect(manifest.source).toMatchObject({ endpoint: `${ORIGIN}/graphql`, drive: "research-notes", driveId: "drive1", driveName: "Research notes", relationships: "graph", downloadedAt: "2026-10-07T12:00:00.000Z" });
    expect(manifest.folders).toEqual([{ id: "f1", name: "knowledge", parentFolder: null }]);
    expect(manifest.documents).toEqual([{ id: "a", name: "a-claim", type: "bai/knowledge-note", parentFolder: "f1" }, { id: "m", name: "a-map", type: "bai/moc", parentFolder: "f1" }]);
    // states: the stale links array is replaced by the live edges; a MoC gets its core ideas and children
    const a = read("states/a.json") as { title: string; links: Record<string, unknown>[] };
    expect(a.title).toBe("A claim");
    expect(a.links).toEqual([{ id: "lnk-m-rel", linkType: "RELATES_TO", targetDocumentId: "m", targetTitle: "a-map", reason: "a sits under m", confidence: "grounded" }]);
    const m = read("states/m.json") as { links: unknown[]; coreIdeas: Record<string, unknown>[]; childRefs: string[] };
    expect(m.links).toEqual([]);
    expect(m.coreIdeas).toEqual([{ id: "ci-a", noteRef: "a", contextPhrase: "", sortOrder: 0, addedAt: "2026-10-07T12:00:00.000Z", addedBy: "knowledge-agent" }]);
    expect(m.childRefs).toEqual(["m2"]);
    // ops: every page, in order
    expect((read("ops/a.json") as unknown as unknown[]).length).toBe(3);
    expect((read("ops/m.json") as unknown as unknown[]).length).toBe(2);
    expect((read("edges.json") as unknown as unknown[]).length).toBe(3);
    expect(read("auth.json")).toEqual({ a: { version: 0 }, m: { version: 0 } });
    expect(readFileSync(join(result.path, "llms-full.txt"), "utf8")).toBe("# Vault\n\nA claim\n");
    // the operations query pages 500 at a time and follows the cursor
    const pages = calls.filter((c) => c.query?.includes("operations(") && c.variables?.id === "a");
    expect(pages).toHaveLength(2);
    expect(pages[0]!.query).toMatch(/paging:\s*\{\s*limit:\s*500/);
    expect(pages[1]!.variables).toMatchObject({ cursor: "c1" });
    expect(readdirSync(join(result.path, "states")).sort()).toEqual(["a.json", "m.json"]);
    expect(existsSync(join(result.path, "id-map.json"))).toBe(false); // that file belongs to a restore, never to an export
  });
  it("fails loudly when the drive is not there, and tolerates a missing REST text", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "kv-export-"));
    const fetchImpl = vi.fn(async (url: unknown, init?: { body?: unknown }) => {
      if (String(url).includes("llms-full")) return { ok: false, status: 404, text: async () => "" };
      const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
      if (body.query.includes("knowledgeGraphEdges")) return { ok: true, json: async () => ({ data: { knowledgeGraphEdges: [] } }) };
      if (body.variables.id === "nope") return { ok: true, json: async () => ({ data: { document: null } }) };
      return { ok: true, json: async () => ({ data: { document: { document: { id: "empty", name: "Empty", slug: "empty", state: { global: { nodes: [] } } } } } }) };
    }) as unknown as typeof fetch;
    await expect(exportVault({ origin: ORIGIN, driveId: "nope", dataDir, fetchImpl })).rejects.toThrow(/nope/);
    const r = await exportVault({ origin: ORIGIN, driveId: "empty", dataDir, fetchImpl, now: () => "2026-10-07T12:00:00.000Z" });
    expect(r.documents).toBe(0);
    expect(existsSync(join(r.path, "llms-full.txt"))).toBe(false);
    expect(existsSync(join(r.path, "manifest.json"))).toBe(true);
  });
});
