import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchVaultGraph, type VaultGraphSample } from "../api/graph.js";
import type { SidecarInfo } from "../sidecar.js";
import { createVault, fetchStatus, fetchVaults, type VaultSummary } from "../vaults.js";
import { NewVaultForm } from "../landing/NewVaultForm.js";
import { readRecents, rememberOpened, sortByRecency, type Recents } from "../landing/recents.js";
import { loadSavedLayout, type XY } from "../landing/saved-layout.js";
import { StatusStrip, type EngineState } from "../landing/StatusStrip.js";
import { VaultTile } from "../landing/VaultTile.js";

export type LandingApi = {
  fetchVaults: (info: SidecarInfo) => Promise<VaultSummary[]>;
  createVault: (info: SidecarInfo, name: string) => Promise<VaultSummary>;
  fetchGraph: (origin: string, driveId: string, maxNodes: number) => Promise<VaultGraphSample>;
  fetchVersion: (info: SidecarInfo) => Promise<string>;
  loadLayout: (driveId: string) => Promise<Map<string, XY> | null>;
};

const realApi: LandingApi = {
  fetchVaults,
  createVault,
  fetchGraph: (origin, driveId, maxNodes) => fetchVaultGraph(origin, driveId, { maxNodes }),
  fetchVersion: async (info) => (await fetchStatus(info)).appVersion,
  loadLayout: loadSavedLayout,
};

type Props = {
  engine: EngineState;
  /** Present once the engine is ready; the landing lists and creates vaults only then. */
  info?: SidecarInfo;
  onOpen?: (vault: VaultSummary) => void;
  api?: LandingApi;
  storage?: Storage;
};

/**
 * The front door (spec §5.7): the vaults as constellation tiles, the most
 * recently opened one largest; on first run, the inline create form; the
 * engine's state in a strip at the bottom. Never a workspace.
 */
export function Landing({ engine, info, onOpen, api = realApi, storage }: Props) {
  const store = storage ?? (typeof localStorage === "undefined" ? undefined : localStorage);
  const [vaults, setVaults] = useState<VaultSummary[] | null>(null);
  const [recents, setRecents] = useState<Recents>(() => readRecents(store));
  const [samples, setSamples] = useState<Record<string, VaultGraphSample | null>>({});
  const [layouts, setLayouts] = useState<Record<string, Map<string, XY> | null>>({});
  const [version, setVersion] = useState<string | undefined>();
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!info) return;
    let alive = true;
    api
      .fetchVaults(info)
      .then((v) => alive && setVaults(v))
      .catch((e: Error) => alive && setError(`Could not load the vaults: ${e.message}`));
    api
      .fetchVersion(info)
      .then((v) => alive && setVersion(v))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [api, info]);

  const ordered = useMemo(() => (vaults ? sortByRecency(vaults, recents) : []), [vaults, recents]);

  useEffect(() => {
    if (!info || !vaults) return;
    let alive = true;
    for (const [i, v] of ordered.entries()) {
      if (v.id in samples) continue;
      api
        .fetchGraph(info.origin, v.id, i === 0 ? 48 : 28)
        .then((s) => alive && setSamples((prev) => ({ ...prev, [v.id]: s })))
        .catch(() => alive && setSamples((prev) => ({ ...prev, [v.id]: null })));
      api
        .loadLayout(v.id)
        .then((l) => alive && setLayouts((prev) => ({ ...prev, [v.id]: l })))
        .catch(() => alive && setLayouts((prev) => ({ ...prev, [v.id]: null })));
    }
    return () => {
      alive = false;
    };
  }, [api, info, vaults, ordered, samples]);

  const open = useCallback(
    (v: VaultSummary) => {
      setRecents(rememberOpened(store, v.id));
      onOpen?.(v);
    },
    [onOpen, store],
  );

  async function create(name: string) {
    if (!info) return;
    setBusy(true);
    setError(null);
    try {
      const v = await api.createVault(info, name);
      setVaults((prev) => [...(prev ?? []), v]);
      setShowForm(false);
      open(v);
    } catch (e) {
      setError(`Could not create the vault: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const ready = engine.state === "ready" && !!info;
  const firstRun = ready && vaults !== null && vaults.length === 0;

  return (
    <div className="kv-landing" data-engine={engine.state}>
      <header className="kv-header">
        <img src="/vault-icon.png" alt="" width={28} height={28} />
        <h1>Knowledge Vault</h1>
      </header>
      <main className="kv-main">
        <div className="kv-vaults-row">
          <h2 id="vaults-heading">Vaults</h2>
          {ready && vaults && vaults.length > 0 && (
            <div className="kv-actions">
              <button type="button" className="kv-button" onClick={() => setShowForm(true)} disabled={showForm}>
                New vault
              </button>
              <button type="button" className="kv-button" disabled title="Coming in a later version">
                Connect remote vault
              </button>
            </div>
          )}
        </div>
        {!ready && <p className="kv-quiet">Your vaults appear here once the engine is ready.</p>}
        {ready && vaults === null && !error && <p className="kv-quiet" role="status">Loading vaults…</p>}
        {error && !showForm && !firstRun && <p role="alert" className="kv-error">{error}</p>}
        {firstRun && <NewVaultForm firstRun busy={busy} error={error} onCreate={(n) => void create(n)} />}
        {ready && showForm && <NewVaultForm firstRun={false} busy={busy} error={error} onCreate={(n) => void create(n)} onCancel={() => setShowForm(false)} />}
        {ready && ordered.length > 0 && (
          <ul className="kv-grid" aria-labelledby="vaults-heading">
            {ordered.map((v, i) => (
              <li key={v.id} className="kv-grid-cell" data-lead={i === 0}>
                <VaultTile vault={v} lead={i === 0} opened={recents[v.id]} sample={samples[v.id] ?? null} saved={layouts[v.id] ?? null} onOpen={() => open(v)} />
              </li>
            ))}
          </ul>
        )}
      </main>
      <StatusStrip engine={engine} version={version} />
    </div>
  );
}
