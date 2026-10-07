import { useEffect, useRef, useState } from "react";
import type { FillResult } from "../api/connections.js";

/** The connector id Studio stores on a connection to the Knowledge Vault piece (sidecar/src/connections.ts). */
export const KNOWLEDGE_VAULT_CONNECTOR = "@powerhousedao/piece-knowledge-vault#knowledge-vault";

export type ConnectionLike = { header: { id: string; documentType: string }; state: unknown };
type ConnectionState = { connectorId?: string | null; config?: Record<string, unknown> | null; secretRefs?: { name: string }[] };

const stateOf = (document: ConnectionLike): ConnectionState => ((document.state as { global?: ConnectionState } | undefined)?.global ?? {});
const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

/**
 * Above Studio's form for a Knowledge Vault connection: what this app can fill in, so nobody
 * has to find a Switchboard URL or run `ph access-token`. The engine's address goes in by
 * itself when the field is empty; the access token comes from the app's sign-in on request
 * (a 90-day token, stored encrypted like the form's own Save).
 */
export function ConnectionAssist({ document, fill }: { document: ConnectionLike; fill: (id: string, token: boolean) => Promise<FillResult> }) {
  const state = stateOf(document);
  const id = document.header.id;
  const isVault = state.connectorId === KNOWLEDGE_VAULT_CONNECTOR;
  const baseUrl = typeof state.config?.base_url === "string" ? state.config.base_url.trim() : "";
  const hasToken = (state.secretRefs ?? []).some((s) => s.name === "token");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  // The address, once per connection: a user who clears the field afterwards is not overruled.
  const filledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!isVault || baseUrl || filledFor.current === id) return;
    filledFor.current = id;
    void fill(id, false).catch(() => undefined);
  }, [isVault, baseUrl, id, fill]);

  if (!isVault || (hasToken && !note)) return null;
  const useSignIn = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await fill(id, true);
      setNote({
        ok: true,
        text:
          r.token?.kind === "open"
            ? "This engine is open, so the connection needs no real token; a placeholder is set."
            : `Access token added from your sign-in${r.token?.expiresAt ? `, valid until ${date(r.token.expiresAt)}` : ""}.`,
      });
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="kv-assist">
      {!hasToken && (
        <>
          <p>
            This app can fill this connection for you: the address of its own engine{baseUrl ? " is set" : " goes in by itself"}, and the access token
            can come from your sign-in in this app.
          </p>
          <button type="button" className="kv-button" disabled={busy} onClick={() => void useSignIn()}>
            {busy ? "Adding…" : "Use my sign-in"}
          </button>
        </>
      )}
      {note && (
        <p role={note.ok ? "status" : "alert"} className={note.ok ? "kv-quiet" : "kv-error"}>
          {note.text}
        </p>
      )}
    </div>
  );
}
