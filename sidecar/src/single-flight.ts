/** One in-flight call at a time: concurrent callers share the same promise; the next call after it settles starts afresh. */
export function singleFlight<T>(fn: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | undefined;
  return () => {
    inFlight ??= fn().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  };
}
