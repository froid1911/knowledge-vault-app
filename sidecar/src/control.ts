import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AccessToken, IdentityStatus } from "./identity.js";
import { RemoteAccessError, RemoteAuthError, RemoteInputError, RemoteNotFoundError, type RemoteCheck, type RemoteVault } from "./remote.js";
import { ConverterBusyError, ConverterInputError, type ConverterStatus } from "./converter.js";
import { SettingsError, type AppSettings, type ConversionMode, type ConversionSettings, type SettingsPatch, type LocalProtection } from "./settings.js";
import { NotAVaultError, type DriveRef, type VaultSummary } from "./vaults.js";

export type StatusPayload = {
  ok: true;
  port: number;
  controlPort: number;
  appVersion: string;
  protected: boolean;
  /** The administrator when protected (spec §4.4). */
  adminAddress?: string | null;
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
  /** Spec §4.4: the protection switch. `set` writes config.json's `local` section and schedules the engine's restart. */
  protection: {
    get: () => LocalProtection;
    set: (wanted: boolean) => Promise<LocalProtection & { restarting?: boolean }>;
  };
  /** Plan 4: the conversion helper; a saved conversion setting is applied right after it is written. */
  converter: {
    status: () => Promise<ConverterStatus>;
    restart: () => Promise<ConverterStatus>;
    install: (component: string) => Promise<ConverterStatus>;
    remove: (component: string) => Promise<ConverterStatus>;
  };
  applyConversion: (settings: ConversionSettings) => Promise<void>;
  auth: {
    status: () => Promise<IdentityStatus>;
    startLogin: () => Promise<{ url?: string; alreadyAuthenticated: boolean }>;
    cancelLogin: () => void;
    logout: () => Promise<void>;
    token: () => Promise<AccessToken>;
  };
  remote: {
    list: () => RemoteVault[];
    check: (url: string, drive?: string) => Promise<RemoteCheck>;
    add: (url: string, drive?: string) => Promise<RemoteVault>;
    remove: (id: string) => void;
  };
};

function settingsPatch(body: Record<string, unknown>): SettingsPatch {
  const patch: SettingsPatch = {};
  const models = body.models;
  if (models !== undefined) {
    if (!models || typeof models !== "object" || Array.isArray(models)) throw new BadRequestError("`models` must be an object.");
    const m = models as Record<string, unknown>;
    const mp: NonNullable<SettingsPatch["models"]> = {};
    if (m.endpoint !== undefined) {
      if (typeof m.endpoint !== "string") throw new BadRequestError("`models.endpoint` must be a string.");
      mp.endpoint = m.endpoint;
    }
    if (m.model !== undefined) {
      if (typeof m.model !== "string") throw new BadRequestError("`models.model` must be a string.");
      mp.model = m.model;
    }
    if (m.apiKey !== undefined) {
      if (m.apiKey !== null && typeof m.apiKey !== "string") throw new BadRequestError("`models.apiKey` must be a string or null.");
      mp.apiKey = m.apiKey;
    }
    patch.models = mp;
  }
  const conversion = body.conversion;
  if (conversion !== undefined) {
    if (!conversion || typeof conversion !== "object" || Array.isArray(conversion)) throw new BadRequestError("`conversion` must be an object.");
    const c = conversion as Record<string, unknown>;
    const cp: NonNullable<SettingsPatch["conversion"]> = {};
    if (c.mode !== undefined) {
      if (typeof c.mode !== "string") throw new BadRequestError("`conversion.mode` must be a string.");
      cp.mode = c.mode as ConversionMode; // the value itself is checked where it is stored
    }
    if (c.remoteUrl !== undefined) {
      if (typeof c.remoteUrl !== "string") throw new BadRequestError("`conversion.remoteUrl` must be a string.");
      cp.remoteUrl = c.remoteUrl;
    }
    patch.conversion = cp;
  }
  return patch;
}

class BadRequestError extends Error {}

