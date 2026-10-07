import { describe, expect, it, vi } from "vitest";
import { createDocument, deleteDocument, execute, toActions } from "./reactor-gql.js";

const ORIGIN = "http://127.0.0.1:4201";
type Call = { query: string; variables: Record<string, unknown> };
type Op = { index: number; scope: "document" | "global"; error: string | null; action: { type: string } };
/**
 * A reactor like the installed one: a fresh document already holds CREATE_DOCUMENT and
 * UPGRADE_DOCUMENT in the `document` scope with their own index sequence; executed actions land in
 * `global` with theirs; `operations()` answers every scope unless `filter: { scopes: […] }` narrows it.
 */
export function fakeReactor(opts: { rejectType?: string; rejectWith?: string } = {}) {
  const calls: Call[] = [];
  const ops = new Map<string, Op[]>();
  let n = 0;
  const fetchImpl = vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body)) as Call;
    calls.push(body);
    const q = body.query;
    const ns = /(Connection|Workflow)\s*\{/.exec(q)?.[1];
    if (q.includes("createDocument") && ns) {
      const id = `doc${++n}`;
      ops.set(id, [
        { index: 0, scope: "document", error: null, action: { type: "CREATE_DOCUMENT" } },
        { index: 1, scope: "document", error: null, action: { type: "UPGRADE_DOCUMENT" } },
      ]);
      return { ok: true, json: async () => ({ data: { [ns]: { createDocument: { id } } } }) };
    }
    if (q.includes("execute(")) {
      const id = body.variables.id as string;
      const list = ops.get(id) ?? [];
      let next = list.filter((o) => o.scope === "global").length;
      for (const a of body.variables.a as Array<{ type: string }>) list.push({ index: next++, scope: "global", error: a.type === opts.rejectType ? (opts.rejectWith ?? "rejected") : null, action: { type: a.type } });
      ops.set(id, list);
      return { ok: true, json: async () => ({ data: { execute: { id } } }) };
    }
    if (q.includes("operations(")) {
      const id = body.variables.id as string;
      const all = ops.get(id) ?? [];
      const scoped = /scopes:\s*\[\s*"global"\s*\]/.test(q) ? all.filter((o) => o.scope === "global") : all;
      const items = [...scoped].sort((a, b) => a.index - b.index).map(({ index, error, action }) => ({ index, error, action }));
      return { ok: true, json: async () => ({ data: { document: { document: { operations: { items, hasNextPage: false, cursor: null } } } } }) };
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
  it("reads back only the global scope, so a rejected FIRST operation is seen and named", async () => {
    const ok = fakeReactor();
    const id = await createDocument(ORIGIN, "powerhouse/workflow", "W", "d", ok.fetchImpl);
    await execute(ORIGIN, id, toActions([{ type: "SET_WORKFLOW_NAME", input: { name: "W" } }, { type: "PUBLISH_WORKFLOW", input: {} }]), ok.fetchImpl);
    const readBack = ok.calls.find((c) => c.query.includes("operations("))!;
    expect(readBack.query).toMatch(/filter:\s*\{\s*scopes:\s*\["global"\]/);
    // the document scope's two operations must not be mistaken for the batch
    const bad = fakeReactor({ rejectType: "SET_WORKFLOW_NAME", rejectWith: "Name is empty" });
    const id2 = await createDocument(ORIGIN, "powerhouse/workflow", "W", "d", bad.fetchImpl);
    await expect(execute(ORIGIN, id2, toActions([{ type: "SET_WORKFLOW_NAME", input: { name: "" } }, { type: "PUBLISH_WORKFLOW", input: {} }]), bad.fetchImpl)).rejects.toThrow(/SET_WORKFLOW_NAME.*Name is empty/);
    const later = fakeReactor({ rejectType: "PUBLISH_WORKFLOW", rejectWith: "Workflow has no steps" });
    const id3 = await createDocument(ORIGIN, "powerhouse/workflow", "W", "d", later.fetchImpl);
    await expect(execute(ORIGIN, id3, toActions([{ type: "SET_WORKFLOW_NAME", input: { name: "W" } }, { type: "PUBLISH_WORKFLOW", input: {} }]), later.fetchImpl)).rejects.toThrow(/PUBLISH_WORKFLOW.*Workflow has no steps/);
  });
  it("deletes a document", async () => {
    const { fetchImpl, calls } = fakeReactor();
    await deleteDocument(ORIGIN, "doc9", fetchImpl);
    expect(calls[0]!.query).toContain("deleteDocument(idOrSlug: $id");
    expect(calls[0]!.variables).toEqual({ id: "doc9" });
  });
});
