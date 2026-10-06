/**
 * Reads the layout the vault app saved for a drive — same origin, same
 * IndexedDB (`bai-graph-layout` / `layouts`, format 3: ids + a Float32Array of
 * xy pairs; see the package's graph/layout-store.ts) — so a tile shows the
 * graph as the person last saw it. Read-only; the app owns the store.
 */
export type XY = { x: number; y: number };

const DB_NAME = "bai-graph-layout";
const STORE = "layouts";
const FORMAT = 3;

export function decodeStoredLayout(value: unknown): Map<string, XY> | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { v?: unknown; ids?: unknown; xy?: unknown };
  if (v.v !== FORMAT || !Array.isArray(v.ids) || !(v.xy instanceof Float32Array)) return null;
  if (v.xy.length !== v.ids.length * 2) return null;
  const out = new Map<string, XY>();
  for (let i = 0; i < v.ids.length; i++) {
    const id: unknown = v.ids[i];
    const x = v.xy[i * 2];
    const y = v.xy[i * 2 + 1];
    if (typeof id === "string" && x !== undefined && y !== undefined && Number.isFinite(x) && Number.isFinite(y)) out.set(id, { x, y });
  }
  return out;
}

export async function loadSavedLayout(
  key: string,
  idb: IDBFactory | undefined = (globalThis as { indexedDB?: IDBFactory }).indexedDB,
): Promise<Map<string, XY> | null> {
  if (!idb) return null;
  return new Promise((resolve) => {
    try {
      const req = idb.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        // The store did not exist: nothing saved yet. Create it as the app would, so versions agree.
        req.result.createObjectStore(STORE);
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
      req.onsuccess = () => {
        const db = req.result;
        try {
          const get = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
          get.onsuccess = () => {
            db.close();
            resolve(decodeStoredLayout(get.result));
          };
          get.onerror = () => {
            db.close();
            resolve(null);
          };
        } catch {
          db.close();
          resolve(null);
        }
      };
    } catch {
      resolve(null);
    }
  });
}

/** The saved positions for a sample, or null when too few of its nodes were ever laid out. */
export function positionsFor(ids: readonly string[], saved: Map<string, XY> | null, minCoverage = 0.6): Map<string, XY> | null {
  if (!saved || ids.length === 0) return null;
  const out = new Map<string, XY>();
  for (const id of ids) {
    const p = saved.get(id);
    if (p) out.set(id, p);
  }
  return out.size / ids.length >= minCoverage ? out : null;
}
