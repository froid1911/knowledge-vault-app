import { useEffect, useState } from "react";
import type { SettingsApi } from "../screens/Settings.js";
import type { SidecarInfo } from "../sidecar.js";
import type { EngineStatus } from "../vaults.js";

function CopyBlock({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="kv-code">
      <span className="kv-code-label">{label}</span>
      <code className="kv-code-value">{value}</code>
      <button type="button" className="kv-button" onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</button>
    </div>
  );
}

/** The engineering view: what runs where, and how to point the CLI, the plugin and agents at this engine. */
export function DiagnosticsSection({ info, api }: { info: SidecarInfo; api: SettingsApi }) {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api.fetchStatus(info).then((s) => alive && setStatus(s)).catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [api, info]);
  return (
    <div className="kv-settings-body">
      {error && <p role="alert" className="kv-error">Could not read the engine's status: {error}</p>}
      {status && (
        <>
          <dl className="kv-facts">
            <dt>Engine</dt><dd>Ready on port {status.port}; control on {status.controlPort}</dd>
            <dt>Local vaults</dt><dd>{status.protected ? "Protected — sign-in required" : "Open on this computer"}</dd>
            <dt>Data folder</dt><dd><code>{status.dataDir}</code></dd>
            <dt>Versions</dt><dd>app {status.appVersion} · stack {status.stackVersion} · vault package {status.vaultPackageVersion}</dd>
          </dl>
          <h3 className="kv-settings-subheading">Connect your tools</h3>
          <p className="kv-quiet">The Switchboard CLI, the knowledge plugin and MCP agents work against this engine like against any vault server.</p>
          <CopyBlock label="Switchboard CLI" value={`switchboard init --url ${info.origin}/graphql --name local-vault --use-profile`} />
          <CopyBlock label="MCP" value={`${info.origin}/mcp`} />
          <CopyBlock label="GraphQL" value={info.graphqlUrl} />
        </>
      )}
    </div>
  );
}
