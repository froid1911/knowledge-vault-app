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
export type EngineStatus = { ok: true; port: number; controlPort: number; appVersion: string; protected: boolean; dataDir: string; stackVersion: string; vaultPackageVersion: string };
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
export type AppSettings = { version: 1; models: ModelSettings };
export type SettingsPatch = { models?: { endpoint?: string; model?: string; apiKey?: string | null } };
export async function fetchSettings(info: SidecarInfo, fetchImpl: typeof fetch = fetch): Promise<AppSettings> {
  return control<AppSettings>(info, "/settings", { method: "GET" }, fetchImpl);
}
export async function saveSettings(info: SidecarInfo, patch: SettingsPatch, fetchImpl: typeof fetch = fetch): Promise<AppSettings> {
  return control<AppSettings>(info, "/settings", { method: "PUT", body: JSON.stringify(patch) }, fetchImpl);
}
