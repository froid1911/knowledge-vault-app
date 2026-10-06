/** When each vault was last opened on this machine — the landing's ordering and tile sentences. */
export type Recents = Record<string, string>;
export const RECENTS_KEY = "kv.recents";

type Store = Pick<Storage, "getItem" | "setItem">;

export function readRecents(storage: Store | undefined): Recents {
  try {
    const raw = storage?.getItem(RECENTS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Recents = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) if (typeof v === "string") out[k] = v;
    return out;
  } catch {
    return {};
  }
}

export function rememberOpened(storage: Store | undefined, vaultId: string, when: Date = new Date()): Recents {
  const next = { ...readRecents(storage), [vaultId]: when.toISOString() };
  try {
    storage?.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // a full or blocked store only loses the ordering hint
  }
  return next;
}

export function lastOpened(recents: Recents, vaultId: string): string | undefined {
  return recents[vaultId];
}

/** Most recently opened first; never-opened vaults after them, by name. */
export function sortByRecency<T extends { id: string; name: string }>(vaults: readonly T[], recents: Recents): T[] {
  return [...vaults].sort((a, b) => {
    const ta = recents[a.id] ?? "";
    const tb = recents[b.id] ?? "";
    if (ta !== tb) return ta > tb ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "opened 25 minutes ago", "opened yesterday", "opened on 12 August" — a sentence fragment for the tile. */
export function formatOpened(iso: string | undefined, now: Date = new Date()): string {
  if (!iso) return "not opened yet";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "not opened yet";
  const seconds = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000));
  if (seconds < 60) return "opened just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `opened ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `opened ${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "opened yesterday";
  if (days < 14) return `opened ${days} days ago`;
  return `opened on ${then.getUTCDate()} ${MONTHS[then.getUTCMonth()]}`;
}
