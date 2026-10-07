import { useEffect, useState } from "react";
import { invokeIfTauri } from "../shell/tauri.js";

/** The shell's `download:finished` event (src-tauri/src/lib.rs on_download). */
export type DownloadFinished = { success: boolean; path: string | null; cancelled?: boolean };
export type DownloadEvents = (onEvent: (e: DownloadFinished) => void) => () => void;

/** Under Tauri: the shell's events; in a browser downloads are the browser's own business. */
export const tauriDownloadEvents: DownloadEvents = (onEvent) => {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return () => {};
  let off: (() => void) | undefined;
  let stopped = false;
  void import("@tauri-apps/api/event").then(({ listen }) =>
    listen<DownloadFinished>("download:finished", (e) => onEvent(e.payload)).then((unlisten) => {
      if (stopped) unlisten();
      else off = unlisten;
    }),
  );
  return () => {
    stopped = true;
    off?.();
  };
};

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;
const folderName = (path: string) => path.split(/[\\/]/).slice(0, -1).pop() || "/";

/** A file the page downloaded landed in the Downloads folder: say where, and offer to show it. */
export function DownloadNotice({
  subscribe = tauriDownloadEvents,
  reveal = (path: string) => void invokeIfTauri("reveal_path", { path }),
}: {
  subscribe?: DownloadEvents;
  reveal?: (path: string) => void;
}) {
  const [last, setLast] = useState<DownloadFinished | null>(null);
  useEffect(() => subscribe(setLast), [subscribe]);
  useEffect(() => {
    if (!last) return;
    const t = setTimeout(() => setLast(null), 10_000);
    return () => clearTimeout(t);
  }, [last]);
  if (!last || last.cancelled) return null; // the user closed the Save dialog: nothing happened, nothing to say
  const ok = last.success && last.path;
  return (
    <div className="kv-download-notice" role={ok ? "status" : "alert"} data-ok={ok ? "true" : "false"}>
      <span>{ok ? `Saved ${fileName(last.path!)} to ${folderName(last.path!)}.` : "The download did not finish."}</span>
      {ok && (
        <button type="button" className="kv-link-button" onClick={() => reveal(last.path!)}>
          Show
        </button>
      )}
      <button type="button" className="kv-link-button" aria-label="Dismiss" onClick={() => setLast(null)}>
        ×
      </button>
    </div>
  );
}
