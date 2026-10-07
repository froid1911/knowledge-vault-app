import { useEffect, useState, type FormEvent } from "react";
import type { SettingsApi } from "../screens/Settings.js";
import type { SidecarInfo } from "../sidecar.js";
import type { AppSettings } from "../vaults.js";

/** One OpenAI-compatible endpoint for the chat today and the pipeline next; the key is kept by the engine, never shown again. */
export function ModelsSection({ info, api }: { info: SidecarInfo; api: SettingsApi }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [endpoint, setEndpoint] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<{ ok: boolean; detail: string } | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .fetchSettings(info)
      .then((s) => {
        if (!alive) return;
        setSettings(s);
        setEndpoint(s.models.endpoint);
        setModel(s.models.model);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [api, info]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const next = await api.saveSettings(info, { models: { endpoint, model, ...(apiKey ? { apiKey } : {}) } });
      setSettings(next);
      setApiKey("");
      setSaved(true);
    } catch (err) {
      setError(`Could not save: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }
  async function validate() {
    setBusy(true);
    setVerdict(null);
    try {
      setVerdict(await api.validateModels(info));
    } catch (err) {
      setVerdict({ ok: false, detail: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }
  async function removeKey() {
    setBusy(true);
    setError(null);
    try {
      setSettings(await api.saveSettings(info, { models: { apiKey: "" } }));
    } catch (err) {
      setError(`Could not remove the key: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="kv-settings-body">
      <p className="kv-settings-lead">Any OpenAI-compatible provider: OpenRouter, OpenAI, or a local server such as Ollama or LM Studio. The chat and the processing pipeline use it; a vault created after this is set up processes its sources on its own.</p>
      {settings === null && !error && <p className="kv-quiet" role="status">Loading…</p>}
      {settings && (
        <form className="kv-form" onSubmit={(e) => void submit(e)}>
          <label htmlFor="models-endpoint">Endpoint</label>
          <input id="models-endpoint" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://openrouter.ai/api/v1" disabled={busy} />
          <label htmlFor="models-model">Model</label>
          <input id="models-model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="anthropic/claude-sonnet-4" disabled={busy} />
          <label htmlFor="models-key">API key</label>
          <div className="kv-form-inline">
            <input id="models-key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={settings.models.hasKey ? "A key is stored — enter a new one to replace it" : "sk-…"} autoComplete="off" disabled={busy} />
            {settings.models.hasKey && (
              <button type="button" className="kv-button kv-button-danger-quiet" onClick={() => void removeKey()} disabled={busy}>Remove key</button>
            )}
          </div>
          <p className="kv-hint">The key is stored by the engine on this computer (file mode 0600) and is never shown again.</p>
          <div className="kv-form-actions">
            <button type="submit" className="kv-button kv-button-primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
            {settings.models.hasKey && (
              <button type="button" className="kv-button" disabled={busy} onClick={() => void validate()}>Validate</button>
            )}
            {saved && <span className="kv-form-saved" role="status">Saved</span>}
          </div>
          {verdict && <p role="status" className={verdict.ok ? "kv-form-saved" : "kv-error"}>{verdict.detail}</p>}
          {error && <p role="alert" className="kv-error">{error}</p>}
        </form>
      )}
    </div>
  );
}
