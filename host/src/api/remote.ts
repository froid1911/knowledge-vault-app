import type { SidecarInfo } from "../sidecar.js";
import { control } from "../vaults.js";

export type RemoteVault = { kind: "remote"; id: string; slug: string; name: string; switchboardUrl: string; addedAt: string };
export type RemoteCheck = { id: string; slug: string; name: string; switchboardUrl: string; access: "write" | "read" };

export const fetchRemoteVaults = async (info: SidecarInfo, f: typeof fetch = fetch) => (await control<{ vaults: RemoteVault[] }>(info, "/remote-vaults", { method: "GET" }, f)).vaults;
export const checkRemoteVault = async (info: SidecarInfo, url: string, drive: string | undefined, f: typeof fetch = fetch) =>
  (await control<{ vault: RemoteCheck }>(info, "/remote-vaults/check", { method: "POST", body: JSON.stringify({ url, drive }) }, f)).vault;
export const addRemoteVault = async (info: SidecarInfo, url: string, drive: string | undefined, f: typeof fetch = fetch) =>
  (await control<{ vault: RemoteVault }>(info, "/remote-vaults", { method: "POST", body: JSON.stringify({ url, drive }) }, f)).vault;
export const removeRemoteVault = async (info: SidecarInfo, id: string, f: typeof fetch = fetch) => {
  await control<{ removed: string }>(info, `/remote-vaults/${encodeURIComponent(id)}`, { method: "DELETE" }, f);
};

/** A fetch that carries the user's bearer — for the remote's graph index behind the landing tiles. */
export function authorizedFetch(tokenProvider: () => Promise<string | undefined>, f: typeof fetch = fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const token = await tokenProvider();
    const headers = new Headers(init?.headers);
    if (token) headers.set("authorization", `Bearer ${token}`);
    return f(input, { ...init, headers });
  }) as typeof fetch;
}
