// Mirrors src-tauri/src/backoff.rs: the dev loop supervises the engine the way the shell does.
const DELAYS_MS = [1000, 4000, 16000];

/** The delay before restart attempt `attempt` (1-based); null means give up. */
export function restartDelayMs(attempt) {
  return DELAYS_MS[Math.max(0, attempt - 1)] ?? null;
}

/** Crash timestamps within a sliding window; `record` returns how many fall in it, this one included. */
export function crashWindow(windowMs = 120_000) {
  let crashes = [];
  return {
    record(nowMs) {
      crashes = crashes.filter((t) => nowMs - t < windowMs);
      crashes.push(nowMs);
      return crashes.length;
    },
  };
}
