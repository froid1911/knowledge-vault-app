import { randomBytes } from "node:crypto";

/**
 * The return leg of a sign-in run in the system browser (OpenRouter's OAuth for the vault's
 * chat). The window cannot receive the browser's redirect, so the provider returns to the
 * control server instead: the window starts a sign-in (gets a one-shot callback URL), the
 * browser lands on it with `?code=`, and the window collects the code — once, within ten minutes.
 * The code alone is useless: the PKCE verifier never leaves the window.
 */
const TTL_MS = 10 * 60_000;
type Entry = { created: number; code?: string };
export type OAuthTake = { state: "pending" } | { state: "done"; code: string } | { state: "unknown" };

export function createOAuthStore(now: () => number = Date.now) {
  const entries = new Map<string, Entry>();
  const live = (nonce: string): Entry | undefined => {
    const e = entries.get(nonce);
    if (e && now() - e.created > TTL_MS) {
      entries.delete(nonce);
      return undefined;
    }
    return e;
  };
  return {
    start(): { nonce: string } {
      for (const [n, e] of entries) if (now() - e.created > TTL_MS) entries.delete(n);
      const nonce = randomBytes(24).toString("hex");
      entries.set(nonce, { created: now() });
      return { nonce };
    },
    /** The browser came back. False when the sign-in is unknown, expired or already answered. */
    receive(nonce: string, code: string): boolean {
      const e = live(nonce);
      if (!e || e.code !== undefined) return false;
      e.code = code;
      return true;
    },
    take(nonce: string): OAuthTake {
      const e = live(nonce);
      if (!e) return { state: "unknown" };
      if (e.code === undefined) return { state: "pending" };
      entries.delete(nonce);
      return { state: "done", code: e.code };
    },
  };
}

/** What the browser tab shows after the redirect. */
export function callbackPage(ok: boolean): string {
  const [title, text] = ok
    ? ["Signed in", "You can close this tab and return to Knowledge Vault."]
    : ["This sign-in link has expired", "Start the sign-in again from Knowledge Vault."];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title} — Knowledge Vault</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#1e1e2e;color:#e4e4e7;font:16px/1.5 system-ui,sans-serif}
main{text-align:center;max-width:28rem;padding:2rem}h1{font-size:1.4rem;margin:0 0 .5rem}p{color:#a1a1aa;margin:0}</style></head>
<body><main><h1>${title}</h1><p>${text}</p></main></body></html>`;
}
