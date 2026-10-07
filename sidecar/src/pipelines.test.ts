import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createPipelineManager, readPipelines, writePipelines, type PipelineManagerDeps } from "./pipelines.js";
import type { PipelineTemplate } from "./templates.js";

const template = { version: 1, exportedAt: "x", placeholders: [], connection: { documentType: "powerhouse/connection", operations: [] }, workflow: { documentType: "powerhouse/workflow", operations: [] } } as unknown as PipelineTemplate;
type Call = { query: string; variables: Record<string, unknown> };

/** The engine's GraphQL as the manager sees it: secrets, trigger states, runs, deletes. */
function fakeEngine(triggers: Array<{ workflowId: string; status: string }> = []) {
  const calls: Call[] = [];
  let secrets = 0;
  const fetchImpl = vi.fn(async (_u: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body)) as Call;
    calls.push(body);
    const q = body.query;
    if (q.includes("createSecret")) return { ok: true, json: async () => ({ data: { workflowRuntime: { createSecret: { ref: `secret://v1:${++secrets}` } } } }) };
    if (q.includes("deleteSecret")) return { ok: true, json: async () => ({ data: { workflowRuntime: { deleteSecret: true } } }) };
    if (q.includes("deleteDocument")) return { ok: true, json: async () => ({ data: { deleteDocument: true } }) };
    if (q.includes("triggerStates")) {
      return { ok: true, json: async () => ({ data: { workflowRuntime: { triggerStates: triggers.map((t) => ({ ...t, lastPollAt: "2026-10-07T10:00:00.000Z", lastError: null })), runsPage: { items: [{ id: `run-${body.variables.w}`, status: "FAILED", startedAt: "2026-10-07T09:59:00.000Z", endedAt: "2026-10-07T09:59:30.000Z", error: "no model here" }] } } } }) };
    }
    throw new Error(`unexpected query: ${q}`);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}
function deps(over: Partial<PipelineManagerDeps> & { hasKey?: boolean; signedIn?: boolean; triggers?: Array<{ workflowId: string; status: string }> } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "kv-pipelines-"));
  const engine = fakeEngine(over.triggers);
  const instantiate = vi.fn(async () => ({ workflowId: "wf-1", connectionId: "conn-1" }));
  const hasKey = over.hasKey ?? true;
  const d: PipelineManagerDeps = {
    dataDir,
    origin: "http://127.0.0.1:4201",
    fetchImpl: engine.fetchImpl,
    template,
    pieceVersion: "1.0.54-dev.23",
    readSettings: () => ({ version: 1, models: { endpoint: "https://openrouter.ai/api/v1", model: "openai/gpt-6-luna", hasKey }, conversion: { mode: "local", remoteUrl: "" } }),
    readModelKey: () => (hasKey ? "sk-or-secret" : undefined),
    identity: {
      status: async () => ({ authenticated: over.signedIn ?? true }),
      token: async (expiresIn: number) => ({ token: `jwt-${expiresIn}` }),
    },
    workflowsDrive: async () => ({ id: "wfdrive" }),
    vaultName: async (id: string) => (id === "vault1" ? "Research" : "Team wiki"),
    instantiate,
    now: () => "2026-10-07T10:00:00.000Z",
    ...over,
  };
  return { d, dataDir, engine, instantiate, manager: createPipelineManager(d) };
}

describe("pipeline records", () => {
  it("round-trip through pipelines.json in the data dir", () => {
    const dir = mkdtempSync(join(tmpdir(), "kv-pipelines-"));
    expect(readPipelines(dir)).toEqual({});
    writePipelines(dir, { vault1: { workflowId: "wf-1", connectionId: "conn-1", secretRefs: { token: "secret://v1:1", llm: "secret://v1:2" }, createdAt: "2026-10-07T10:00:00.000Z" } });
    expect(readPipelines(dir).vault1?.workflowId).toBe("wf-1");
  });
});

