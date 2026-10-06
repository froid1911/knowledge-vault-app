import type { SidecarInfo } from "./sidecar.js";
export type VaultSummary = { id: string; slug: string; name: string; noteCount: number };

async function control<T>(info: SidecarInfo, path: string, init: RequestInit, fetchImpl: typeof fetch): Promise<T> {
  const res = await fetchImpl(`${info.controlOrigin}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${info.controlToken}`,
      "content-type": "application/json",
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    },
  });
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `The engine answered HTTP ${res.status}`);
  return body;
}
export async function fetchVaults(info: SidecarInfo, fetchImpl: typeof fetch = fetch): Promise<VaultSummary[]> {
  return (await control<{ vaults: VaultSummary[] }>(info, "/vaults", { method: "GET" }, fetchImpl)).vaults;
}
export async function createVault(info: SidecarInfo, name: string, fetchImpl: typeof fetch = fetch): Promise<VaultSummary> {
  return (await control<{ vault: VaultSummary }>(info, "/vaults", { method: "POST", body: JSON.stringify({ name }) }, fetchImpl)).vault;
}
export type EngineStatus = { ok: true; port: number; controlPort: number; appVersion: string; protected: boolean };
export async function fetchStatus(info: SidecarInfo, fetchImpl: typeof fetch = fetch): Promise<EngineStatus> {
  return control<EngineStatus>(info, "/status", { method: "GET" }, fetchImpl);
}
