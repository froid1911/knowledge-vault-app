import { initTheme, useTheme, type GraphQLReactorClient } from "@powerhousedao/reactor-browser";
import { useEffect, useState, type ComponentType } from "react";
import { declareDesktopHost } from "./bootstrap.js";
import { installExternalLinksForTauri } from "./links.js";
import { localHostExtras } from "./local-engine.js";
import { fetchStatus } from "./vaults.js";
import type { TokenProvider } from "./api/identity.js";
import { Landing } from "./screens/Landing.js";
import { watchSidecar, type SidecarInfo, type SidecarStatus, type StatusWatcher } from "./sidecar.js";

export type LoadedApp = {
  App: ComponentType<{ info: SidecarInfo; client: GraphQLReactorClient; bearer?: TokenProvider }>;
  client: GraphQLReactorClient;
  /** The user's bearer for a protected local engine; absent for an open one. */
  bearer?: TokenProvider;
};
export type AppLoader = (info: SidecarInfo) => Promise<LoadedApp>;

let loading: Promise<LoadedApp> | undefined;
/**
 * Declare the host, then load the vault package and install the reactor —
 * once per engine, however often React re-runs effects (StrictMode mounts twice).
 * Order matters: the package runs its boot on import and reads the host slot
 * at that moment, so nothing in this module imports it statically. A protected
 * engine (spec §4.4) is declared with the user's bearer.
 */
export const loadApp: AppLoader = (info) => {
  loading ??= (async () => {
    const status = await fetchStatus(info).catch(() => undefined);
    const extras = localHostExtras(status?.protected === true, info);
    declareDesktopHost(info.origin, extras);
    const [{ App, LIBS }, { installReactor }] = await Promise.all([import("./App.js"), import("./reactor.js")]);
    return { App, client: installReactor(info, LIBS, extras.bearer), ...(extras.bearer ? { bearer: extras.bearer } : {}) };
  })();
  return loading;
};
/** After the engine restarted (the protection switch) the app is loaded again for the engine it now is. */
export function forgetLoadedApp(): void {
  loading = undefined;
}

/**
 * The stored theme (reactor-browser's `ph:theme`, dark by default — written by
 * index.html before first paint) mirrored onto <html> as `data-bai-theme`, so
 * the vault app's tokens resolve for the shell exactly as inside the app.
 */
function useThemeRoot(): void {
  initTheme();
  const { theme } = useTheme();
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.baiTheme = theme;
    root.style.colorScheme = theme;
  }, [theme]);
}

function EngineScreen({ title, detail, kind }: { title: string; detail: string; kind: "status" | "alert" }) {
  return (
    <main className="kv-engine" data-kind={kind} role={kind}>
      <h1 className="kv-engine-title">{title}</h1>
      <p className="kv-engine-detail">{detail}</p>
    </main>
  );
}

/** First thing on screen: the engine's state, then the vault app once the engine is ready. */
export function Boot({ watch = watchSidecar, load = loadApp }: { watch?: StatusWatcher; load?: AppLoader }) {
  useThemeRoot();
  useEffect(() => installExternalLinksForTauri(), []);
  const [status, setStatus] = useState<SidecarStatus>({ state: "starting" });
  const [app, setApp] = useState<LoadedApp | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => watch(setStatus), [watch]);
  // The engine left "ready" (it restarts for the protection switch): the loaded app belongs to the old engine.
  useEffect(() => {
    if (status.state === "ready" || !app) return;
    forgetLoadedApp();
    setApp(null);
  }, [status.state, app]);
  useEffect(() => {
    if (status.state !== "ready" || app) return;
    let alive = true;
    load(status.info)
      .then((loaded) => alive && setApp(loaded))
      .catch((error: unknown) => alive && setFailure(error instanceof Error ? error.message : String(error)));
    return () => {
      alive = false;
    };
  }, [status, app, load]);

  // The landing's frame — header, "Vaults", status strip — is on screen from the first paint;
  // the engine's state lives in the strip, so nothing jumps when the vaults arrive.
  if (status.state === "exited") return <Landing engine={{ state: "exited", code: status.code }} />;
  if (status.state === "failed") return <Landing engine={status} />;
  if (failure) return <EngineScreen kind="alert" title="The vault app could not load" detail={failure} />;
  if (status.state === "ready" && app) {
    const App = app.App;
    return <App info={status.info} client={app.client} bearer={app.bearer} />;
  }
  return <Landing engine={{ state: "starting" }} />;
}
