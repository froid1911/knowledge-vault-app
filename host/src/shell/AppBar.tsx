import type { ReactNode } from "react";
import { GearIcon } from "./icons.js";

/** Inside a workspace or Settings: the one landmark that never moves — back to the vaults, the title, the gear. `children` (the pipeline chip) sit right, before the gear. */
export function AppBar({ title, onBack, onSettings, children }: { title: string; onBack: () => void; onSettings?: () => void; children?: ReactNode }) {
  return (
    <nav className="kv-appbar" aria-label="App">
      <button type="button" onClick={onBack}>← Vaults</button>
      <span className="kv-appbar-title">{title}</span>
      <span className="kv-appbar-spacer" aria-hidden="true" />
      {children}
      {onSettings && (
        <button type="button" className="kv-icon-button kv-appbar-gear" aria-label="Settings" title="Settings" onClick={onSettings}>
          <GearIcon />
        </button>
      )}
    </nav>
  );
}
