# Desktop Knowledge Vault — Phase 2 "Pipeline" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Queuing a source in a local vault produces notes locally: the working *Vault pipeline (auto)* workflow is exported once as a template shipped with the vault package, instantiated per vault by the sidecar with the user's model endpoint and key, and Workflow Studio is reachable from Settings for further workflows.

**Architecture:** Templates are **replayable operation lists** — model-agnostic: the export script reads a workflow document's and its connection's operations from the Switchboard, replaces concrete ids with placeholders, and the sidecar instantiates them by creating fresh documents in the Workflows drive and replaying the operations through the reactor's `execute` mutation with substitutions. The LLM key is stored once in the workflow runtime's secret store (`createSecret`) and referenced by the connection. Workflow Studio mounts in the host exactly as the vault app does (an app module for the Workflows drive).

**Tech Stack:** as before; the workflow runtime GraphQL on the sidecar's `/graphql` (`createSecret(value, label)`, `triggerStates`, `runsPage`, `fire`), the `powerhouse/workflow` and `powerhouse/connection` models from `@powerhousedao/workflow`.

**Spec:** §4.5 (workflows and the pipeline template), §5.2 (Settings › Models, Workflows), §7.5 (template shipped with the piece), §9 (pipeline failures surfaced), §1 success criterion "queue a pasted source → notes appear locally". **Prerequisites:** Plans 0 and 1.

## Global Constraints

- Plan 0 and Plan 1 constraints apply.
- The LLM key never leaves the sidecar's process except to the model endpoint: the host sends it once over the loopback control API; it is stored as a workflow-runtime secret and in no file the host can read; `GET /models` returns `configured: true|false`, never the key.
- The egress allow-list (`PH_WORKFLOWS_EGRESS_ALLOW_ADDRESSES`) carries loopback plus the model endpoint's host; in local-only mode (Phase 4 adds the switch) it carries loopback only.
- Template export runs against the developer's own Vetra (`http://localhost:4001`) with the CLI's token; the exported JSON contains **no secret values**, only the placeholder for the secret id.
- Reactor mutation names use the dev.35+ arguments: `execute(documentIdOrSlug:, actions:, branch:)`, `<Model> { createDocument(name:, parentIdOrSlug:) }`.

## Review Focus

1. **Model endpoint without a trailing `/v1`, or with a path** (users paste `https://openrouter.ai/api/v1/chat/completions`): normalise to the base URL the piece expects and show the normalised value — Task 4 `models.test.ts`.
2. **Creating a vault before any model is configured**: the vault is created, no pipeline is instantiated, `pipeline: "unconfigured"` is reported, and the banner in the vault offers setup — Task 3 control test "POST /vaults without models".
3. **Template placeholders that never got substituted** (a new placeholder added to the template but not to the substitution map): instantiation must fail before executing anything, naming the placeholder — Task 2 `templates.test.ts` "unknown placeholder aborts".
4. **A replayed operation rejected by the reducer** (model version drift between the exported template and the installed package): the instantiation reports the operation type and the reducer's error, and the half-made documents are deleted — Task 2 test with a fake `execute` answering an `error` on one operation.
5. **Two vaults sharing one Workflows drive**: each vault's workflow and connection names carry the vault's name, and `triggerStates` is filtered by the workflow ids the sidecar recorded for that vault — Task 3 test `GET /vaults/:id/pipeline` with two vaults.

---

## Part A — vault package (`bai-knowledge-note`)

### Task 1: Export the pipeline template and ship it with the piece

**Files:**
- Create: `scripts/export-workflow-template.mjs`, `scripts/lib/workflow-template.mjs`, `scripts/lib/workflow-template.test.mjs`, `pieces/knowledge-vault/templates/pipeline.json` (generated), `pieces/knowledge-vault/templates/README.md`
- Modify: `package.json` (`exports["./pieces/knowledge-vault/templates/*"]` → `./dist/node/pieces/knowledge-vault/templates/*`), `scripts/copy-runtime-assets.mjs` (copy `pieces/knowledge-vault/templates/*.json` into `dist/node/pieces/knowledge-vault/templates/`)

