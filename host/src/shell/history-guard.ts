/**
 * The shell routes by hash (router.ts) — a desktop webview reloads at the app's
 * root. `@powerhousedao/reactor-browser` writes Connect's path URLs on its own:
 * `setSelectedDrive` pushes `/d/<slug>` (or `/` when deselecting) and
 * `setSelectedNode` pushes `/d/<slug>/<node>`, each dropping the fragment —
 * and a dropped fragment reads as "home" to the router. It offers no opt-out,
 * so the host keeps its route authoritative: a path-only write is rewritten to
 * the root with the current hash (query string kept); a write that carries its
 * own hash passes through; a write that changes nothing is skipped, so the
 * history gains no duplicate entries. Install once, before anything renders.
 */
export function installHistoryGuard(): () => void {
  const originalPush = window.history.pushState.bind(window.history);
  const originalReplace = window.history.replaceState.bind(window.history);
  const guard = (original: typeof window.history.pushState) => (data: unknown, unused: string, url?: string | URL | null) => {
    if (url === undefined || url === null) return original(data, unused);
    const target = new URL(String(url), window.location.href);
    if (!target.hash && window.location.hash) {
      target.pathname = "/";
      target.hash = window.location.hash;
    }
    if (target.href === window.location.href) return;
    return original(data, unused, target.href);
  };
  window.history.pushState = guard(originalPush) as typeof window.history.pushState;
  window.history.replaceState = guard(originalReplace) as typeof window.history.replaceState;
  return () => {
    window.history.pushState = originalPush;
    window.history.replaceState = originalReplace;
  };
}
