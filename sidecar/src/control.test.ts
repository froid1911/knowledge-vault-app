import { afterEach, describe, expect, it } from "vitest";
import { createControlServer } from "./control.js";
import type { AppSettings } from "./settings.js";
import { NotAVaultError, type VaultSummary } from "./vaults.js";

const vaults: VaultSummary[] = [{ id: "v1", slug: "research", name: "Research", noteCount: 2 }];
let close: (() => Promise<void>) | undefined;
let deleted: string[] = [];
let settings: AppSettings = { version: 1, models: { endpoint: "https://openrouter.ai/api/v1", model: "", hasKey: false } };
afterEach(async () => { await close?.(); close = undefined; deleted = []; settings = { version: 1, models: { endpoint: "https://openrouter.ai/api/v1", model: "", hasKey: false } }; });

async function start() {
  const server = createControlServer({
    token: "secret",
    hostOrigin: "http://127.0.0.1:4200",
    status: () => ({ ok: true, port: 4201, controlPort: 0, appVersion: "0.1.0", protected: false, dataDir: "/data/vault", stackVersion: "6.2.3-dev.44", vaultPackageVersion: "1.0.54-dev.22" }),
    listVaults: async () => vaults,
    createVault: async (name) => ({ id: "v2", slug: "n", name, noteCount: 0 }),
    renameVault: async (id, name) => { if (id !== "v1") throw new NotAVaultError("That drive is not a vault."); return { id, slug: "research", name }; },
    deleteVault: async (id) => { if (id !== "v1") throw new NotAVaultError("That drive is not a vault."); deleted.push(id); },
    workflowsDrive: async () => ({ id: "w1", slug: "workflows", name: "Workflows" }),
    readSettings: () => settings,
    writeSettings: (patch) => { settings = { ...settings, models: { ...settings.models, ...(patch.models?.endpoint ? { endpoint: patch.models.endpoint } : {}), ...(patch.models?.model !== undefined ? { model: patch.models.model } : {}), ...(patch.models?.apiKey !== undefined ? { hasKey: !!patch.models.apiKey } : {}) } }; return settings; },
  });
  const port = await server.listen();
  close = server.close;
  return `http://127.0.0.1:${port}`;
}

describe("control API", () => {
  it("rejects a missing or wrong token", async () => {
    const base = await start();
    expect((await fetch(`${base}/status`)).status).toBe(401);
    expect((await fetch(`${base}/status`, { headers: { authorization: "Bearer nope" } })).status).toBe(401);
  });
  it("answers status, lists and creates vaults with the token", async () => {
    const base = await start();
    const h = { authorization: "Bearer secret", "content-type": "application/json" };
    expect(await (await fetch(`${base}/status`, { headers: h })).json()).toMatchObject({ ok: true, port: 4201 });
    expect(await (await fetch(`${base}/vaults`, { headers: h })).json()).toEqual({ vaults });
    const created = await fetch(`${base}/vaults`, { method: "POST", headers: h, body: JSON.stringify({ name: "New" }) });
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ vault: { id: "v2", slug: "n", name: "New", noteCount: 0 } });
  });
  it("rejects a vault without a name", async () => {
    const base = await start();
    const res = await fetch(`${base}/vaults`, { method: "POST", headers: { authorization: "Bearer secret", "content-type": "application/json" }, body: JSON.stringify({ name: "  " }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "A vault needs a name." });
  });
  it("rejects a wrong token of the right length too (constant-time compare, same answer)", async () => {
    const base = await start();
    expect((await fetch(`${base}/status`, { headers: { authorization: "Bearer secreT" } })).status).toBe(401);
  });
  it("answers a malformed JSON body with 400, not 500", async () => {
    const base = await start();
    const res = await fetch(`${base}/vaults`, { method: "POST", headers: { authorization: "Bearer secret", "content-type": "application/json" }, body: "{ not json" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/JSON/);
  });
  it("marks CORS answers as varying by origin", async () => {
    const base = await start();
    const res = await fetch(`${base}/status`, { headers: { authorization: "Bearer secret", origin: "http://127.0.0.1:4200" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:4200");
    expect(res.headers.get("vary")).toBe("Origin");
  });
  it("answers CORS preflight for the host origin only", async () => {
    const base = await start();
    const ok = await fetch(`${base}/vaults`, { method: "OPTIONS", headers: { origin: "http://127.0.0.1:4200", "access-control-request-method": "POST" } });
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:4200");
    const other = await fetch(`${base}/vaults`, { method: "OPTIONS", headers: { origin: "http://evil.example" } });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("renames and deletes a vault, and answers 404 for a drive that is not a vault", async () => {
    const base = await start();
    const h = { authorization: "Bearer secret", "content-type": "application/json" };
    const renamed = await fetch(`${base}/vaults/v1`, { method: "PATCH", headers: h, body: JSON.stringify({ name: "  Lab notes " }) });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toEqual({ vault: { id: "v1", slug: "research", name: "Lab notes" } });
    expect((await fetch(`${base}/vaults/v1`, { method: "PATCH", headers: h, body: JSON.stringify({ name: " " }) })).status).toBe(400);
    const gone = await fetch(`${base}/vaults/v1`, { method: "DELETE", headers: h });
    expect(gone.status).toBe(200);
    expect(await gone.json()).toEqual({ deleted: "v1" });
    expect(deleted).toEqual(["v1"]);
    const refused = await fetch(`${base}/vaults/w1`, { method: "DELETE", headers: h });
    expect(refused.status).toBe(404);
    expect(await refused.json()).toEqual({ error: "That drive is not a vault." });
  });
  it("hands out the Workflows drive and reads and writes settings without ever returning a key", async () => {
    const base = await start();
    const h = { authorization: "Bearer secret", "content-type": "application/json" };
    expect(await (await fetch(`${base}/workflows`, { headers: h })).json()).toEqual({ drive: { id: "w1", slug: "workflows", name: "Workflows" } });
    expect(await (await fetch(`${base}/settings`, { headers: h })).json()).toMatchObject({ version: 1, models: { hasKey: false } });
    const saved = await fetch(`${base}/settings`, { method: "PUT", headers: h, body: JSON.stringify({ models: { model: "gpt-4o-mini", apiKey: "sk-x" } }) });
    expect(saved.status).toBe(200);
    const body = (await saved.json()) as AppSettings;
    expect(body.models).toEqual({ endpoint: "https://openrouter.ai/api/v1", model: "gpt-4o-mini", hasKey: true });
    expect(JSON.stringify(body)).not.toContain("sk-x");
    expect((await fetch(`${base}/settings`, { method: "PUT", headers: h, body: JSON.stringify({ models: { apiKey: 42 } }) })).status).toBe(400);
  });
  it("allows the management methods in the CORS preflight", async () => {
    const base = await start();
    const res = await fetch(`${base}/vaults/v1`, { method: "OPTIONS", headers: { origin: "http://127.0.0.1:4200", "access-control-request-method": "DELETE" } });
    expect(res.headers.get("access-control-allow-methods")).toBe("GET,POST,PATCH,PUT,DELETE,OPTIONS");
  });
});
