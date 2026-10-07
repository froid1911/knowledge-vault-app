/**
 * The sidecar's own calls to the engine (vault list, create, rename, delete,
 * the Workflows drive) when the engine is protected: it requires a bearer, and
 * the signed-in identity — the engine's administrator — is the one to send.
 */
export type TokenProvider = () => Promise<string | undefined>;

export function authorizedFetch(provider: TokenProvider, fetchImpl: typeof fetch = fetch): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const token = await provider();
    const headers = new Headers(init?.headers);
    if (token) headers.set("authorization", `Bearer ${token}`);
    return fetchImpl(input, { ...init, headers });
  }) as typeof fetch;
}

const RENEW_BEFORE_MS = 60_000;

/** Mints through the identity module and keeps the token until a minute before it expires; not signed in → no token. */
export function createEngineTokenProvider(
  identity: { token: () => Promise<{ token: string; expiresAt: string }> },
  now: () => number = Date.now,
): TokenProvider {
  let cached: { token: string; expiresAt: number } | undefined;
  return async () => {
    if (cached && cached.expiresAt - now() > RENEW_BEFORE_MS) return cached.token;
    try {
      const minted = await identity.token();
      cached = { token: minted.token, expiresAt: Date.parse(minted.expiresAt) };
      return cached.token;
    } catch (error) {
      cached = undefined;
      if (/not authenticated/i.test(error instanceof Error ? error.message : String(error))) return undefined;
      throw error;
    }
  };
}
