import { createTokenProvider, type TokenProvider } from "./api/identity.js";
import type { SidecarInfo } from "./sidecar.js";

/**
 * What the host declares for the local engine besides its origin: a protected
 * engine (spec §4.4) requires the user's bearer, minted by the engine itself —
 * the same path a remote vault uses; an open engine gets no header at all,
 * which is the anonymous owner it expects.
 */
export function localHostExtras(protectedEngine: boolean, info: SidecarInfo, provider?: TokenProvider): { bearer?: TokenProvider } {
  return protectedEngine ? { bearer: provider ?? createTokenProvider(info) } : {};
}
