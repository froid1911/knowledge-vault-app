import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AppSettings, SettingsPatch } from "./settings.js";
import { NotAVaultError, type DriveRef, type VaultSummary } from "./vaults.js";

export type StatusPayload = {
  ok: true;
  port: number;
  controlPort: number;
  appVersion: string;
  protected: boolean;
  /** For Diagnostics and About (spec §5.2). */
  dataDir: string;
  stackVersion: string;
  vaultPackageVersion: string;
};
export type ControlDeps = {
  token: string;
  hostOrigin: string;
  status: () => StatusPayload;
  listVaults: () => Promise<VaultSummary[]>;
  createVault: (name: string) => Promise<VaultSummary>;
  renameVault: (id: string, name: string) => Promise<DriveRef>;
  deleteVault: (id: string) => Promise<void>;
  workflowsDrive: () => Promise<DriveRef>;
  readSettings: () => AppSettings;
  writeSettings: (patch: SettingsPatch) => AppSettings;
};

function settingsPatch(body: Record<string, unknown>): SettingsPatch {
  const models = body.models;
  if (models === undefined) return {};
  if (!models || typeof models !== "object" || Array.isArray(models)) throw new BadRequestError("`models` must be an object.");
  const m = models as Record<string, unknown>;
  const patch: NonNullable<SettingsPatch["models"]> = {};
  if (m.endpoint !== undefined) {
    if (typeof m.endpoint !== "string") throw new BadRequestError("`models.endpoint` must be a string.");
    patch.endpoint = m.endpoint;
  }
  if (m.model !== undefined) {
    if (typeof m.model !== "string") throw new BadRequestError("`models.model` must be a string.");
    patch.model = m.model;
  }
  if (m.apiKey !== undefined) {
    if (m.apiKey !== null && typeof m.apiKey !== "string") throw new BadRequestError("`models.apiKey` must be a string or null.");
    patch.apiKey = m.apiKey;
  }
  return { models: patch };
}

class BadRequestError extends Error {}

function send(res: ServerResponse, status: number, body: unknown, origin?: string): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  if (origin) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "Origin");
  }
  res.end(JSON.stringify(body));
}

/** Same length, then a constant-time compare — a wrong token must not be measurably "closer" than another. */
function tokenMatches(header: string | undefined, token: string): boolean {
  const expected = Buffer.from(`Bearer ${token}`);
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new BadRequestError("The request body is not valid JSON.");
  }
}

export function createControlServer(deps: ControlDeps) {
  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    const allowed = origin === deps.hostOrigin ? origin : undefined;
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      if (allowed) {
        res.setHeader("access-control-allow-origin", allowed);
        res.setHeader("vary", "Origin");
        res.setHeader("access-control-allow-methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
        res.setHeader("access-control-allow-headers", "authorization,content-type");
      }
      res.end();
      return;
    }
    if (!tokenMatches(req.headers.authorization, deps.token)) return send(res, 401, { error: "Unauthorized" }, allowed);
    const url = new URL(req.url ?? "/", "http://control");
    try {
      if (req.method === "GET" && url.pathname === "/status") return send(res, 200, deps.status(), allowed);
      if (req.method === "GET" && url.pathname === "/vaults") return send(res, 200, { vaults: await deps.listVaults() }, allowed);
      if (req.method === "POST" && url.pathname === "/vaults") {
        const body = await readJson(req);
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (!name) return send(res, 400, { error: "A vault needs a name." }, allowed);
        return send(res, 201, { vault: await deps.createVault(name) }, allowed);
      }
      const vault = url.pathname.match(/^\/vaults\/([^/]+)$/);
      if (vault && req.method === "PATCH") {
        const body = await readJson(req);
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (!name) return send(res, 400, { error: "A vault needs a name." }, allowed);
        return send(res, 200, { vault: await deps.renameVault(decodeURIComponent(vault[1]!), name) }, allowed);
      }
      if (vault && req.method === "DELETE") {
        const id = decodeURIComponent(vault[1]!);
        await deps.deleteVault(id);
        return send(res, 200, { deleted: id }, allowed);
      }
      if (req.method === "GET" && url.pathname === "/workflows") return send(res, 200, { drive: await deps.workflowsDrive() }, allowed);
      if (req.method === "GET" && url.pathname === "/settings") return send(res, 200, deps.readSettings(), allowed);
      if (req.method === "PUT" && url.pathname === "/settings") return send(res, 200, deps.writeSettings(settingsPatch(await readJson(req))), allowed);
      return send(res, 404, { error: "Not found" }, allowed);
    } catch (error) {
      if (error instanceof BadRequestError) return send(res, 400, { error: error.message }, allowed);
      if (error instanceof NotAVaultError) return send(res, 404, { error: error.message }, allowed);
      return send(res, 500, { error: error instanceof Error ? error.message : String(error) }, allowed);
    }
  });
  return {
    /** Bind on loopback; `port` 0 picks a free one. Resolves the bound port. */
    listen(port = 0): Promise<number> {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          const addr = server.address();
          resolve(typeof addr === "object" && addr ? addr.port : port);
        });
      });
    },
    close(): Promise<void> {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
