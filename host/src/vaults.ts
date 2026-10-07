import type { SidecarInfo } from "./sidecar.js";
export type VaultSummary = { id: string; slug: string; name: string; noteCount: number };

export class ControlError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

export async function control<T>(info: SidecarInfo, path: string, init: RequestInit, fetchImpl: typeof fetch): Promise<T> {
  const res = await fetchImpl(`${info.controlOrigin}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${info.controlToken}`,
      "content-type": "application/json",
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    },
  });
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new ControlError(body.error ?? `The engine answered HTTP ${res.status}`, res.status);
  return body;
}
export async function fetchVaults(info: SidecarInfo, fetchImpl: typeof fetch = fetch): Promise<VaultSummary[]> {
  return (await control<{ vaults: VaultSummary[] }>(info, "/vaults", { method: "GET" }, fetchImpl)).vaults;
}
export async function createVault(info: SidecarInfo, name: string, fetchImpl: typeof fetch = fetch): Promise<VaultSummary> {
  return (await control<{ vault: VaultSummary }>(info, "/vaults", { method: "POST", body: JSON.stringify({ name }) }, fetchImpl)).vault;
}
export type EngineStatus = { ok: true; port: number; controlPort: number; appVersion: string; protected: boolean; adminAddress?: string | null; dataDir: string; stackVersion: string; vaultPackageVersion: string };
/** Spec §4.4: one switch for the local engine. */
export type LocalProtection = { protected: boolean; adminAddress: string | null };
export async function fetchProtection(info: SidecarInfo, fetchImpl: typeof fetch = fetch): Promise<LocalProtection> {
  return control<LocalProtection>(info, "/local/protection", { method: "GET" }, fetchImpl);
}
/** Asks the engine to switch; it restarts itself with the new setting (202). */
export async function setProtection(info: SidecarInfo, wanted: boolean, fetchImpl: typeof fetch = fetch): Promise<LocalProtection & { restarting: boolean }> {
  return control<LocalProtection & { restarting: boolean }>(info, "/local/protection", { method: "PUT", body: JSON.stringify({ protected: wanted }) }, fetchImpl);
}
export async function fetchStatus(info: SidecarInfo, fetchImpl: typeof fetch = fetch): Promise<EngineStatus> {
  return control<EngineStatus>(info, "/status", { method: "GET" }, fetchImpl);
}
export type DriveRef = { id: string; slug: string; name: string };
export async function renameVault(info: SidecarInfo, id: string, name: string, fetchImpl: typeof fetch = fetch): Promise<DriveRef> {
  return (await control<{ vault: DriveRef }>(info, `/vaults/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ name }) }, fetchImpl)).vault;
}
export async function deleteVault(info: SidecarInfo, id: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  await control<{ deleted: string }>(info, `/vaults/${encodeURIComponent(id)}`, { method: "DELETE" }, fetchImpl);
}
export async function fetchWorkflowsDrive(info: SidecarInfo, fetchImpl: typeof fetch = fetch): Promise<DriveRef> {
  return (await control<{ drive: DriveRef }>(info, "/workflows", { method: "GET" }, fetchImpl)).drive;
}
export type ModelSettings = { endpoint: string; model: string; hasKey: boolean };
/** Where documents convert (Plan 4): the helper on this computer, another server by URL, or nowhere. */
export type ConversionMode = "local" | "remote" | "off";
export type ConversionSettings = { mode: ConversionMode; remoteUrl: string };
export type AppSettings = { version: 1; models: ModelSettings; conversion: ConversionSettings };
export type SettingsPatch = {
  models?: { endpoint?: string; model?: string; apiKey?: string | null };
  conversion?: { mode?: ConversionMode; remoteUrl?: string };
};
export type ConverterStatus = {
  mode: ConversionMode;
  state: "off" | "starting" | "ready" | "down";
  url: string | null;
  localUrl: string | null;
  pid: number | null;
  exitCode: number | null;
  restarts: number;
  logPath: string;
  health: Record<string, unknown> | null;
  error: string | null;
  installed: {
    binding: { installed: boolean; version: string | null; supported: boolean; platform: string | null; reason: string | null };
    models: { installed: boolean; supported: boolean; reason: string | null };
  };
  job: InstallJob | null;
};
export type ConverterComponent = "binding" | "models";
export type InstallJob = {
  component: ConverterComponent;
  phase: "downloading" | "verifying" | "extracting" | "fetching" | "done" | "failed";
  percent: number | null;
  bytes: number;
  total: number | null;
  message: string;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};
export async function fetchSettings(info: SidecarInfo, fetchImpl: typeof fetch = fetch): Promise<AppSettings> {
  return control<AppSettings>(info, "/settings", { method: "GET" }, fetchImpl);
}
export async function saveSettings(info: SidecarInfo, patch: SettingsPatch, fetchImpl: typeof fetch = fetch): Promise<AppSettings> {
  return control<AppSettings>(info, "/settings", { method: "PUT", body: JSON.stringify(patch) }, fetchImpl);
}
export async function fetchConverter(info: SidecarInfo, fetchImpl: typeof fetch = fetch): Promise<ConverterStatus> {
  return control<ConverterStatus>(info, "/converter", { method: "GET" }, fetchImpl);
}
export async function restartConverter(info: SidecarInfo, fetchImpl: typeof fetch = fetch): Promise<ConverterStatus> {
  return control<ConverterStatus>(info, "/converter/restart", { method: "POST" }, fetchImpl);
}
export async function installConverterComponent(info: SidecarInfo, component: ConverterComponent, fetchImpl: typeof fetch = fetch): Promise<ConverterStatus> {
  return control<ConverterStatus>(info, "/converter/install", { method: "POST", body: JSON.stringify({ component }) }, fetchImpl);
}
export async function removeConverterComponent(info: SidecarInfo, component: ConverterComponent, fetchImpl: typeof fetch = fetch): Promise<ConverterStatus> {
  return control<ConverterStatus>(info, "/converter/remove", { method: "POST", body: JSON.stringify({ component }) }, fetchImpl);
}
