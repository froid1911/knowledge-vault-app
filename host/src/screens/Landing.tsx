import { useEffect, useState } from "react";
import type { SidecarInfo } from "../sidecar.js";
import { createVault, fetchVaults, type VaultSummary } from "../vaults.js";

// Phase 0 skeleton; the designed landing of spec §5.7 arrives in Phase 1.
export function Landing({ info, onOpen }: { info: SidecarInfo; onOpen: (v: VaultSummary) => void }) {
  const [vaults, setVaults] = useState<VaultSummary[] | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetchVaults(info)
      .then((v) => alive && setVaults(v))
      .catch((e: Error) => alive && setError(e.message));
    return () => { alive = false; };
  }, [info]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    try {
      const v = await createVault(info, name);
      setName("");
      onOpen(v);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main className="kv-landing">
      <header><h1>Knowledge Vault</h1></header>
      <section aria-labelledby="vaults-heading">
        <h2 id="vaults-heading">Vaults</h2>
        {vaults === null && !error && <p role="status">Starting the engine…</p>}
        {error && <p role="alert">{error}</p>}
        {vaults && vaults.length === 0 && <p>No vaults yet. Create your first vault below.</p>}
        <ul className="kv-vaults">
          {vaults?.map((v) => (
            <li key={v.id}>
              <button type="button" onClick={() => onOpen(v)}>
                <span className="kv-vault-name">{v.name}</span>
                <span className="kv-vault-meta">{v.noteCount} notes</span>
              </button>
            </li>
          ))}
        </ul>
        <form onSubmit={onCreate} className="kv-new-vault">
          <label htmlFor="vault-name">Name</label>
          <input id="vault-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Research notes" autoFocus />
          <button type="submit" disabled={!name.trim()}>Create vault</button>
        </form>
      </section>
    </main>
  );
}
