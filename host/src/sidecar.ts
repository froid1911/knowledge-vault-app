export type SidecarInfo = { origin: string; graphqlUrl: string; controlOrigin: string; controlToken: string };

export function sidecarOrigins(port: number, controlPort: number) {
  const origin = `http://127.0.0.1:${port}`;
  return { origin, graphqlUrl: `${origin}/graphql`, controlOrigin: `http://127.0.0.1:${controlPort}` };
}

type TauriReady = { port: number; controlPort: number; controlToken: string } | null;
const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Under Tauri: ask the shell (it answers once the sidecar printed its readiness line). In a browser: Vite env. */
export async function resolveSidecar(): Promise<SidecarInfo> {
  if (inTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    for (;;) {
      const ready = await invoke<TauriReady>("sidecar_info");
      if (ready) return { ...sidecarOrigins(ready.port, ready.controlPort), controlToken: ready.controlToken };
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  const port = Number(import.meta.env.VITE_SIDECAR_PORT ?? 4201);
  const controlPort = Number(import.meta.env.VITE_CONTROL_PORT ?? 4202);
  return { ...sidecarOrigins(port, controlPort), controlToken: import.meta.env.VITE_CONTROL_TOKEN ?? "dev-token" };
}
