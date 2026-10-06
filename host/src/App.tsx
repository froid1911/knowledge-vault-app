import { RenownProvider, type GraphQLReactorClient } from "@powerhousedao/reactor-browser";
import * as knowledgeNote from "@powerhousedao/knowledge-note";
import * as workflow from "@powerhousedao/workflow";
import type { DocumentModelLib } from "document-model";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useIdentity } from "./state/use-identity.js";
import { fetchRemoteVaults, type RemoteVault } from "./api/remote.js";
import { declareDesktopHost } from "./bootstrap.js";
import { Landing } from "./screens/Landing.js";
import { RemoteWorkspaceScreen } from "./screens/RemoteWorkspaceScreen.js";
import { Settings } from "./screens/Settings.js";
import { WorkflowsScreen } from "./screens/WorkflowsScreen.js";
import { WorkspaceScreen } from "./screens/WorkspaceScreen.js";
import { useRoute } from "./shell/router.js";
import { matchShortcut } from "./shell/shortcuts.js";
import type { SidecarInfo } from "./sidecar.js";

/** The packages the host mounts; boot.tsx installs the reactor with their document models, once. */
export const LIBS: readonly DocumentModelLib[] = [
  knowledgeNote as unknown as DocumentModelLib,
  workflow as unknown as DocumentModelLib,
];

export function App({ info, client }: { info: SidecarInfo; client: GraphQLReactorClient }) {
  const [route, navigate] = useRoute();
  const toVaults = useCallback(() => navigate({ name: "vaults" }), [navigate]);
  const toSettings = useCallback(() => navigate({ name: "settings", section: "vaults" }), [navigate]);
  const toWorkflows = useCallback(() => navigate({ name: "workflows" }), [navigate]);
  const inWorkspace = route.name === "vault" || route.name === "workflows" || route.name === "remote";
  const toIdentity = useCallback(() => navigate({ name: "settings", section: "identity" }), [navigate]);
  const identity = useIdentity(info);
  const hostIdentity = useMemo(
    () => (identity.status?.authenticated && identity.status.address ? { address: identity.status.address, ...(identity.status.did ? { did: identity.status.did } : {}) } : undefined),
    [identity.status?.authenticated, identity.status?.address, identity.status?.did],
  );
  // The vault package reads who we are from the host declaration (gate, Access view, live feed).
  // A remote workspace declares its own origin and bearer while it is open.
  useEffect(() => {
    if (route.name === "remote") return;
    declareDesktopHost(info.origin, { identity: hostIdentity });
  }, [info.origin, hostIdentity, route.name]);

  // Shortcuts only on the shell's own screens: a workspace app owns its keys.
  useEffect(() => {
    if (inWorkspace) return;
    const onKey = (e: KeyboardEvent) => {
      const s = matchShortcut(e);
      if (!s) return;
      e.preventDefault();
      if (s === "new-vault") navigate({ name: "vaults", newVault: true });
      else toSettings();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inWorkspace, navigate, toSettings]);

  let screen;
  switch (route.name) {
    case "vault":
      screen = <WorkspaceScreen client={client} driveId={route.id} appId="knowledge-vault" onBack={toVaults} onSettings={toSettings} />;
      break;
    case "workflows":
      screen = <WorkflowsScreen info={info} client={client} onBack={toVaults} onSettings={toSettings} />;
      break;
    case "remote":
      screen = <RemoteRoute info={info} id={route.id} identity={hostIdentity} onBack={toVaults} onSettings={toSettings} />;
      break;
    case "settings":
      screen = <Settings info={info} section={route.section} onSection={(section) => navigate({ name: "settings", section })} onBack={toVaults} onOpenWorkflows={toWorkflows} />;
      break;
    default:
      screen = (
        <Landing
          engine={{ state: "ready" }}
          info={info}
          identity={identity.status}
          onIdentity={toIdentity}
          onOpenRemote={(v) => navigate({ name: "remote", id: v.id })}
          newVault={route.newVault === true}
          onNewVaultDone={toVaults}
          onOpen={(v) => navigate({ name: "vault", id: v.id })}
          onWorkflows={toWorkflows}
          onSettings={toSettings}
        />
      );
  }
  return (
    <RenownProvider appName="desktop-knowledge-vault" url="https://www.renown.id" switchboardUrl={info.origin}>
      {screen}
    </RenownProvider>
  );
}

/** Looks the remote vault up by id (the list is the engine's), then mounts it. */
function RemoteRoute({ info, id, identity, onBack, onSettings }: { info: SidecarInfo; id: string; identity: { address: string; did?: string } | undefined; onBack: () => void; onSettings: () => void }) {
  const [vault, setVault] = useState<RemoteVault | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    fetchRemoteVaults(info)
      .then((list) => alive && setVault(list.find((v) => v.id === id) ?? null))
      .catch(() => alive && setVault(null));
    return () => {
      alive = false;
    };
  }, [info, id]);
  if (vault === undefined) return <p role="status" className="kv-quiet kv-main">Opening…</p>;
  if (vault === null) {
    return (
      <div className="kv-main">
        <p role="alert" className="kv-error">This remote vault is no longer in the app's list.</p>
        <button type="button" className="kv-button" onClick={onBack}>← Vaults</button>
      </div>
    );
  }
  return <RemoteWorkspaceScreen info={info} vault={vault} identity={identity} onBack={onBack} onSettings={onSettings} />;
}
