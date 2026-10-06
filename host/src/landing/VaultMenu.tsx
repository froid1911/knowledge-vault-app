import { useEffect, useRef, useState } from "react";
import { MoreIcon } from "../shell/icons.js";

/** The ⋯ on a tile: Open · Rename · Delete. Closes on Escape, on a click elsewhere, and after a choice. */
/** A local vault offers Rename and Delete; a remote one offers Remove (from this app only). */
export function VaultMenu({ name, onOpen, onRename, onDelete, onRemove }: { name: string; onOpen: () => void; onRename?: () => void; onDelete?: () => void; onRemove?: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const choose = (fn: () => void) => () => { setOpen(false); fn(); };
  return (
    <div className="kv-menu" ref={ref}>
      <button type="button" className="kv-icon-button kv-menu-trigger" aria-label={`More actions for ${name}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <MoreIcon />
      </button>
      {open && (
        <div role="menu" className="kv-menu-list" aria-label={`Actions for ${name}`}>
          <button type="button" role="menuitem" onClick={choose(onOpen)}>Open</button>
          {onRename && <button type="button" role="menuitem" onClick={choose(onRename)}>Rename</button>}
          {onDelete && <button type="button" role="menuitem" className="kv-menu-danger" onClick={choose(onDelete)}>Delete</button>}
          {onRemove && <button type="button" role="menuitem" onClick={choose(onRemove)}>Remove from this app</button>}
        </div>
      )}
    </div>
  );
}
