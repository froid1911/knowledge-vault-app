import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchVaultGraph, type VaultGraphSample } from "../api/graph.js";
import type { SidecarInfo } from "../sidecar.js";
import { createVault, deleteVault, fetchStatus, fetchVaults, renameVault, type DriveRef, type VaultSummary } from "../vaults.js";
import { DeleteVaultDialog } from "../landing/DeleteVaultDialog.js";
import { NewVaultForm } from "../landing/NewVaultForm.js";
import { readRecents, rememberOpened, sortByRecency, type Recents } from "../landing/recents.js";
import { RenameVaultDialog } from "../landing/RenameVaultDialog.js";
import { loadSavedLayout, type XY } from "../landing/saved-layout.js";
import { StatusStrip, type EngineState } from "../landing/StatusStrip.js";
import { SkeletonTile, VaultTile } from "../landing/VaultTile.js";
import { VaultMenu } from "../landing/VaultMenu.js";
import { Header } from "../shell/Header.js";

export type LandingApi = {
  fetchVaults: (info: SidecarInfo) => Promise<VaultSummary[]>;
  createVault: (info: SidecarInfo, name: string) => Promise<VaultSummary>;
  renameVault: (info: SidecarInfo, id: string, name: string) => Promise<DriveRef>;
  deleteVault: (info: SidecarInfo, id: string) => Promise<void>;
  fetchGraph: (origin: string, driveId: string, maxNodes: number) => Promise<VaultGraphSample>;
  fetchVersion: (info: SidecarInfo) => Promise<string>;
  loadLayout: (driveId: string) => Promise<Map<string, XY> | null>;
};

export const realLandingApi: LandingApi = {
  fetchVaults,
  createVault,
  renameVault,
  deleteVault,
  fetchGraph: (origin, driveId, maxNodes) => fetchVaultGraph(origin, driveId, { maxNodes }),
  fetchVersion: async (info) => (await fetchStatus(info)).appVersion,
  loadLayout: loadSavedLayout,
};

type Props = {
  engine: EngineState;
  /** Present once the engine is ready; the landing lists and creates vaults only then. */
  info?: SidecarInfo;
  onOpen?: (vault: VaultSummary) => void;
  onWorkflows?: () => void;
  onSettings?: () => void;
  /** Arrive with the create form open (Ctrl+N); `onNewVaultDone` clears that route flag once the form closes. */
  newVault?: boolean;
  onNewVaultDone?: () => void;
  api?: LandingApi;
  storage?: Storage;
};

/**
 * The front door (spec §5.7): the vaults as constellation tiles, the most
 * recently opened one largest; on first run, the inline create form; the
 * engine's state in a strip at the bottom. Never a workspace.
 */
export function Landing({ engine, info, onOpen, onWorkflows, onSettings, newVault = false, onNewVaultDone, api = realLandingApi, storage }: Props) {
  const store = storage ?? (typeof localStorage === "undefined" ? undefined : localStorage);
  const [vaults, setVaults] = useState<VaultSummary[] | null>(null);
  const [recents, setRecents] = useState<Recents>(() => readRecents(store));
  const [samples, setSamples] = useState<Record<string, VaultGraphSample | null>>({});
  const [layouts, setLayouts] = useState<Record<string, Map<string, XY> | null>>({});
  const [version, setVersion] = useState<string | undefined>();
  const [showForm, setShowForm] = useState(newVault);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<VaultSummary | null>(null);
  const [deleting, setDeleting] = useState<VaultSummary | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  useEffect(() => setShowForm(newVault), [newVault]);
  const closeForm = () => {
    setShowForm(false);
    if (newVault) onNewVaultDone?.();
  };

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
      closeForm();
      open(v);
    } catch (e) {
      setError(`Could not create the vault: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function rename(v: VaultSummary, name: string) {
    if (!info) return;
    setBusy(true);
    setDialogError(null);
    try {
      const renamed = await api.renameVault(info, v.id, name);
      setVaults((prev) => (prev ?? []).map((x) => (x.id === v.id ? { ...x, name: renamed.name } : x)));
      setRenaming(null);
    } catch (e) {
      setDialogError(`Could not rename the vault: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function remove(v: VaultSummary) {
    if (!info) return;
    setBusy(true);
    setDialogError(null);
    try {
      await api.deleteVault(info, v.id);
      setVaults((prev) => (prev ?? []).filter((x) => x.id !== v.id));
      setDeleting(null);
    } catch (e) {
      setDialogError(`Could not delete the vault: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const ready = engine.state === "ready" && !!info;
  const loading = ready && vaults === null && !error;
  const firstRun = ready && vaults !== null && vaults.length === 0;

  return (
    <div className="kv-landing" data-engine={engine.state}>
      <Header onWorkflows={ready ? onWorkflows : undefined} onSettings={ready ? onSettings : undefined} />
      <main className="kv-main">
        <div className="kv-vaults-row">
          <h2 id="vaults-heading">Vaults</h2>
          {ready && vaults && vaults.length > 0 && (
            <div className="kv-actions">
              <button type="button" className="kv-button" onClick={() => setShowForm(true)} disabled={showForm} title="New vault (Ctrl+N)">
                New vault
              </button>
              <button type="button" className="kv-button" disabled title="Coming in a later version">
                Connect remote vault
              </button>
            </div>
          )}
        </div>
        {!ready && <p className="kv-quiet">Your vaults appear here once the engine is ready.</p>}
        {error && !showForm && !firstRun && <p role="alert" className="kv-error">{error}</p>}
        {firstRun && <NewVaultForm firstRun busy={busy} error={error} onCreate={(n) => void create(n)} />}
        {ready && !firstRun && showForm && <NewVaultForm firstRun={false} busy={busy} error={error} onCreate={(n) => void create(n)} onCancel={closeForm} />}
        {loading && (
          <div className="kv-grid" role="status" aria-label="Loading vaults">
            <SkeletonTile lead />
            <SkeletonTile lead={false} />
            <SkeletonTile lead={false} />
          </div>
        )}
        {ready && ordered.length > 0 && (
          <ul className="kv-grid" aria-labelledby="vaults-heading">
            {ordered.map((v, i) => (
              <li key={v.id} className="kv-grid-cell">
                <VaultTile
                  vault={v}
                  lead={i === 0}
                  opened={recents[v.id]}
                  sample={samples[v.id] ?? null}
                  saved={layouts[v.id] ?? null}
                  onOpen={() => open(v)}
                  menu={<VaultMenu name={v.name} onOpen={() => open(v)} onRename={() => { setDialogError(null); setRenaming(v); }} onDelete={() => { setDialogError(null); setDeleting(v); }} />}
                />
              </li>
            ))}
          </ul>
        )}
      </main>
      <StatusStrip engine={engine} version={version} />
      {renaming && <RenameVaultDialog name={renaming.name} busy={busy} error={dialogError} onSave={(n) => void rename(renaming, n)} onClose={() => setRenaming(null)} />}
      {deleting && <DeleteVaultDialog name={deleting.name} noteCount={samples[deleting.id]?.noteCount ?? deleting.noteCount} busy={busy} error={dialogError} onConfirm={() => void remove(deleting)} onClose={() => setDeleting(null)} />}
    </div>
  );
}
