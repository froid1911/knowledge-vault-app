const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Whether the app runs in the desktop shell (the dev loop's browser does not). */
export function isTauri(): boolean {
  return inTauri();
}

/** A shell command, or undefined in a browser — so a button can call it and degrade. */
export async function invokeIfTauri<T>(command: string, args?: Record<string, unknown>): Promise<T | undefined> {
  if (!inTauri()) return undefined;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}
