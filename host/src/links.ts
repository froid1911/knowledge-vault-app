/**
 * Spec §5.8: anything that is not the app itself opens in the system browser.
 * Sign-in pages (OpenRouter, Renown) and documentation links must never load
 * inside the window — the user would lose the app, and an OAuth redirect has no
 * way back. Two layers: this interceptor for anchors and window.open, and the
 * shell's navigation guard (src-tauri) for full-page navigations.
 */
const LOOPBACK = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

export function shouldOpenExternally(href: string, currentOrigin: string): boolean {
  let url: URL;
  try {
    url = new URL(href, currentOrigin);
  } catch {
    return false;
  }
  if (url.protocol === "mailto:") return true;
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return url.origin !== currentOrigin && !LOOPBACK.test(url.origin);
}

type Opener = (url: string) => void | Promise<void>;

/** Route external anchors and window.open through `open`; returns the uninstall. */
export function installExternalLinks(open: Opener, doc: Document = document, win: Window = window): () => void {
  const origin = () => win.location.origin;
  const onClick = (event: MouseEvent) => {
    const anchor = (event.target as Element | null)?.closest?.("a[href]");
    const href = anchor?.getAttribute("href");
    if (!href || !shouldOpenExternally(href, origin())) return;
    event.preventDefault();
    void open(new URL(href, origin()).href);
  };
  doc.addEventListener("click", onClick, true);
  const original = win.open;
  const shim = ((url?: string | URL, target?: string, features?: string) => {
    const href = url === undefined ? "" : String(url);
    if (href && shouldOpenExternally(href, origin())) {
      void open(new URL(href, origin()).href);
      return null;
    }
    return original.call(win, url, target, features);
  }) as typeof win.open;
  win.open = shim;
  return () => {
    doc.removeEventListener("click", onClick, true);
    if (win.open === shim) win.open = original;
  };
}

/** Under Tauri, the opener plugin; in a browser the page behaves as a page. */
export function installExternalLinksForTauri(): () => void {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return () => {};
  return installExternalLinks(async (url) => {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  });
}