function send(res: ServerResponse, status: number, body: unknown, origin?: string): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("vary", "Origin"); // every answer depends on the origin, the refused ones included
  if (origin) res.setHeader("access-control-allow-origin", origin);
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
      if (req.method === "GET" && url.pathname === "/local/protection") return send(res, 200, deps.protection.get(), allowed);
      if (req.method === "PUT" && url.pathname === "/local/protection") {
        const body = await readJson(req);
        if (typeof body.protected !== "boolean") return send(res, 400, { error: "`protected` must be true or false." }, allowed);
        const result = await deps.protection.set(body.protected);
        return send(res, 202, { restarting: true, ...result }, allowed);
      }
      if (req.method === "GET" && url.pathname === "/settings") return send(res, 200, deps.readSettings(), allowed);
      if (req.method === "PUT" && url.pathname === "/settings") {
        const patch = settingsPatch(await readJson(req));
        const settings = deps.writeSettings(patch);
        if (patch.conversion) await deps.applyConversion(settings.conversion);
        return send(res, 200, settings, allowed);
      }
      // conversion helper (Plan 4)
      if (req.method === "GET" && url.pathname === "/converter") return send(res, 200, await deps.converter.status(), allowed);
      if (req.method === "POST" && url.pathname === "/converter/restart") return send(res, 200, await deps.converter.restart(), allowed);
      if (req.method === "POST" && (url.pathname === "/converter/install" || url.pathname === "/converter/remove")) {
        const body = await readJson(req);
        const component = typeof body.component === "string" ? body.component : "";
        if (!component) return send(res, 400, { error: "Name the component: binding or models." }, allowed);
        if (url.pathname.endsWith("/install")) return send(res, 202, await deps.converter.install(component), allowed);
        return send(res, 200, await deps.converter.remove(component), allowed);
      }
      // identity (spec §4.6 /auth/*)
      if (req.method === "GET" && url.pathname === "/auth/status") return send(res, 200, await deps.auth.status(), allowed);
      if (req.method === "POST" && url.pathname === "/auth/login") return send(res, 202, await deps.auth.startLogin(), allowed);
      if (req.method === "POST" && url.pathname === "/auth/cancel") {
        deps.auth.cancelLogin();
        return send(res, 200, { cancelled: true }, allowed);
      }
      if (req.method === "POST" && url.pathname === "/auth/logout") {
        await deps.auth.logout();
        return send(res, 200, { signedOut: true }, allowed);
      }
      if (req.method === "GET" && url.pathname === "/auth/token") {
        try {
          return send(res, 200, await deps.auth.token(), allowed);
        } catch (error) {
          // The SDK says "Not authenticated" for a missing credential; anything else is a real failure.
          const message = error instanceof Error ? error.message : String(error);
          if (/expired/i.test(message)) return send(res, 401, { error: message }, allowed);
          if (/not authenticated/i.test(message)) return send(res, 401, { error: "Not signed in." }, allowed);
          return send(res, 500, { error: `Could not mint a token: ${message}` }, allowed);
        }
      }
      // remote vaults (spec §5.5)
      if (req.method === "GET" && url.pathname === "/remote-vaults") return send(res, 200, { vaults: deps.remote.list() }, allowed);
      if (req.method === "POST" && (url.pathname === "/remote-vaults/check" || url.pathname === "/remote-vaults")) {
        const body = await readJson(req);
        const address = typeof body.url === "string" ? body.url : "";
        const drive = typeof body.drive === "string" && body.drive.trim() ? body.drive : undefined;
        if (!address) return send(res, 400, { error: "Enter the vault's address." }, allowed);
        if (url.pathname.endsWith("/check")) return send(res, 200, { vault: await deps.remote.check(address, drive) }, allowed);
        return send(res, 201, { vault: await deps.remote.add(address, drive) }, allowed);
      }
      const remote = url.pathname.match(/^\/remote-vaults\/([^/]+)$/);
      if (remote && req.method === "DELETE") {
        const id = decodeURIComponent(remote[1]!);
        deps.remote.remove(id);
        return send(res, 200, { removed: id }, allowed);
      }
      return send(res, 404, { error: "Not found" }, allowed);
    } catch (error) {
      if (error instanceof BadRequestError || error instanceof SettingsError || error instanceof ConverterInputError) return send(res, 400, { error: error.message }, allowed);
      if (error instanceof ConverterBusyError) return send(res, 409, { error: error.message }, allowed);
      if (error instanceof NotAVaultError) return send(res, 404, { error: error.message }, allowed);
      if (error instanceof RemoteInputError) return send(res, 400, { error: error.message }, allowed);
      if (error instanceof RemoteAuthError) return send(res, 401, { error: error.message }, allowed);
      if (error instanceof RemoteAccessError) return send(res, 403, { error: error.message }, allowed);
      if (error instanceof RemoteNotFoundError) return send(res, 404, { error: error.message }, allowed);
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
