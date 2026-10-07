import type { TokenProvider } from "../api/identity.js";

export type HostUser = { address: string; did?: string };

/**
 * What the desktop puts in `window.ph.renown`, Connect's Renown session.
 *
 * The user's Renown session lives in the engine, not in this webview, so Connect's
 * RenownProvider (a browser keypair) has nothing to offer here. Apps that read the
 * ambient session — Workflow Studio's runtime calls take their bearer from it — get
 * the signed-in user and the same bearer the host already uses for the engine.
 * No `signer`: reactor-browser signs dispatches with the ambient signer when there is
 * one, and the desktop leaves signing as it is.
 */
export function desktopRenown(user: HostUser, bearer?: TokenProvider) {
  return {
    user: { address: user.address, did: user.did, chainId: 1, networkId: "eip155" },
    did: user.did,
    status: "authorized" as const,
    signer: undefined,
    on: (_event: string, _listener: (...args: unknown[]) => void) => () => {},
    getBearerToken: async (_options: { expiresIn?: number; aud?: string }) => (bearer ? await bearer() : undefined),
    login: async (): Promise<never> => {
      throw new Error("Sign in from the app's Settings › Identity");
    },
    logout: async (): Promise<never> => {
      throw new Error("Sign out from the app's Settings › Identity");
    },
  };
}
