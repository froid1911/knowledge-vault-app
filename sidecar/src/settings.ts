import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Spec §5.6: `config.json` in the data dir holds settings; secrets never do. The
 * model key lives in `secrets/llm.key` (0600) and is reported only as `hasKey`.
 * Other keys in config.json (the shell's `ui`, later `vaults`) are preserved.
 */
export type ModelSettings = { endpoint: string; model: string; hasKey: boolean };
/** Where documents convert (Plan 4): the helper on this computer, another server by URL, or nowhere. */
export type ConversionMode = "local" | "remote" | "off";
export type ConversionSettings = { mode: ConversionMode; remoteUrl: string };
export const CONVERSION_MODES: readonly ConversionMode[] = ["local", "remote", "off"];
export type AppSettings = { version: 1; models: ModelSettings; conversion: ConversionSettings };
export type SettingsPatch = {
  models?: { endpoint?: string; model?: string; apiKey?: string | null };
  conversion?: { mode?: ConversionMode; remoteUrl?: string };
};

/** A rejected value (the control API answers 400). */
export class SettingsError extends Error {}

const DEFAULT_ENDPOINT = "https://openrouter.ai/api/v1";

function configPath(dataDir: string): string {
  return join(dataDir, "config.json");
}
function keyPath(dataDir: string): string {
  return join(dataDir, "secrets", "llm.key");
}

/** The whole config.json, for stores that own other keys (remote vaults); unknown keys survive every write. */
export function readConfig(dataDir: string): Record<string, unknown> {
  return readRaw(dataDir);
}
export function writeConfig(dataDir: string, raw: Record<string, unknown>): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(configPath(dataDir), JSON.stringify({ ...raw, version: 1 }, null, 2) + "\n");
}

function readRaw(dataDir: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(configPath(dataDir), "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function readModelKey(dataDir: string): string | undefined {
  try {
    const key = readFileSync(keyPath(dataDir), "utf8").trim();
    return key || undefined;
  } catch {
    return undefined;
  }
}

export function readSettings(dataDir: string): AppSettings {
  const raw = readRaw(dataDir);
  const models = (raw.models && typeof raw.models === "object" ? raw.models : {}) as Record<string, unknown>;
  const conversion = (raw.conversion && typeof raw.conversion === "object" ? raw.conversion : {}) as Record<string, unknown>;
  return {
    version: 1,
    models: {
      endpoint: typeof models.endpoint === "string" && models.endpoint ? models.endpoint : DEFAULT_ENDPOINT,
      model: typeof models.model === "string" ? models.model : "",
      hasKey: readModelKey(dataDir) !== undefined,
    },
    conversion: {
      mode: CONVERSION_MODES.includes(conversion.mode as ConversionMode) ? (conversion.mode as ConversionMode) : "local",
      remoteUrl: typeof conversion.remoteUrl === "string" ? conversion.remoteUrl : "",
    },
  };
}

export function writeSettings(dataDir: string, patch: SettingsPatch): AppSettings {
  const raw = readRaw(dataDir);
  const current = readSettings(dataDir);
  const models = { endpoint: current.models.endpoint, model: current.models.model };
  if (patch.models) {
    if (typeof patch.models.endpoint === "string") {
      const endpoint = patch.models.endpoint.trim() || DEFAULT_ENDPOINT;
      if (!/^https?:\/\//.test(endpoint)) throw new SettingsError("The model endpoint must be an http(s) URL.");
      models.endpoint = endpoint;
    }
    if (typeof patch.models.model === "string") models.model = patch.models.model.trim();
    if (patch.models.apiKey !== undefined) {
      if (patch.models.apiKey === null || patch.models.apiKey === "") {
        rmSync(keyPath(dataDir), { force: true });
      } else {
        mkdirSync(join(dataDir, "secrets"), { recursive: true, mode: 0o700 });
        writeFileSync(keyPath(dataDir), patch.models.apiKey.trim(), { mode: 0o600 });
        chmodSync(keyPath(dataDir), 0o600);
      }
    }
  }
  const conversion = { ...current.conversion };
  if (patch.conversion) {
    if (patch.conversion.mode !== undefined) {
      if (!CONVERSION_MODES.includes(patch.conversion.mode)) throw new SettingsError("The conversion mode must be local, remote or off.");
      conversion.mode = patch.conversion.mode;
    }
    if (typeof patch.conversion.remoteUrl === "string") {
      const url = patch.conversion.remoteUrl.trim().replace(/\/+$/, "");
      if (url && !/^https?:\/\//.test(url)) throw new SettingsError("The conversion server must be an http(s) URL.");
      conversion.remoteUrl = url;
    }
    if (conversion.mode === "remote" && !conversion.remoteUrl) throw new SettingsError("Another server needs its URL.");
  }
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(configPath(dataDir), JSON.stringify({ ...raw, version: 1, models, conversion }, null, 2) + "\n");
  return readSettings(dataDir);
}

/** For tests and diagnostics: whether a config file exists at all. */
export function hasConfig(dataDir: string): boolean {
  return existsSync(configPath(dataDir));
}
