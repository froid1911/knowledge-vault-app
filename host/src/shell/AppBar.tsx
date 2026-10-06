import { GearIcon } from "./icons.js";

/** Inside a workspace or Settings: the one landmark that never moves — back to the vaults, the title, the gear. */
export function AppBar({ title, onBack, onSettings }: { title: string; onBack: () => void; onSettings?: () => void }) {
  return (
    <nav className="kv-appbar" aria-label="App">
      <button type="button" onClick={onBack}>← Vaults</button>
      <span className="kv-appbar-title">{title}</span>
      {onSettings && (
        <button type="button" className="kv-icon-button kv-appbar-gear" aria-label="Settings" title="Settings" onClick={onSettings}>
          <GearIcon />
        </button>
      )}
    </nav>
  );
}