describe("pipeline manager — ensure", () => {
  it("does nothing without a model key: unconfigured, and the engine is never asked", async () => {
    const { manager, engine, instantiate } = deps({ hasKey: false });
    expect(await manager.ensure("vault1")).toEqual({ state: "unconfigured" });
    expect(engine.calls).toEqual([]);
    expect(instantiate).not.toHaveBeenCalled();
  });
  it("stores the engine token (90 days, minted by the identity) and the model key as runtime secrets, instantiates the template, and records the pipeline", async () => {
    const { manager, engine, instantiate, dataDir } = deps();
    expect(await manager.ensure("vault1")).toEqual({ state: "ready", workflowId: "wf-1", connectionId: "conn-1" });
    const secrets = engine.calls.filter((c) => c.query.includes("createSecret")).map((c) => c.variables);
    expect(secrets).toEqual([
      { v: `jwt-${90 * 86_400}`, l: "Research — engine token" },
      { v: "sk-or-secret", l: "Research — model key" },
    ]);
    expect(instantiate).toHaveBeenCalledWith(expect.objectContaining({
      origin: "http://127.0.0.1:4201",
      vaultName: "Research",
      driveId: "vault1",
      workflowsDriveId: "wfdrive",
      secretRefs: { token: "secret://v1:1", llm: "secret://v1:2" },
      llm: { baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-6-luna" },
      pieceVersion: "1.0.54-dev.23",
    }));
    expect(readPipelines(dataDir).vault1).toEqual({ workflowId: "wf-1", connectionId: "conn-1", secretRefs: { token: "secret://v1:1", llm: "secret://v1:2" }, createdAt: "2026-10-07T10:00:00.000Z" });
  });
  it("uses a placeholder token for an open engine with nobody signed in — the engine ignores bearers there", async () => {
    const { manager, engine } = deps({ signedIn: false });
    await manager.ensure("vault1");
    expect(engine.calls.find((c) => c.query.includes("createSecret"))!.variables.v).toBe("open");
  });
  it("re-creating a pipeline removes the previous documents and secrets first", async () => {
    const { manager, engine } = deps();
    await manager.ensure("vault1");
    await manager.ensure("vault1");
    const deletes = engine.calls.filter((c) => c.query.includes("deleteDocument")).map((c) => c.variables.id).sort();
    expect(deletes).toEqual(["conn-1", "wf-1"]);
    const secretDeletes = engine.calls.filter((c) => c.query.includes("deleteSecret")).map((c) => c.variables.ref).sort();
    expect(secretDeletes).toEqual(["secret://v1:1", "secret://v1:2"]);
  });
});

describe("pipeline manager — status and removal", () => {
  it("is unconfigured without a key, missing without a record, and otherwise this vault's trigger and last run only", async () => {
    const none = deps({ hasKey: false });
    expect(await none.manager.status("vault1")).toEqual({ state: "unconfigured" });
    const fresh = deps();
    expect(await fresh.manager.status("vault1")).toEqual({ state: "missing" });
    const two = deps({ triggers: [{ workflowId: "wf-1", status: "ENABLED" }, { workflowId: "wf-other", status: "DISABLED" }] });
    writePipelines(two.dataDir, {
      vault1: { workflowId: "wf-1", connectionId: "conn-1", secretRefs: { token: "s1", llm: "s2" }, createdAt: "x" },
      vault2: { workflowId: "wf-other", connectionId: "conn-2", secretRefs: { token: "s3", llm: "s4" }, createdAt: "x" },
    });
    expect(await two.manager.status("vault1")).toEqual({
      state: "ready",
      workflowId: "wf-1",
      connectionId: "conn-1",
      trigger: { status: "ENABLED", lastPollAt: "2026-10-07T10:00:00.000Z", lastError: null },
      lastRun: { id: "run-wf-1", status: "FAILED", startedAt: "2026-10-07T09:59:00.000Z", endedAt: "2026-10-07T09:59:30.000Z", error: "no model here" },
    });
    expect((await two.manager.status("vault2")).state === "ready" && (await two.manager.status("vault2") as { trigger?: { status: string } }).trigger?.status).toBe("DISABLED");
  });
  it("removal deletes the documents, the secrets and the record, and tolerates a vault without a pipeline", async () => {
    const { manager, engine, dataDir } = deps();
    await manager.ensure("vault1");
    await manager.remove("vault1");
    expect(engine.calls.filter((c) => c.query.includes("deleteDocument")).length).toBe(2);
    expect(engine.calls.filter((c) => c.query.includes("deleteSecret")).length).toBe(2);
    expect(readPipelines(dataDir)).toEqual({});
    await manager.remove("nobody"); // no throw
  });
});
