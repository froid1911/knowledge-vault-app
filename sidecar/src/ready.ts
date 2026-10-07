export function readyLine(port: number, controlPort: number): string {
  return JSON.stringify({ event: "ready", port, controlPort });
}

/** The engine asks whoever spawned it to start it again (the protection switch changed its environment). */
export function restartLine(reason: string): string {
  return JSON.stringify({ event: "restart", reason });
}

export async function waitForHealth(
  url: string,
  opts: { timeoutMs: number; intervalMs: number; fetchImpl?: typeof fetch },
): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const deadline = Date.now() + opts.timeoutMs;
  for (;;) {
    try {
      const res = await fetchImpl(url);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    if (Date.now() >= deadline) {
      throw new Error(`Switchboard did not answer at ${url} within ${opts.timeoutMs} ms`);
    }
    await new Promise((r) => setTimeout(r, opts.intervalMs));
  }
}
