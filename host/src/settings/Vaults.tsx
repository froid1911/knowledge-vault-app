import { useEffect, useState } from "react";
import { DeleteVaultDialog } from "../landing/DeleteVaultDialog.js";
import { RenameVaultDialog } from "../landing/RenameVaultDialog.js";
import type { SettingsApi } from "../screens/Settings.js";
import type { SidecarInfo } from "../sidecar.js";
import type { VaultSummary } from "../vaults.js";

const number = new Intl.NumberFormat("en-US");

/** Every local vault with rename and delete — the complete list the tiles' ⋯ menus are a shortcut to. */
export function VaultsSection({ info, api }: { info: SidecarInfo; api: SettingsApi }) {
  const [vaults, setVaults] = useState<VaultSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<VaultSummary | null>(null);
  const [deleting, setDeleting] = useState<VaultSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.fetchVaults(info).then((v) => alive && setVaults(v)).catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [api, info]);

  async function rename(v: VaultSummary, name: string) {
    setBusy(true);
    setDialogError(null);
    try {
      const r = await api.renameVault(info, v.id, name);
      setVaults((prev) => (prev ?? []).map((x) => (x.id === v.id ? { ...x, name: r.name } : x)));
      setRenaming(null);
    } catch (e) {
      setDialogError(`Could not rename the vault: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }
  async function remove(v: VaultSummary) {
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

  return (
    <div className="kv-settings-body">
      <p className="kv-settings-lead">Vaults live in the engine's store on this computer. Renaming keeps everything; deleting removes the vault with all its notes, maps and sources.</p>
      {error && <p role="alert" className="kv-error">Could not load the vaults: {error}</p>}
      {vaults && vaults.length === 0 && <p className="kv-quiet">No vaults yet.</p>}
      {vaults && vaults.length > 0 && (
        <ul className="kv-settings-list" aria-label="Vaults">
          {vaults.map((v) => (
            <li key={v.id} className="kv-settings-row">
              <div className="kv-settings-row-main">
                <span className="kv-settings-row-title">{v.name}</span>
                <span className="kv-settings-row-meta">{number.format(v.noteCount)} note{v.noteCount === 1 ? "" : "s"}</span>
              </div>
              <div className="kv-settings-row-actions">
                <button type="button" className="kv-button" onClick={() => { setDialogError(null); setRenaming(v); }}>Rename</button>
                <button type="button" className="kv-button kv-button-danger-quiet" onClick={() => { setDialogError(null); setDeleting(v); }}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {renaming && <RenameVaultDialog name={renaming.name} busy={busy} error={dialogError} onSave={(n) => void rename(renaming, n)} onClose={() => setRenaming(null)} />}
      {deleting && <DeleteVaultDialog name={deleting.name} noteCount={deleting.noteCount} busy={busy} error={dialogError} onConfirm={() => void remove(deleting)} onClose={() => setDeleting(null)} />}
    </div>
  );
}
