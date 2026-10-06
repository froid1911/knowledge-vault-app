import { readConfig, writeConfig } from "./settings.js";

/** A vault on a Switchboard the user has access to, reached in client mode (spec §5.5). */
export type RemoteVault = { kind: "remote"; id: string; slug: string; name: string; switchboardUrl: string; addedAt: string };
export type RemoteAccess = "write" | "read";
export type RemoteCheck = { id: string; slug: string; name: string; switchboardUrl: string; access: RemoteAccess };

export class RemoteInputError extends Error {}
export class RemoteAuthError extends Error {}
export class RemoteAccessError extends Error {}
export class RemoteNotFoundError extends Error {}

const RESERVED = new Set(["graphql", "api", "d", "mcp", "health"]);

/**
 * What a person pastes: a Switchboard URL (`https://host/graphql`), a drive URL
 * (`https://host/d/<slug>`), `https://host/<slug>`, or just the origin plus a
 * separate drive id or slug. Returns the origin and the drive when one was named.
 */
export function parseRemoteVaultInput(input: string, drive?: string): { origin: string; drive?: string } {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new RemoteInputError("Enter the vault's address as a URL, like https://switchboard.example.com/graphql.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new RemoteInputError("The address must start with https:// (or http:// for a local server).");
  const segments = url.pathname.split("/").filter(Boolean);
  let fromPath: string | undefined;
  if (segments[0] === "d" && segments[1]) fromPath = segments[1];
  else if (segments.length === 1 && !RESERVED.has(segments[0]!)) fromPath = segments[0];
  const named = drive?.trim() || fromPath;
  return { origin: url.origin, ...(named ? { drive: decodeURIComponent(named) } : {}) };
}

export function readRemoteVaults(dataDir: string): RemoteVault[] {
  const raw = readConfig(dataDir);
  const vaults = Array.isArray(raw.vaults) ? raw.vaults : [];
  return vaults.filter((v): v is RemoteVault => !!v && typeof v === "object" && (v as RemoteVault).kind === "remote" && typeof (v as RemoteVault).id === "string");
}

export function writeRemoteVaults(dataDir: string, remote: RemoteVault[]): void {
  const raw = readConfig(dataDir);
  const others = (Array.isArray(raw.vaults) ? raw.vaults : []).filter((v) => !v || typeof v !== "object" || (v as { kind?: string }).kind !== "remote");
  writeConfig(dataDir, { ...raw, vaults: [...others, ...remote] });
}

/** Ask the remote Switchboard, as the signed-in user, whether the drive exists and what it allows. */
export async function checkRemoteVault(origin: string, drive: string, token: string, fetchImpl: typeof fetch = fetch): Promise<RemoteCheck> {
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const res = await fetchImpl(`${origin}/d/${encodeURIComponent(drive)}`, { headers });
  if (res.status === 401) throw new RemoteAuthError("The server did not accept your sign-in. Sign in again and retry.");
  if (res.status === 403) throw new RemoteAccessError("You are signed in, but this server has not granted you access to that vault. Ask its administrator for READ on the drive.");
  if (res.status === 404) throw new RemoteNotFoundError("No vault with that id or slug on this server — or none you may read.");
  if (!res.ok) throw new Error(`The server answered HTTP ${res.status}.`);
  const info = (await res.json()) as { id: string; slug: string; name: string };
  let access: RemoteAccess = "read";
  try {
    const q = await fetchImpl(`${origin}/graphql`, {
      method: "POST",
      headers,
      body: JSON.stringify({ query: `query($id: String!) { canExecuteOperation(documentIdOrSlug: $id, operationType: "ADD_FILE") }`, variables: { id: info.id } }),
    });
    const json = (await q.json()) as { data?: { canExecuteOperation?: boolean } };
    if (json.data?.canExecuteOperation === true) access = "write";
  } catch {
    // read is the floor; the vault app's own gate speaks for anything more
  }
  return { id: info.id, slug: info.slug, name: info.name, switchboardUrl: origin, access };
}
