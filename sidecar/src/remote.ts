import { readConfig, writeConfig } from "./settings.js";

/** A vault on a Switchboard the user has access to, reached in client mode (spec §5.5). */
export type RemoteVault = { kind: "remote"; id: string; slug: string; name: string; switchboardUrl: string; addedAt: string };
export type RemoteAccess = "write" | "read";
export type RemoteCheck = { id: string; slug: string; name: string; switchboardUrl: string; access: RemoteAccess };

export class RemoteInputError extends Error {}
export class RemoteAuthError extends Error {}
export class RemoteAccessError extends Error {}
export class RemoteNotFoundError extends Error {}
/** The server predates the GraphQL argument names this app uses (`idOrSlug`, 6.2.3-dev.35). */
export class RemoteTooOldError extends Error {}

/**
 * Spec §9: a server older than dev.35 has no `idOrSlug` argument on `document`; the
 * vault app would fail on its first query. A server that will not answer
 * introspection cannot be told apart, so it is not refused.
 */
async function assertServerCurrent(origin: string, headers: Record<string, string>, fetchImpl: typeof fetch): Promise<void> {
  let fields: { name: string; args?: { name: string }[] }[] | undefined;
  try {
    const res = await fetchImpl(`${origin}/graphql`, { method: "POST", headers, body: JSON.stringify({ query: `{ __type(name: "Query") { fields { name args { name } } } }` }) });
    if (!res.ok) return;
    const json = (await res.json()) as { data?: { __type?: { fields?: typeof fields } | null } };
    fields = json.data?.__type?.fields ?? undefined;
  } catch {
    return;
  }
  const document = fields?.find((f) => f.name === "document");
  if (document && !(document.args ?? []).some((a) => a.name === "idOrSlug")) {
    throw new RemoteTooOldError("This vault's server is too old for this app (it needs Powerhouse 6.2.3-dev.35 or newer).");
  }
}

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
  if (!named) return { origin: url.origin };
  try {
    return { origin: url.origin, drive: decodeURIComponent(named) };
  } catch {
    throw new RemoteInputError("The drive id or slug contains characters that cannot be decoded.");
  }
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
  await assertServerCurrent(origin, headers, fetchImpl);
  const info = (await res.json()) as { id?: unknown; slug?: unknown; name?: unknown };
  if (typeof info.id !== "string" || !info.id) throw new Error("The server's answer did not name the drive.");
  const id = info.id;
  const slug = typeof info.slug === "string" && info.slug ? info.slug : id;
  const name = typeof info.name === "string" && info.name ? info.name : slug;
  let access: RemoteAccess = "read";
  try {
    const q = await fetchImpl(`${origin}/graphql`, {
      method: "POST",
      headers,
      body: JSON.stringify({ query: `query($id: String!) { canExecuteOperation(documentIdOrSlug: $id, operationType: "ADD_FILE") }`, variables: { id } }),
    });
    const json = (await q.json()) as { data?: { canExecuteOperation?: boolean } };
    if (json.data?.canExecuteOperation === true) access = "write";
  } catch {
    // read is the floor; the vault app's own gate speaks for anything more
  }
  return { id, slug, name, switchboardUrl: origin, access };
}
