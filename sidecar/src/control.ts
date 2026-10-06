import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { VaultSummary } from "./vaults.js";

export type StatusPayload = { ok: true; port: number; controlPort: number; appVersion: string; protected: boolean };
export type ControlDeps = {
  token: string;
  hostOrigin: string;
  status: () => StatusPayload;
  listVaults: () => Promise<VaultSummary[]>;
  createVault: (name: string) => Promise<VaultSummary>;
};

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
        res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
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
      return send(res, 404, { error: "Not found" }, allowed);
    } catch (error) {
      if (error instanceof BadRequestError) return send(res, 400, { error: error.message }, allowed);
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
