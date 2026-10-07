import { describe, expect, it, vi } from "vitest";
import { createDocument, deleteDocument, execute, toActions } from "./reactor-gql.js";

const ORIGIN = "http://127.0.0.1:4201";
type Call = { query: string; variables: Record<string, unknown> };
/** A reactor that creates documents, records every executed action as an operation, and reads them back. */
function fakeReactor(opts: { rejectType?: string; rejectWith?: string } = {}) {
  const calls: Call[] = [];
  const ops = new Map<string, Array<{ index: number; error: string | null; action: { type: string } }>>();
  let n = 0;
  const fetchImpl = vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body)) as Call;
    calls.push(body);
    const q = body.query;
    const ns = /(Connection|Workflow)\s*\{/.exec(q)?.[1];
    if (q.includes("createDocument") && ns) {
      const id = `doc${++n}`;
      ops.set(id, [{ index: 0, error: null, action: { type: "CREATE_DOCUMENT" } }, { index: 1, error: null, action: { type: "UPGRADE_DOCUMENT" } }]);
      return { ok: true, json: async () => ({ data: { [ns]: { createDocument: { id } } } }) };
    }
    if (q.includes("execute(")) {
      const id = body.variables.id as string;
      const list = ops.get(id) ?? [];
      for (const a of body.variables.a as Array<{ type: string }>) list.push({ index: list.length, error: a.type === opts.rejectType ? (opts.rejectWith ?? "rejected") : null, action: { type: a.type } });
      ops.set(id, list);
      return { ok: true, json: async () => ({ data: { execute: { id } } }) };
    }
    if (q.includes("operations(")) {
      const id = body.variables.id as string;
      return { ok: true, json: async () => ({ data: { document: { document: { operations: { items: ops.get(id) ?? [], hasNextPage: false, cursor: null } } } } }) };
    }
    if (q.includes("deleteDocument")) return { ok: true, json: async () => ({ data: { deleteDocument: true } }) };
    throw new Error(`unexpected query: ${q}`);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls, ops };
}

describe("reactor-gql", () => {
  it("creates a document through the model's namespace and returns its id", async () => {
    const { fetchImpl, calls } = fakeReactor();
    expect(await createDocument(ORIGIN, "powerhouse/connection", "Research — Knowledge Vault", "wfdrive", fetchImpl)).toBe("doc1");
    expect(calls[0]!.query).toMatch(/Connection\s*\{\s*createDocument\(name: \$name, parentIdOrSlug: \$parent\)\s*\{\s*id\s*\}/);
    expect(calls[0]!.variables).toEqual({ name: "Research — Knowledge Vault", parent: "wfdrive" });
    await expect(createDocument(ORIGIN, "bai/unknown", "x", "w", fetchImpl)).rejects.toThrow(/bai\/unknown/);
  });
  it("turns template operations into actions the reactor accepts", () => {
    const actions = toActions([{ type: "SET_CONFIG", input: { config: { a: 1 } } }], () => "2026-10-07T10:00:00.000Z");
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ type: "SET_CONFIG", input: { config: { a: 1 } }, scope: "global", timestampUtcMs: "2026-10-07T10:00:00.000Z" });
    expect(actions[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("executes a batch and reads the new operations back; a rejected one names the action and the reducer's reason", async () => {
    const ok = fakeReactor();
    const id = await createDocument(ORIGIN, "powerhouse/workflow", "W", "d", ok.fetchImpl);
    await execute(ORIGIN, id, toActions([{ type: "SET_WORKFLOW_NAME", input: { name: "W" } }, { type: "PUBLISH_WORKFLOW", input: {} }]), ok.fetchImpl);
    expect(ok.calls.filter((c) => c.query.includes("execute(")).length).toBe(1);
    expect(ok.calls.at(-1)!.query).toContain("operations(");
    const bad = fakeReactor({ rejectType: "PUBLISH_WORKFLOW", rejectWith: "Workflow has no steps" });
    const id2 = await createDocument(ORIGIN, "powerhouse/workflow", "W", "d", bad.fetchImpl);
    await expect(execute(ORIGIN, id2, toActions([{ type: "SET_WORKFLOW_NAME", input: { name: "W" } }, { type: "PUBLISH_WORKFLOW", input: {} }]), bad.fetchImpl)).rejects.toThrow(/PUBLISH_WORKFLOW.*Workflow has no steps/);
  });
  it("deletes a document", async () => {
    const { fetchImpl, calls } = fakeReactor();
    await deleteDocument(ORIGIN, "doc9", fetchImpl);
    expect(calls[0]!.query).toContain("deleteDocument(idOrSlug: $id");
    expect(calls[0]!.variables).toEqual({ id: "doc9" });
  });
});