**Interfaces:**
- Produces: `templatize(docs: { workflow: Op[]; connection: Op[] }, ids: { driveId: string; connectionId: string; secretId: string; switchboardOrigin: string }): PipelineTemplate` where `type Op = { type: string; input: unknown }` and
```ts
type PipelineTemplate = {
  version: 1;
  exportedAt: string;
  placeholders: ["{{DRIVE_ID}}", "{{CONNECTION_ID}}", "{{SECRET_ID}}", "{{SWITCHBOARD_ORIGIN}}", "{{VAULT_NAME}}"];
  connection: { documentType: "powerhouse/connection"; operations: Op[] };
  workflow: { documentType: "powerhouse/workflow"; operations: Op[] };
};
```
- The shipped file is importable from the package as `@powerhousedao/knowledge-note/pieces/knowledge-vault/templates/pipeline.json`.

- [ ] **Step 1: Failing test**
```js
// scripts/lib/workflow-template.test.mjs
import { describe, expect, it } from "vitest";
import { templatize } from "./workflow-template.mjs";
describe("templatize", () => {
  it("replaces every concrete id and the origin with placeholders, everywhere in the inputs", () => {
    const t = templatize(
      { workflow: [{ type: "SET_TRIGGER", input: { driveId: "D1", connectionId: "C1", url: "http://localhost:4001/api/x" } }, { type: "SET_WORKFLOW_NAME", input: { name: "Vault pipeline (auto)" } }],
        connection: [{ type: "SET_CONNECTION_NAME", input: { name: "Vault" } }, { type: "SET_PROPS", input: { props: { baseUrl: "http://localhost:4001", apiKey: { secretId: "S1" } } } }] },
      { driveId: "D1", connectionId: "C1", secretId: "S1", switchboardOrigin: "http://localhost:4001" },
    );
    expect(JSON.stringify(t)).not.toMatch(/D1|C1|S1|localhost:4001/);
    expect(t.workflow.operations[0].input).toEqual({ driveId: "{{DRIVE_ID}}", connectionId: "{{CONNECTION_ID}}", url: "{{SWITCHBOARD_ORIGIN}}/api/x" });
    expect(t.connection.operations[1].input).toEqual({ props: { baseUrl: "{{SWITCHBOARD_ORIGIN}}", apiKey: { secretId: "{{SECRET_ID}}" } } });
  });
  it("skips failed operations and keeps order", () => {
    const t = templatize({ workflow: [{ type: "A", input: {}, error: "rejected" }, { type: "B", input: {} }], connection: [] }, { driveId: "d", connectionId: "c", secretId: "s", switchboardOrigin: "http://x" });
    expect(t.workflow.operations.map((o) => o.type)).toEqual(["B"]);
  });
});
```
- [ ] **Step 2: Run** `bun run vitest run scripts/lib/workflow-template.test.mjs` → FAIL.
- [ ] **Step 3: Implement**
```js
// scripts/lib/workflow-template.mjs
const PLACEHOLDERS = ["{{DRIVE_ID}}", "{{CONNECTION_ID}}", "{{SECRET_ID}}", "{{SWITCHBOARD_ORIGIN}}", "{{VAULT_NAME}}"];
function substitute(value, pairs) {
  let text = JSON.stringify(value);
  for (const [concrete, placeholder] of pairs) text = text.split(concrete).join(placeholder);
  return JSON.parse(text);
}
export function templatize(docs, ids) {
  // Longest first so an origin containing a port is replaced before any shorter id could match inside it.
  const pairs = [[ids.switchboardOrigin, "{{SWITCHBOARD_ORIGIN}}"], [ids.driveId, "{{DRIVE_ID}}"], [ids.connectionId, "{{CONNECTION_ID}}"], [ids.secretId, "{{SECRET_ID}}"]]
    .filter(([c]) => typeof c === "string" && c.length > 0)
    .sort((a, b) => b[0].length - a[0].length);
  const clean = (ops) => ops.filter((o) => !o.error).map((o) => ({ type: o.type, input: substitute(o.input, pairs) }));
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    placeholders: PLACEHOLDERS,
    connection: { documentType: "powerhouse/connection", operations: clean(docs.connection) },
    workflow: { documentType: "powerhouse/workflow", operations: clean(docs.workflow) },
  };
}
```
```js
// scripts/export-workflow-template.mjs
// usage: node scripts/export-workflow-template.mjs --url http://localhost:4001/graphql --workflow <id> --connection <id> --drive <vaultDriveId> --secret <secretId> --out pieces/knowledge-vault/templates/pipeline.json
import { writeFileSync } from "node:fs";
import { templatize } from "./lib/workflow-template.mjs";
import { bearer } from "./lib/bearer.mjs"; // the repo's existing helper: token from SWITCHBOARD_TOKEN or the CLI profile
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const url = arg("url", "http://localhost:4001/graphql");
const ids = { driveId: arg("drive"), connectionId: arg("connection"), secretId: arg("secret", ""), switchboardOrigin: new URL(url).origin };
async function operations(id) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(await bearer()) }, body: JSON.stringify({
    query: `query($id: String!) { document(idOrSlug: $id) { document { documentType operations(filter: { scopes: ["global"] }, paging: { limit: 1000 }) { items { type inputText index error } } } } }`, variables: { id } }) });
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  const doc = json.data.document.document;
  return { documentType: doc.documentType, ops: doc.operations.items.sort((a, b) => a.index - b.index).map((o) => ({ type: o.type, input: JSON.parse(o.inputText ?? "{}"), error: o.error })) };
}
const [wf, conn] = await Promise.all([operations(arg("workflow")), operations(arg("connection"))]);
if (wf.documentType !== "powerhouse/workflow" || conn.documentType !== "powerhouse/connection") throw new Error(`unexpected types ${wf.documentType} / ${conn.documentType}`);
const template = templatize({ workflow: wf.ops, connection: conn.ops }, ids);
writeFileSync(arg("out", "pieces/knowledge-vault/templates/pipeline.json"), JSON.stringify(template, null, 2) + "\n");
console.log(`template: ${template.workflow.operations.length} workflow ops, ${template.connection.operations.length} connection ops`);
```
If the `operations` field does not accept `paging` on this stack, run the query once with `--url` against your Vetra and adjust to the shape its error names (the CLI's `docs get --operations` uses the same field; copy its argument list). Export: `node scripts/export-workflow-template.mjs --url http://localhost:4001/graphql --workflow <your 'Vault pipeline (auto)' id> --connection <its connection id> --drive <your vault drive id> --secret <the secret id the connection references>`; read the result and confirm no `localhost:4001`, no ids, and that the last workflow operations include `PUBLISH_WORKFLOW` and `SET_WORKFLOW_STATUS` with `ENABLED`. `templates/README.md` documents the command and the placeholders. `package.json`: add `"./pieces/knowledge-vault/templates/*": "./dist/node/pieces/knowledge-vault/templates/*"`; `copy-runtime-assets.mjs`: `cpSync("pieces/knowledge-vault/templates", join(distRoot, "node", "pieces", "knowledge-vault", "templates"), { recursive: true })`.
- [ ] **Step 4: Run** tests, `bun run build`, `node -e 'console.log(require("./dist/node/pieces/knowledge-vault/templates/pipeline.json").workflow.operations.length)'`.
- [ ] **Step 5: Commit** `feat(pieces): ship the vault pipeline as a replayable template`.

---

## Part B — desktop repository

### Task 2: Sidecar — template instantiation by operation replay

**Files:**
- Create: `sidecar/src/templates.ts`, `sidecar/src/templates.test.ts`, `sidecar/src/reactor-gql.ts` (shared GraphQL helper: `gql()`, `createDocument(origin, modelNamespace, name, parentId)`, `execute(origin, documentId, actions)`, `deleteDocument(origin, id)`), `sidecar/src/reactor-gql.test.ts`

**Interfaces:**
- Produces: `instantiatePipeline(opts: { origin: string; template: PipelineTemplate; vaultName: string; driveId: string; workflowsDriveId: string; secretId: string; fetchImpl?: typeof fetch }): Promise<{ workflowId: string; connectionId: string }>`; `fillPlaceholders(input: unknown, values: Record<Placeholder, string>): unknown` (throws `Unknown placeholder {{X}}` when a `{{…}}` survives); `toActions(ops: Op[]): ActionInput[]` (`id: randomUUID()`, `timestampUtcMs: new Date().toISOString()`, `scope: "global"`).

- [ ] **Step 1: Failing tests**
```ts
// sidecar/src/templates.test.ts
import { describe, expect, it, vi } from "vitest";
import { fillPlaceholders, instantiatePipeline, type PipelineTemplate } from "./templates.js";
const template: PipelineTemplate = { version: 1, exportedAt: "x", placeholders: ["{{DRIVE_ID}}", "{{CONNECTION_ID}}", "{{SECRET_ID}}", "{{SWITCHBOARD_ORIGIN}}", "{{VAULT_NAME}}"],
  connection: { documentType: "powerhouse/connection", operations: [{ type: "SET_CONNECTION_NAME", input: { name: "{{VAULT_NAME}}" } }, { type: "SET_PROPS", input: { props: { baseUrl: "{{SWITCHBOARD_ORIGIN}}", apiKey: { secretId: "{{SECRET_ID}}" } } } }] },
  workflow: { documentType: "powerhouse/workflow", operations: [{ type: "SET_TRIGGER", input: { driveId: "{{DRIVE_ID}}", connectionId: "{{CONNECTION_ID}}" } }, { type: "PUBLISH_WORKFLOW", input: {} }, { type: "SET_WORKFLOW_STATUS", input: { status: "ENABLED" } }] } };
function fakeReactor() {
  const calls: Array<{ query: string; variables: Record<string, unknown> }> = [];
  let n = 0;
  const fetchImpl = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
    calls.push(body);
    if (body.query.includes("createDocument")) return { ok: true, json: async () => ({ data: { X: { createDocument: { id: `doc${++n}` } } } }) };
    if (body.query.includes("execute(")) return { ok: true, json: async () => ({ data: { execute: { id: body.variables.id, operations: (body.variables.actions as unknown[]).map(() => ({ error: null })) } } }) };
    if (body.query.includes("deleteDocument")) return { ok: true, json: async () => ({ data: { deleteDocument: true } }) };
    throw new Error(body.query);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}
describe("fillPlaceholders", () => {
  it("fills every placeholder and refuses an unknown one", () => {
    expect(fillPlaceholders({ a: "{{DRIVE_ID}}/x", b: ["{{SECRET_ID}}"] }, { "{{DRIVE_ID}}": "d", "{{CONNECTION_ID}}": "c", "{{SECRET_ID}}": "s", "{{SWITCHBOARD_ORIGIN}}": "o", "{{VAULT_NAME}}": "v" })).toEqual({ a: "d/x", b: ["s"] });
    expect(() => fillPlaceholders({ a: "{{NEW_THING}}" }, { "{{DRIVE_ID}}": "d", "{{CONNECTION_ID}}": "c", "{{SECRET_ID}}": "s", "{{SWITCHBOARD_ORIGIN}}": "o", "{{VAULT_NAME}}": "v" })).toThrow("Unknown placeholder {{NEW_THING}}");
  });
});
describe("instantiatePipeline", () => {
  it("creates the connection then the workflow in the Workflows drive and replays with substitutions", async () => {
    const { fetchImpl, calls } = fakeReactor();
    const r = await instantiatePipeline({ origin: "http://127.0.0.1:4201", template, vaultName: "Research", driveId: "vault1", workflowsDriveId: "wfdrive", secretId: "sec9", fetchImpl });
    expect(r).toEqual({ connectionId: "doc1", workflowId: "doc2" });
    const creates = calls.filter((c) => c.query.includes("createDocument"));
    expect(creates[0]!.query).toContain("Connection {"); expect(creates[0]!.variables).toEqual({ name: "Research — Knowledge Vault", parent: "wfdrive" });
    expect(creates[1]!.query).toContain("Workflow {"); expect(creates[1]!.variables).toEqual({ name: "Research — Vault pipeline", parent: "wfdrive" });
    const executes = calls.filter((c) => c.query.includes("execute("));
    const connActions = executes[0]!.variables.actions as Array<{ type: string; input: unknown; scope: string }>;
    expect(connActions[1]!.input).toEqual({ props: { baseUrl: "http://127.0.0.1:4201", apiKey: { secretId: "sec9" } } });
    const wfActions = executes[1]!.variables.actions as Array<{ type: string; input: unknown }>;
    expect(wfActions[0]!.input).toEqual({ driveId: "vault1", connectionId: "doc1" });
    expect(wfActions.map((a) => a.type)).toEqual(["SET_TRIGGER", "PUBLISH_WORKFLOW", "SET_WORKFLOW_STATUS"]);
  });
  it("deletes what it created when a replayed operation is rejected", async () => {
    const { fetchImpl, calls } = fakeReactor();
    (fetchImpl as unknown as { mockImplementationOnce: (f: unknown) => void });
    const failing = vi.fn(async (u: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
      if (body.query.includes("execute(") && body.query.length > 0 && (body.variables.actions as Array<{ type: string }>).some((a) => a.type === "PUBLISH_WORKFLOW"))
        return { ok: true, json: async () => ({ data: { execute: { id: body.variables.id, operations: [{ error: null }, { error: "Workflow has no steps" }, { error: null }] } } }) };
      return (fetchImpl as unknown as (u: RequestInfo | URL, i?: RequestInit) => Promise<Response>)(u, init);
    }) as unknown as typeof fetch;
    await expect(instantiatePipeline({ origin: "http://127.0.0.1:4201", template, vaultName: "R", driveId: "v", workflowsDriveId: "w", secretId: "s", fetchImpl: failing })).rejects.toThrow(/PUBLISH_WORKFLOW.*Workflow has no steps/);
    expect(calls.filter((c) => c.query.includes("deleteDocument")).length).toBe(2);
  });
});
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**
```ts
// sidecar/src/reactor-gql.ts
import { randomUUID } from "node:crypto";
export type ActionInput = { id: string; type: string; timestampUtcMs: string; input: unknown; scope: "global" };
export async function gql<T>(origin: string, query: string, variables: Record<string, unknown>, fetchImpl: typeof fetch): Promise<T> {
  const res = await fetchImpl(`${origin}/graphql`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, variables }) });
  if (!res.ok) throw new Error(`Switchboard answered HTTP ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  if (!json.data) throw new Error("Switchboard answered without data");
  return json.data;
}
const NAMESPACES: Record<string, string> = { "powerhouse/workflow": "Workflow", "powerhouse/connection": "Connection" };
export async function createDocument(origin: string, documentType: string, name: string, parentId: string, fetchImpl: typeof fetch): Promise<string> {
  const ns = NAMESPACES[documentType];
  if (!ns) throw new Error(`No GraphQL namespace known for ${documentType}`);
  const data = await gql<Record<string, { createDocument: { id: string } }>>(origin, `mutation($name: String!, $parent: String) { ${ns} { createDocument(name: $name, parentIdOrSlug: $parent) { id } } }`, { name, parent: parentId }, fetchImpl);
  return data[ns]!.createDocument.id;
}
export function toActions(ops: Array<{ type: string; input: unknown }>): ActionInput[] {
  return ops.map((o) => ({ id: randomUUID(), type: o.type, timestampUtcMs: new Date().toISOString(), input: o.input, scope: "global" }));
}
export async function execute(origin: string, documentId: string, actions: ActionInput[], fetchImpl: typeof fetch): Promise<void> {
  const data = await gql<{ execute: { id: string; operations?: Array<{ error: string | null }> } }>(origin, `mutation($id: String!, $actions: [ActionInput!]!) { execute(documentIdOrSlug: $id, actions: $actions, branch: "main") { id operations { error } } }`, { id: documentId, actions }, fetchImpl);
  const rejected = (data.execute.operations ?? []).map((op, i) => ({ op, action: actions[i] })).find(({ op }) => op.error);
  if (rejected) throw new Error(`Operation ${rejected.action?.type} was rejected: ${rejected.op.error}`);
}
export async function deleteDocument(origin: string, id: string, fetchImpl: typeof fetch): Promise<void> {
  await gql(origin, `mutation($id: String!) { deleteDocument(idOrSlug: $id) }`, { id }, fetchImpl);
}
```
If `execute` does not return `operations { error }` on this stack (the plugin's post-apply hook reads them through `document.operations` instead), read them back with `document(idOrSlug) { document { operations(filter: { scopes: ["global"] }) { items { index error type } } } }` for indexes ≥ the count before the replay — one extra query, same contract.
```ts
// sidecar/src/templates.ts
import { createDocument, deleteDocument, execute, toActions } from "./reactor-gql.js";
export type Op = { type: string; input: unknown };
export type Placeholder = "{{DRIVE_ID}}" | "{{CONNECTION_ID}}" | "{{SECRET_ID}}" | "{{SWITCHBOARD_ORIGIN}}" | "{{VAULT_NAME}}";
export type PipelineTemplate = { version: 1; exportedAt: string; placeholders: Placeholder[]; connection: { documentType: "powerhouse/connection"; operations: Op[] }; workflow: { documentType: "powerhouse/workflow"; operations: Op[] } };

export function fillPlaceholders(input: unknown, values: Record<Placeholder, string>): unknown {
  let text = JSON.stringify(input);
  for (const [ph, v] of Object.entries(values)) text = text.split(ph).join(v.replace(/\\/g, "\\\\").replace(/"/g, '\\"'));
  const left = text.match(/\{\{[A-Z_]+\}\}/);
  if (left) throw new Error(`Unknown placeholder ${left[0]}`);
  return JSON.parse(text);
}

export async function instantiatePipeline(opts: { origin: string; template: PipelineTemplate; vaultName: string; driveId: string; workflowsDriveId: string; secretId: string; fetchImpl?: typeof fetch }): Promise<{ workflowId: string; connectionId: string }> {
  const f = opts.fetchImpl ?? fetch;
  const created: string[] = [];
  try {
    const connectionId = await createDocument(opts.origin, "powerhouse/connection", `${opts.vaultName} — Knowledge Vault`, opts.workflowsDriveId, f);
    created.push(connectionId);
    const values: Record<Placeholder, string> = { "{{DRIVE_ID}}": opts.driveId, "{{CONNECTION_ID}}": connectionId, "{{SECRET_ID}}": opts.secretId, "{{SWITCHBOARD_ORIGIN}}": opts.origin, "{{VAULT_NAME}}": opts.vaultName };
    await execute(opts.origin, connectionId, toActions(opts.template.connection.operations.map((o) => ({ type: o.type, input: fillPlaceholders(o.input, values) }))), f);
    const workflowId = await createDocument(opts.origin, "powerhouse/workflow", `${opts.vaultName} — Vault pipeline`, opts.workflowsDriveId, f);
    created.push(workflowId);
    await execute(opts.origin, workflowId, toActions(opts.template.workflow.operations.map((o) => ({ type: o.type, input: fillPlaceholders(o.input, values) }))), f);
    return { workflowId, connectionId };
  } catch (error) {
    for (const id of created) await deleteDocument(opts.origin, id, f).catch(() => undefined);
    throw error;
  }
}
```
- [ ] **Step 4: Run** `bun run vitest run sidecar/src` → PASS. **Step 5: Commit** `feat(sidecar): instantiate the pipeline template by operation replay`.

### Task 3: Sidecar — models, secrets, Workflows drive, per-vault pipeline records

**Files:**
- Create: `sidecar/src/models.ts` (`normalizeEndpoint`, `ModelsStore` in `secrets/models.json`), `sidecar/src/models.test.ts`, `sidecar/src/pipelines.ts` (records `<dataDir>/pipelines.json`: `{ [vaultId]: { workflowId, connectionId, createdAt } }`), `sidecar/src/workflows-drive.ts` (`ensureWorkflowsDrive(origin)` — find a drive whose `/d/<id>` meta.preferredEditor is `workflow-studio`, else create via the CLI's two mutations with `preferredEditor: "workflow-studio"`, name "Workflows")
- Modify: `sidecar/src/control.ts` (routes), `sidecar/src/main.ts` (ensure Workflows drive at boot; load the template via `createRequire(import.meta.url)("@powerhousedao/knowledge-note/pieces/knowledge-vault/templates/pipeline.json")`)

**Interfaces:**
- Control routes: `GET /models` → `{ configured: boolean; endpoint?: string; model?: string }`; `PUT /models { endpoint, model, apiKey }` → stores the key with `mutation { createSecret(value: $v, label: "Knowledge Vault model key") { id } }`, writes `models.json { endpoint, model, secretId }`, re-instantiates nothing (existing pipelines keep their connection; `POST /vaults/:id/pipeline` recreates); `POST /vaults` now returns `{ vault, pipeline: "ready" | "unconfigured" }`; `POST /vaults/:id/pipeline` → instantiates (409 when models unconfigured); `GET /vaults/:id/pipeline` → `{ state: "unconfigured" | "ready", workflowId?, trigger?: { status, lastPollAt, lastError }, lastRun?: { id, status, enqueuedAt } }` from `triggerStates` and `runsPage(workflowId:, paging: { limit: 1 })`.
- `normalizeEndpoint("https://openrouter.ai/api/v1/chat/completions") === "https://openrouter.ai/api/v1"`; `normalizeEndpoint("http://localhost:11434/v1/") === "http://localhost:11434/v1"`; a value without `/v1` is kept as given (some servers mount at the root).

- [ ] **Step 1: Failing tests** — `models.test.ts` (normalisation cases above; store round-trip with mode 0600; `PUT` without a key → 400 "A model key is required."); control tests: `POST /vaults` with no models → `pipeline: "unconfigured"` and no `createDocument` call; `GET /vaults/:id/pipeline` for two vaults filters `triggerStates` by each vault's recorded workflow id.
- [ ] **Step 2: Implement** (`models.ts`):
```ts
export function normalizeEndpoint(raw: string): string {
  const u = new URL(raw.trim());
  u.search = ""; u.hash = "";
  u.pathname = u.pathname.replace(/\/(chat\/completions|completions|models)\/?$/, "").replace(/\/+$/, "");
  return u.toString().replace(/\/$/, "");
}
```
and the store (`readModels(dir)`, `writeModels(dir, { endpoint, model, secretId })` with `writeFileSync(..., { mode: 0o600 })`). `GET /vaults/:id/pipeline` runs one GraphQL query: `query($w: String!) { triggerStates { workflowId status lastPollAt lastError } runsPage(workflowId: $w, paging: { limit: 1 }) { items { id status enqueuedAt } } }` — before wiring, confirm the run item's field names once with `{ __type(name: "WorkflowRun") { fields { name } } }` against the running sidecar and use exactly those (`status`, `enqueuedAt` are the expected names from the runtime's rows `status`, `enqueued_at`).
- [ ] **Step 3: Run** tests; by hand: `PUT /models` with your OpenRouter key, create a vault → `pipeline: "ready"`; `GET /vaults/<id>/pipeline` shows the trigger `ENABLED`; in the vault app queue a pasted source → within a minute `runsPage` shows a run and notes appear. **Step 4: Commit** `feat(sidecar): models settings, secret storage, Workflows drive, per-vault pipelines`.

### Task 4: Host — Models settings, processing banner, Workflow Studio, pipeline badge

**Files:**
- Create: `host/src/settings/Models.tsx`, `host/src/api/models.ts` (+ test), `host/src/components/ProcessingBanner.tsx`, `host/src/components/PipelineBadge.tsx`
- Modify: `host/src/screens/Settings.tsx` (Models + Workflows tabs), `host/src/screens/VaultScreen.tsx` (banner when `pipeline === "unconfigured"`; badge from `GET /vaults/:id/pipeline` every 30 s while visible), `host/src/App.tsx` (route `settings/workflows` renders `VaultScreen` for the Workflows drive id from `GET /workflows-drive`)

- [ ] **Step 1: Tests** — `models.test.ts` (host): the form submits `{ endpoint, model, apiKey }` once and never stores the key locally (`localStorage` untouched); `ProcessingBanner` renders "Set up a model to process sources automatically" with a link to Settings › Models; `PipelineBadge` maps `{ trigger.status: "ENABLED", lastRun.status: "FAILED" }` to "Processing: last run failed" with a link to the run in Workflow Studio.
- [ ] **Step 2: Implement** per spec §5.2 (Models: one endpoint field with the normalised preview, model name, key with "Validate" = `POST /models/validate` which the sidecar answers by a one-token request to `<endpoint>/chat/completions` — add that route; local-only switch comes in Phase 4), Workflows tab = the Workflow Studio app full-window via the existing `VaultScreen`.
- [ ] **Step 3: Run** all gates; by hand: Settings › Workflows shows Workflow Studio with the "Research — Vault pipeline" workflow and its runs. **Step 4: Commit** `feat(host): model settings, processing banner, pipeline badge, Workflow Studio in Settings`.

### Task 5: e2e — the plumbing without a real model
- [ ] `e2e/pipeline.spec.ts`: start the dev loop; `PUT /models` with endpoint `http://127.0.0.1:<fake>/v1` served by a tiny Node server in the test that answers `/chat/completions` with HTTP 500 `{ "error": "no model here" }`; create a vault → `GET /vaults/:id/pipeline` is `ready` with trigger `ENABLED`; in the UI paste a source and queue it; within 90 s `runsPage` shows a run with status `FAILED` and the Pipeline badge says "Processing: last run failed". This proves template instantiation, trigger, run recording and the badge, honestly, without emulating the model. Commit `test(e2e): pipeline instantiation and run surfacing`.

## Done when
A vault created after Models are set has an enabled pipeline; queuing a source produces notes with a real key; Workflow Studio is reachable from Settings; the template ships with the package; all gates green.
