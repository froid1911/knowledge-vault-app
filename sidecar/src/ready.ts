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

/** The engine refused to start and says why (`store-too-new`, `store-in-use`); the shell shows it and does not respawn. */
export function fatalLine(reason: string, message: string): string {
  return JSON.stringify({ event: "fatal", reason, message });
}

/** The engine is stopping on request (POST /shutdown): its exit is not a crash. */
export function shutdownLine(): string {
  return JSON.stringify({ event: "shutdown" });
}
