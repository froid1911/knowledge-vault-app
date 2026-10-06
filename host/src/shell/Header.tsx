import { GearIcon, WorkflowIcon } from "./icons.js";

/** The front door's landmark: app name left; Workflows and Settings right. */
export function Header({ onWorkflows, onSettings }: { onWorkflows?: () => void; onSettings?: () => void }) {
  return (
    <header className="kv-header">
      <img src="/vault-icon.png" alt="" width={28} height={28} />
      <h1>Knowledge Vault</h1>
      <div className="kv-header-actions">
        {onWorkflows && (
          <button type="button" className="kv-button kv-button-quiet" onClick={onWorkflows}>
            <WorkflowIcon /> Workflows
          </button>
        )}
        {onSettings && (
          <button type="button" className="kv-icon-button" aria-label="Settings" title="Settings (Ctrl+,)" onClick={onSettings}>
            <GearIcon />
          </button>
        )}
      </div>
    </header>
  );
}
