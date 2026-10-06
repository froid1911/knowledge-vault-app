export type SidecarInfo = { origin: string; graphqlUrl: string; controlOrigin: string; controlToken: string };

/** What the host knows about the engine: starting (no readiness line yet), ready, or exited with its code. */
export type SidecarStatus =
  | { state: "starting" }
  | { state: "ready"; info: SidecarInfo }
  | { state: "exited"; code: number | null };

/** The shell's `sidecar_info` answer and its `sidecar:status` payload (src-tauri/src/sidecar.rs `SidecarStatus`). */
export type ShellStatus = {
  state: "starting" | "ready" | "exited";
  ready: { port: number; controlPort: number; controlToken: string } | null;
  code: number | null;
};

export function sidecarOrigins(port: number, controlPort: number) {
  const origin = `http://127.0.0.1:${port}`;
  return { origin, graphqlUrl: `${origin}/graphql`, controlOrigin: `http://127.0.0.1:${controlPort}` };
}

export function statusFromShell(raw: ShellStatus): SidecarStatus {
  if (raw.state === "ready" && raw.ready) {
    return { state: "ready", info: { ...sidecarOrigins(raw.ready.port, raw.ready.controlPort), controlToken: raw.ready.controlToken } };
  }
  if (raw.state === "exited") return { state: "exited", code: raw.code ?? null };
  return { state: "starting" };
}

export type StatusWatcher = (onStatus: (status: SidecarStatus) => void) => () => void;

const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Under Tauri: every `sidecar:status` the shell emits, plus its current answer
 * (the event may have fired before we listened). In a browser (the dev loop):
 * ready at once, from Vite's env.
 */
export const watchSidecar: StatusWatcher = (onStatus) => {
  if (!inTauri()) {
    const port = Number(import.meta.env.VITE_SIDECAR_PORT ?? 4201);
    const controlPort = Number(import.meta.env.VITE_CONTROL_PORT ?? 4202);
    onStatus({ state: "ready", info: { ...sidecarOrigins(port, controlPort), controlToken: import.meta.env.VITE_CONTROL_TOKEN ?? "dev-token" } });
    return () => {};
  }
  let stopped = false;
  let unlisten: (() => void) | undefined;
  void (async () => {
    const [{ invoke }, { listen }] = await Promise.all([import("@tauri-apps/api/core"), import("@tauri-apps/api/event")]);
    unlisten = await listen<ShellStatus>("sidecar:status", (event) => {
      if (!stopped) onStatus(statusFromShell(event.payload));
    });
    const now = await invoke<ShellStatus>("sidecar_info");
    if (!stopped) onStatus(statusFromShell(now));
  })();
  return () => {
    stopped = true;
    unlisten?.();
  };
};
