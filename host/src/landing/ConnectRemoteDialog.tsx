import { useState, type FormEvent } from "react";
import type { RemoteCheck, RemoteVault } from "../api/remote.js";
import { Dialog } from "../shell/Dialog.js";

export type ConnectRemoteApi = {
  check: (url: string, drive: string | undefined) => Promise<RemoteCheck>;
  add: (url: string, drive: string | undefined) => Promise<RemoteVault>;
};

/** Connect a vault on a server: paste its address, check what it is and what you may do, add it. */
export function ConnectRemoteDialog({ api, onAdded, onClose }: { api: ConnectRemoteApi; onAdded: (vault: RemoteVault) => void; onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [drive, setDrive] = useState("");
  const [checked, setChecked] = useState<RemoteCheck | null>(null);
  const [busy, setBusy] = useState<"check" | "add" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function check(e: FormEvent) {
    e.preventDefault();
    setBusy("check");
    setError(null);
    setChecked(null);
    try {
      setChecked(await api.check(url.trim(), drive.trim() || undefined));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }
  async function add() {
    setBusy("add");
    setError(null);
    try {
      onAdded(await api.add(url.trim(), drive.trim() || undefined));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }
  return (
    <Dialog open title="Connect a remote vault" onClose={onClose}>
      <form onSubmit={(e) => void check(e)} className="kv-dialog-form">
        <p>A vault on a server you have access to. The app talks to that server directly, signed in as you; nothing is copied to this computer.</p>
        <label htmlFor="remote-url">Vault server (Switchboard URL)</label>
        <input id="remote-url" value={url} onChange={(e) => { setUrl(e.target.value); setChecked(null); }} placeholder="https://switchboard.example.com/graphql" autoFocus autoComplete="off" disabled={busy !== null} />
        <label htmlFor="remote-drive">Drive id or slug</label>
        <input id="remote-drive" value={drive} onChange={(e) => { setDrive(e.target.value); setChecked(null); }} placeholder="my-vault — or leave empty if the address names it" autoComplete="off" disabled={busy !== null} />
        {checked && (
          <p className="kv-remote-check" role="status">
            Found <strong>{checked.name}</strong> — you can {checked.access === "write" ? "read and write" : "read"}.
          </p>
        )}
        {error && <p role="alert" className="kv-error">{error}</p>}
        <div className="kv-dialog-actions">
          <button type="button" className="kv-button" onClick={onClose} disabled={busy !== null}>Cancel</button>
          {checked ? (
            <button type="button" className="kv-button kv-button-primary" onClick={() => void add()} disabled={busy !== null}>{busy === "add" ? "Adding…" : "Add vault"}</button>
          ) : (
            <button type="submit" className="kv-button kv-button-primary" disabled={busy !== null || !url.trim()}>{busy === "check" ? "Checking…" : "Check"}</button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
