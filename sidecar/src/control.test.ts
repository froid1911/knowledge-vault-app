import { afterEach, describe, expect, it } from "vitest";
import { createControlServer } from "./control.js";
import type { VaultSummary } from "./vaults.js";

const vaults: VaultSummary[] = [{ id: "v1", slug: "research", name: "Research", noteCount: 2 }];
let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; });

async function start() {
  const server = createControlServer({
    token: "secret",
    hostOrigin: "http://127.0.0.1:4200",
    status: () => ({ ok: true, port: 4201, controlPort: 0, appVersion: "0.1.0", protected: false }),
    listVaults: async () => vaults,
    createVault: async (name) => ({ id: "v2", slug: "n", name, noteCount: 0 }),
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
  it("answers CORS preflight for the host origin only", async () => {
    const base = await start();
    const ok = await fetch(`${base}/vaults`, { method: "OPTIONS", headers: { origin: "http://127.0.0.1:4200", "access-control-request-method": "POST" } });
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:4200");
    const other = await fetch(`${base}/vaults`, { method: "OPTIONS", headers: { origin: "http://evil.example" } });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });
});
