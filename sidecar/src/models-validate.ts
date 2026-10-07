/**
 * Settings › Models › Validate: list the provider's models with the saved key —
 * the cheapest request that proves the endpoint is OpenAI-compatible and the
 * key is accepted, without spending a token.
 */
export async function validateModelEndpoint(endpoint: string, key: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: boolean; detail: string }> {
  const url = `${endpoint.replace(/\/+$/, "")}/models`;
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    return { ok: false, detail: `Could not reach ${endpoint}: ${error instanceof Error ? error.message : String(error)}` };
  }
  const body: unknown = await res.json().catch(() => undefined);
  if (res.ok) {
    const data = body && typeof body === "object" ? (body as { data?: unknown }).data : undefined;
    return { ok: true, detail: Array.isArray(data) ? `${data.length} models available` : "The provider answered" };
  }
  const message = providerMessage(body) ?? `HTTP ${res.status}`;
  if (res.status === 401 || res.status === 403) return { ok: false, detail: `The provider refused the key: ${message}` };
  return { ok: false, detail: `The provider answered HTTP ${res.status}: ${message}` };
}

function providerMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const error = (body as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") return (error as { message: string }).message;
  return undefined;
}
