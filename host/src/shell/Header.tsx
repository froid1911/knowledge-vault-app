import { shortAddress } from "../state/use-identity.js";
import { GearIcon, WorkflowIcon } from "./icons.js";

/** The front door's landmark: app name left; who you are, Workflows and Settings right. */
export function Header({ identity, onIdentity, onWorkflows, onSettings }: { identity?: { authenticated: boolean; address?: string } | null; onIdentity?: () => void; onWorkflows?: () => void; onSettings?: () => void }) {
  return (
    <header className="kv-header">
      <img src="/vault-icon.png" alt="" width={44} height={44} />
      <h1>Knowledge Vault</h1>
      <div className="kv-header-actions">
        {onWorkflows && (
          <button type="button" className="kv-button kv-button-quiet" onClick={onWorkflows}>
            <WorkflowIcon /> Workflows
          </button>
        )}
        {identity && onIdentity && (
          identity.authenticated && identity.address ? (
            <button type="button" className="kv-identity-chip" onClick={onIdentity} title={`Signed in as ${identity.address}`}>
              <span className="kv-identity-dot" aria-hidden="true" />
              {shortAddress(identity.address)}
            </button>
          ) : (
            <button type="button" className="kv-button kv-button-quiet" onClick={onIdentity}>Sign in</button>
          )
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
