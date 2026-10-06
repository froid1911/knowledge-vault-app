import type { SidecarInfo } from "../sidecar.js";
import { control, ControlError } from "../vaults.js";

/** Mirrors the engine's /auth/* (sidecar/src/identity.ts). */
export type IdentityStatus = {
  authenticated: boolean;
  address?: string;
  did?: string;
  appDid: string;
  authenticatedAt?: string;
  renownUrl: string;
  pending: { url?: string; startedAt: string } | null;
  lastError?: string;
};
export type AccessToken = { token: string; expiresAt: string; address: string; did: string };

export const fetchAuthStatus = (info: SidecarInfo, f: typeof fetch = fetch) => control<IdentityStatus>(info, "/auth/status", { method: "GET" }, f);
export const startLogin = (info: SidecarInfo, f: typeof fetch = fetch) => control<{ url?: string; alreadyAuthenticated: boolean }>(info, "/auth/login", { method: "POST" }, f);
export const cancelLogin = (info: SidecarInfo, f: typeof fetch = fetch) => control<{ cancelled: true }>(info, "/auth/cancel", { method: "POST" }, f);
export const logout = (info: SidecarInfo, f: typeof fetch = fetch) => control<{ signedOut: true }>(info, "/auth/logout", { method: "POST" }, f);
export const fetchToken = (info: SidecarInfo, f: typeof fetch = fetch) => control<AccessToken>(info, "/auth/token", { method: "GET" }, f);

export type TokenProvider = () => Promise<string | undefined>;
const RENEW_BEFORE_MS = 60_000;

/**
 * A bearer provider for a remote Switchboard: the engine mints the token, the
 * provider caches it until a minute before it expires. Not signed in → no token
 * (and no header), which the remote answers with 401 and the gate explains.
 */
export function createTokenProvider(info: SidecarInfo, f: typeof fetch = fetch, now: () => number = Date.now): TokenProvider & { invalidate: () => void } {
  let cached: AccessToken | undefined;
  const provider = async () => {
    if (cached && new Date(cached.expiresAt).getTime() - now() > RENEW_BEFORE_MS) return cached.token;
    try {
      cached = await fetchToken(info, f);
      return cached.token;
    } catch (error) {
      cached = undefined;
      if (error instanceof ControlError && error.status === 401) return undefined;
      throw error;
    }
  };
  return Object.assign(provider, { invalidate: () => { cached = undefined; } });
}
