import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deleteDocument, gql } from "./reactor-gql.js";
import type { AppSettings } from "./settings.js";
import { instantiatePipeline, type PipelineTemplate } from "./templates.js";

/**
 * Spec §4.5: every local vault gets the pipeline — the shipped template
 * instantiated with this vault's drive, the engine's origin, the user's model
 * settings and two workflow-runtime secrets: the bearer the piece calls the
 * vault with, and the model key. The records live in `<dataDir>/pipelines.json`;
 * the secrets live only in the runtime's store.
 */
export type PipelineRecord = { workflowId: string; connectionId: string; secretRefs: { token: string; llm: string }; createdAt: string };
export type PipelineStatus =
  | { state: "unconfigured" }
  | { state: "missing" }
  | {
      state: "ready";
      workflowId: string;
      connectionId: string;
      trigger?: { status: string; lastPollAt: string | null; lastError: string | null };
      lastRun?: { id: string; status: string; startedAt: string | null; endedAt: string | null; error: string | null };
    };
export type EnsureResult = { state: "unconfigured" } | { state: "ready"; workflowId: string; connectionId: string };

const file = (dataDir: string) => join(dataDir, "pipelines.json");

export function readPipelines(dataDir: string): Record<string, PipelineRecord> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file(dataDir), "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, PipelineRecord>) : {};
  } catch {
    return {};
  }
}
export function writePipelines(dataDir: string, records: Record<string, PipelineRecord>): void {
  mkdirSync(dataDir, { recursive: true });
  const tmp = `${file(dataDir)}.tmp`;
  writeFileSync(tmp, JSON.stringify(records, null, 2) + "\n");
  renameSync(tmp, file(dataDir));
}

export type PipelineManagerDeps = {
  dataDir: string;
  origin: string;
  fetchImpl: typeof fetch;
  /** The template the installed vault package ships; absent when the package predates it. */
  template: PipelineTemplate | undefined;
  pieceVersion: string;
  readSettings: () => AppSettings;
  readModelKey: () => string | undefined;
  identity: { status: () => Promise<{ authenticated: boolean }>; token: (expiresIn: number) => Promise<{ token: string }> };
  workflowsDrive: () => Promise<{ id: string }>;
  vaultName: (vaultId: string) => Promise<string>;
  instantiate?: typeof instantiatePipeline;
  now?: () => string;
};

/** The bearer the piece uses lasts long enough to be forgotten about; re-creating the pipeline mints a new one. */
const ENGINE_TOKEN_SECONDS = 90 * 86_400;

export function createPipelineManager(deps: PipelineManagerDeps) {
  const f = deps.fetchImpl;
  const now = deps.now ?? (() => new Date().toISOString());
  const instantiate = deps.instantiate ?? instantiatePipeline;

  async function createSecret(value: string, label: string): Promise<string> {
    const data = await gql<{ workflowRuntime: { createSecret: { ref: string } } }>(
      deps.origin,
      `mutation($v: String!, $l: String) { workflowRuntime { createSecret(value: $v, label: $l) { ref } } }`,
      { v: value, l: label },
      f,
    );
    return data.workflowRuntime.createSecret.ref;
  }
  const deleteSecret = (ref: string) => gql(deps.origin, `mutation($ref: String!) { workflowRuntime { deleteSecret(ref: $ref) } }`, { ref }, f).catch(() => undefined);
  async function discard(record: PipelineRecord): Promise<void> {
    for (const id of [record.workflowId, record.connectionId]) await deleteDocument(deps.origin, id, f).catch(() => undefined);
    for (const ref of [record.secretRefs.token, record.secretRefs.llm]) await deleteSecret(ref);
  }
  /** Signed in: a long-lived bearer minted by the identity. Open engine, nobody signed in: any value — the engine never reads it. */
  async function engineToken(): Promise<string> {
    try {
      if ((await deps.identity.status()).authenticated) return (await deps.identity.token(ENGINE_TOKEN_SECONDS)).token;
    } catch {
      // expired or unavailable: fall through
    }
    return "open";
  }

  return {
    /** Create (or re-create) this vault's pipeline. Nothing happens without a model key. */
    async ensure(vaultId: string): Promise<EnsureResult> {
      const settings = deps.readSettings();
      const key = deps.readModelKey();
      if (!settings.models.hasKey || !key) return { state: "unconfigured" };
      if (!deps.template) throw new Error("The installed vault package ships no pipeline template (pieces/knowledge-vault/templates/pipeline.json).");
      const previous = readPipelines(deps.dataDir)[vaultId];
      if (previous) await discard(previous);
      const name = await deps.vaultName(vaultId);
      const tokenRef = await createSecret(await engineToken(), `${name} — engine token`);
      const llmRef = await createSecret(key, `${name} — model key`);
      const { id: workflowsDriveId } = await deps.workflowsDrive();
      const { workflowId, connectionId } = await instantiate({
        origin: deps.origin,
        template: deps.template,
        vaultName: name,
        driveId: vaultId,
        workflowsDriveId,
        secretRefs: { token: tokenRef, llm: llmRef },
        llm: { baseUrl: settings.models.endpoint, model: settings.models.model },
        pieceVersion: deps.pieceVersion,
        now,
        fetchImpl: f,
      });
      writePipelines(deps.dataDir, { ...readPipelines(deps.dataDir), [vaultId]: { workflowId, connectionId, secretRefs: { token: tokenRef, llm: llmRef }, createdAt: now() } });
      return { state: "ready", workflowId, connectionId };
    },

    /** This vault's pipeline as the runtime sees it: its trigger (filtered to its workflow) and its last run. */
    async status(vaultId: string): Promise<PipelineStatus> {
      if (!deps.readSettings().models.hasKey) return { state: "unconfigured" };
      const record = readPipelines(deps.dataDir)[vaultId];
      if (!record) return { state: "missing" };
      const data = await gql<{
        workflowRuntime: {
          triggerStates: Array<{ workflowId: string; status: string; lastPollAt: string | null; lastError: string | null }>;
          runsPage: { items: Array<{ id: string; status: string; startedAt: string | null; endedAt: string | null; error: string | null }> };
        };
      }>(
        deps.origin,
        `query($w: String!) { workflowRuntime { triggerStates { workflowId status lastPollAt lastError } runsPage(workflowId: $w, paging: { limit: 1 }) { items { id status startedAt endedAt error } } } }`,
        { w: record.workflowId },
        f,
      );
      const trigger = data.workflowRuntime.triggerStates.find((t) => t.workflowId === record.workflowId);
      const run = data.workflowRuntime.runsPage.items[0];
      return {
        state: "ready",
        workflowId: record.workflowId,
        connectionId: record.connectionId,
        ...(trigger ? { trigger: { status: trigger.status, lastPollAt: trigger.lastPollAt, lastError: trigger.lastError } } : {}),
        ...(run ? { lastRun: { id: run.id, status: run.status, startedAt: run.startedAt, endedAt: run.endedAt, error: run.error } } : {}),
      };
    },

    /** Delete the pipeline's documents and secrets and forget the record; a vault without one is left alone. */
    async remove(vaultId: string): Promise<void> {
      const records = readPipelines(deps.dataDir);
      const record = records[vaultId];
      if (!record) return;
      await discard(record);
      delete records[vaultId];
      writePipelines(deps.dataDir, records);
    },
  };
}
export type PipelineManager = ReturnType<typeof createPipelineManager>;
