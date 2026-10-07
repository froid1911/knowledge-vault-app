/** Semver order (`v` prefix ignored; a release outranks its prereleases; numeric identifiers compare as numbers). */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const parse = (v: string) => {
    const t = v.trim().replace(/^v/, "");
    const dash = t.indexOf("-");
    const core = (dash === -1 ? t : t.slice(0, dash)).split(".").map((x) => Number.parseInt(x, 10) || 0);
    const pre = dash === -1 ? [] : t.slice(dash + 1).split(".");
    return { core, pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.core[i] ?? 0) - (y.core[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  if (!x.pre.length && !y.pre.length) return 0;
  if (!x.pre.length) return 1;
  if (!y.pre.length) return -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const np = Number(p);
    const nq = Number(q);
    const c = Number.isInteger(np) && Number.isInteger(nq) ? Math.sign(np - nq) : p < q ? -1 : p > q ? 1 : 0;
    if (c !== 0) return c as -1 | 1;
  }
  return 0;
}

export type UpdateInfo = { latest: string; url: string };
type Storage = { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void };
const KEY = "kv.update-check";
const DAY = 24 * 3_600_000;

/**
 * Spec §11: a notice, not an updater. Asks the release feed at most once a day (cached
 * in storage) and answers the newer release, or null — when up to date, without a
 * feed, or when anything fails (an update check must never bother anyone).
 */
export async function checkForUpdate(feedUrl: string, current: string, fetchImpl: typeof fetch, storage: Storage, now: () => number = Date.now): Promise<UpdateInfo | null> {
  if (!feedUrl) return null;
  try {
    type Cached = { at: number; latest: string; url: string };
    let cached: Cached | null;
    try {
      cached = JSON.parse(storage.getItem(KEY) ?? "null") as Cached | null;
    } catch {
      cached = null;
    }
    let latest: UpdateInfo;
    if (cached && now() - cached.at < DAY) {
      latest = { latest: cached.latest, url: cached.url };
    } else {
      const res = await fetchImpl(feedUrl, { headers: { accept: "application/vnd.github+json" } });
      if (!res.ok) return null;
      const body = (await res.json()) as { tag_name?: string; html_url?: string };
      if (!body.tag_name) return null;
      latest = { latest: body.tag_name.replace(/^v/, ""), url: body.html_url ?? feedUrl };
      storage.setItem(KEY, JSON.stringify({ at: now(), ...latest }));
    }
    return compareSemver(latest.latest, current) > 0 ? latest : null;
  } catch {
    return null;
  }
}
