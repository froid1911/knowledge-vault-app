import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Spec §5.6: `config.json` in the data dir holds settings; secrets never do. The
 * model key lives in `secrets/llm.key` (0600) and is reported only as `hasKey`.
 * Other keys in config.json (the shell's `ui`, later `vaults`) are preserved.
 */
export type ModelSettings = { endpoint: string; model: string; hasKey: boolean };
export type AppSettings = { version: 1; models: ModelSettings };
export type SettingsPatch = { models?: { endpoint?: string; model?: string; apiKey?: string | null } };

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
  return {
    version: 1,
    models: {
      endpoint: typeof models.endpoint === "string" && models.endpoint ? models.endpoint : DEFAULT_ENDPOINT,
      model: typeof models.model === "string" ? models.model : "",
      hasKey: readModelKey(dataDir) !== undefined,
    },
  };
}

export function writeSettings(dataDir: string, patch: SettingsPatch): AppSettings {
  const raw = readRaw(dataDir);
  const current = readSettings(dataDir);
  const models = { endpoint: current.models.endpoint, model: current.models.model };
  if (patch.models) {
    if (typeof patch.models.endpoint === "string") models.endpoint = patch.models.endpoint.trim() || DEFAULT_ENDPOINT;
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
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(configPath(dataDir), JSON.stringify({ ...raw, version: 1, models }, null, 2) + "\n");
  return readSettings(dataDir);
}

/** For tests and diagnostics: whether a config file exists at all. */
export function hasConfig(dataDir: string): boolean {
  return existsSync(configPath(dataDir));
}
